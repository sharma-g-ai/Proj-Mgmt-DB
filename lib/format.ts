// Display helpers. Per Spec 02 §6: round to 1 decimal at display only; values
// arrive from the DB at full precision.

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"; // Spec 02 §3/§7 undefined case
  return `${round1(value)}%`;
}

export function fmtHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${round1(value)}`;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Spec 02 §3 / §8.3: overrun projects (>100% completion) get an "OVER" badge.
export function isOverrun(pctCompletion: number | null | undefined): boolean {
  return pctCompletion !== null && pctCompletion !== undefined && pctCompletion > 100;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // iso is a date string (YYYY-MM-DD); render without timezone drift.
  const [y, m, d] = iso.split("T")[0].split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Monday of the week containing the given date (matches week_start_date rows,
// which are Monday-based per the seed / date_trunc('week', ...)).
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 = Sun ... 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Monday string 'YYYY-MM-DD' shifted by n weeks (n may be negative).
export function addWeeks(mondayStr: string, n: number): string {
  const d = new Date(`${mondayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

// Inclusive list of Monday strings from startMonday..endMonday (capped for safety).
export function listWeeks(startMonday: string, endMonday: string, cap = 104): string[] {
  const out: string[] = [];
  let cur = startMonday;
  while (cur <= endMonday && out.length < cap) {
    out.push(cur);
    cur = addWeeks(cur, 1);
  }
  return out;
}

// Short 'DD/MM' label for a date string.
export function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// --- Working-day (weekday) allocation math ---
// Holidays are ignored for now, so "working days" = weekdays (Mon–Fri). This
// mirrors the SQL fn_working_days while the Holiday table is empty.

// Resources are considered under-allocated below this fraction of capacity.
export const UNDER_ALLOCATION_THRESHOLD = 0.8;

export function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return day === 0 || day === 6;
}

// Count of weekdays in [start, end] inclusive (0 if end < start).
export function businessDays(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (e < s) return 0;
  let count = 0;
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// Man-hours an allocation contributes to the week [weekMonday, weekMonday+6],
// spreading allocated_hours evenly across the allocation's weekdays.
export function committedInWeek(
  alloc: { allocated_hours: number; start_date: string; end_date: string },
  weekMonday: string
): number {
  const totalDays = businessDays(alloc.start_date, alloc.end_date);
  if (totalDays === 0) return 0;
  const weekEnd = addDays(weekMonday, 6);
  const overlapStart = alloc.start_date > weekMonday ? alloc.start_date : weekMonday;
  const overlapEnd = alloc.end_date < weekEnd ? alloc.end_date : weekEnd;
  const overlapDays = businessDays(overlapStart, overlapEnd);
  return (alloc.allocated_hours / totalDays) * overlapDays;
}

// A resource's capacity (hrs) for the week: weekdays in week × daily capacity.
export function weekCapacity(weeklyCapacity: number, weekMonday: string): number {
  return businessDays(weekMonday, addDays(weekMonday, 6)) * (weeklyCapacity / 5);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// True if an allocation range covers the week whose Monday is weekMonday.
export function rangeCoversWeek(start: string, end: string, weekMonday: string): boolean {
  const wEnd = addWeeks(weekMonday, 1); // exclusive next Monday
  return start < wEnd && end >= weekMonday;
}

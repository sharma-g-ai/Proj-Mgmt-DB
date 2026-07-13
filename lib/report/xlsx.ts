import ExcelJS from "exceljs";
import { round1 } from "@/lib/format";
import type { ReportData } from "@/lib/report/types";

type ColSpec = { header: string; key: string; width: number };
type VisibleColumns = { projects?: string[]; hours?: string[]; finance?: string[] };

// Keep only the columns whose key is in `keys` (preserving definition order). When
// `keys` is undefined, keep all — so the picker is purely additive.
function pick(cols: ColSpec[], keys?: string[]): ColSpec[] {
  if (!keys) return cols;
  const set = new Set(keys);
  const kept = cols.filter((c) => set.has(c.key));
  return kept.length > 0 ? kept : cols; // never emit a header-less sheet
}

// Spec 08 §3.2 — raw, pivot-ready sheets (no charts): Portfolio Summary, Logged
// Hours, and (admin) a Finance pivot. `visible` (from the on-screen column picker)
// narrows each sheet to the shown columns.
export async function buildXlsx(
  data: ReportData,
  visible?: VisibleColumns,
  financeMonthLabel?: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PM Dashboard";
  wb.created = data.generatedAt;

  // Sheet 1 — Portfolio Summary (one row per project × resource; project columns
  // repeat). Column order matches the on-screen Projects tab.
  const s1 = wb.addWorksheet("Portfolio Summary");
  s1.columns = pick(
    [
      { header: "Project", key: "project_name", width: 24 },
      { header: "Resource", key: "person", width: 18 },
      { header: "Man-hours", key: "allocated_hours", width: 12 },
      { header: "Stakeholder", key: "stakeholder", width: 14 },
      { header: "Type", key: "project_type_label", width: 12 },
      { header: "Priority", key: "priority", width: 10 },
      { header: "Status", key: "status_label", width: 14 },
      { header: "Manager/Lead", key: "manager_lead_name", width: 18 },
      { header: "Start Date", key: "start_date", width: 12 },
      { header: "Planned End", key: "planned_end_date", width: 12 },
      { header: "Estimated Hrs", key: "estimated_effort_hrs", width: 13 },
      { header: "Logged Hrs", key: "logged_hours", width: 11 },
      { header: "% Completion", key: "pct_completion", width: 13 },
      { header: "Pending Hrs", key: "pending_hours", width: 12 },
      { header: "Pending %", key: "pending_pct", width: 11 },
      { header: "Planned Hrs", key: "planned_hours", width: 12 },
      { header: "Allocation %", key: "allocation_pct", width: 12 },
      { header: "Working Days Left", key: "working_days_remaining", width: 16 },
      { header: "Archived", key: "is_archived", width: 10 },
    ],
    visible?.projects
  );
  for (const p of data.projectRows) {
    s1.addRow({
      ...p,
      allocated_hours: num(p.allocated_hours),
      logged_hours: num(p.logged_hours),
      pct_completion: num(p.pct_completion),
      pending_hours: num(p.pending_hours),
      pending_pct: num(p.pending_pct),
      planned_hours: num(p.planned_hours),
      allocation_pct: num(p.allocation_pct),
      is_archived: p.is_archived ? "Yes" : "No",
    });
  }

  // Sheet 2 — Logged Hours (one row per HoursLogEntry).
  const s2 = wb.addWorksheet("Logged Hours");
  s2.columns = pick(
    [
      { header: "Project", key: "project_name", width: 24 },
      { header: "Person", key: "person", width: 20 },
      { header: "Date", key: "entry_date", width: 12 },
      { header: "Logged Hours", key: "hours_logged", width: 13 },
      { header: "Source", key: "source", width: 10 },
    ],
    visible?.hours
  );
  for (const h of data.hours) s2.addRow(h);

  const sheets = [s1, s2];

  // Sheet 3 — Finance (admin only): person × project allocated man-hours pivot for
  // the selected month. Sheet name carries the month (Excel caps names at 31 chars).
  if (data.finance.length > 0) {
    const suffix = financeMonthLabel ? ` (${financeMonthLabel})` : "";
    const name = `Finance${suffix}`.slice(0, 31);
    const s3 = wb.addWorksheet(name);
    s3.columns = pick(
      [
        { header: "Employee ID", key: "employee_id", width: 14 },
        { header: "Employee Name", key: "name", width: 22 },
        { header: "Role", key: "role_label", width: 18 },
        ...data.financeProjects.map((p) => ({ header: p, key: p, width: 14 })),
        { header: "Total", key: "total", width: 10 },
      ],
      visible?.finance
    );
    for (const f of data.finance) {
      s3.addRow({
        employee_id: f.employee_id ?? "",
        name: f.name,
        role_label: f.role_label,
        ...f.hours,
        total: num(f.total),
      });
    }
    sheets.push(s3);
  }

  for (const ws of sheets) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    // Native Excel filter dropdowns over the header row.
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : round1(v);
}

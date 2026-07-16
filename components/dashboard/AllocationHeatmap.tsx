import Link from "next/link";
import { addWeeks, fmtDate, round1, committedInWeek, weekCapacity, UNDER_ALLOCATION_THRESHOLD } from "@/lib/format";
import type { AllocationRow } from "@/lib/types";

// Spec 07 §2.3, reworked to man-hours: Resource Utilization for the selected week.
// Total Projects = distinct projects the person is committed to that week (visible
// set only). The Load column is the person's ORG-WIDE committed hours (via the
// security-definer fn, so it includes projects outside the viewer's silo) vs. their
// weekly capacity, shown as a man-hours delta with over/under flags.
export function AllocationHeatmap({
  allocations,
  selectedWeek,
  committedByUser,
  capacityByUser,
}: {
  allocations: AllocationRow[];
  selectedWeek: string;
  committedByUser: Map<string, number>;
  capacityByUser: Map<string, number>;
}) {
  const people = Array.from(
    new Map(allocations.map((a) => [a.user_id, a.users?.full_name ?? "Unknown"])).entries()
  )
    .map(([user_id, name]) => ({ user_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // (user_id|project_id) -> committed hours this week (visible projects only).
  const cell = new Map<string, number>();
  for (const a of allocations) {
    const hrs = committedInWeek(a, selectedWeek);
    if (hrs > 0) {
      const k = `${a.user_id}|${a.project_id}`;
      cell.set(k, (cell.get(k) ?? 0) + hrs);
    }
  }

  // Distinct project count per person, derived from the same cell map.
  const projectCountByUser = new Map<string, number>();
  cell.forEach((_v, k) => {
    const uid = k.split("|")[0];
    projectCountByUser.set(uid, (projectCountByUser.get(uid) ?? 0) + 1);
  });

  const rows = people.map((p) => {
    const committed = committedByUser.get(p.user_id) ?? 0;
    const capacity = weekCapacity(capacityByUser.get(p.user_id) ?? 0, selectedWeek);
    const delta = committed - capacity;
    const over = capacity > 0 && committed > capacity;
    const under = capacity > 0 && committed < UNDER_ALLOCATION_THRESHOLD * capacity;
    return { ...p, committed, capacity, delta, over, under };
  });
  const overCount = rows.filter((r) => r.over).length;
  const underCount = rows.filter((r) => r.under).length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Resource utilization</h2>
          {rows.length > 0 && (
            <p className="mt-0.5 text-xs text-gray-500">
              <span className="text-red-600">Over: {overCount}</span> ·{" "}
              <span className="text-amber-600">Under: {underCount}</span> (this week)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/dashboard?week=${addWeeks(selectedWeek, -1)}`}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50">←</Link>
          <span className="text-gray-600">Week of {fmtDate(selectedWeek)}</span>
          <Link href={`/dashboard?week=${addWeeks(selectedWeek, 1)}`}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50">→</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No one is staffed on your visible projects.
        </p>
      ) : (
        <div className="max-h-[26rem] overflow-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="sticky left-0 top-0 z-20 bg-gray-50 px-3 py-2 font-medium">Person</th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-center font-medium">Total Projects</th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-right font-medium">Load (all)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.user_id} className={
                  r.over ? "bg-red-50/40 hover:bg-red-100/60"
                  : r.under ? "bg-amber-50/30 hover:bg-amber-100/50"
                  : "hover:bg-gray-50"
                }>
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium text-gray-800">{r.name}</td>
                  <td className="px-3 py-2 text-center text-gray-600 tabular-nums">
                    {projectCountByUser.get(r.user_id) ?? 0}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.over ? "text-red-600" : r.under ? "text-amber-600" : "text-gray-800"}`}>
                    {round1(r.committed)}/{round1(r.capacity)}h
                    <span className="ml-1 text-xs font-normal">
                      {r.delta > 0 ? `+${round1(r.delta)}h` : r.delta < 0 ? `${round1(r.delta)}h` : "ok"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">
        Total Projects = distinct projects staffed this week. &ldquo;Load (all)&rdquo; is committed
        vs. capacity across every project (incl. ones outside your view); red = over-allocated,
        amber = under {Math.round(UNDER_ALLOCATION_THRESHOLD * 100)}% of capacity.
      </p>
    </section>
  );
}

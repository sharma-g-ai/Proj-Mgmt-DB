import { mondayOf, listWeeks, fmtShort, fmtPct, isOverrun, committedInWeek, round1 } from "@/lib/format";
import type { ProjectMetrics, AllocationRow } from "@/lib/types";

// Spec 07 §2.4 — week-by-week timeline. Each project spans Start→Planned End,
// subdivided into weekly segments shaded by that week's summed allocation %.
// % Completion and the OVER flag are surfaced on the row label.
export function ProjectTimeline({
  projects,
  allocations,
}: {
  projects: ProjectMetrics[];
  allocations: AllocationRow[];
}) {
  if (projects.length === 0) return null;

  // Global week columns across all visible projects.
  const starts = projects.map((p) => mondayOf(new Date(`${p.start_date}T00:00:00Z`)));
  const ends = projects.map((p) => mondayOf(new Date(`${p.planned_end_date}T00:00:00Z`)));
  const minWeek = starts.reduce((a, b) => (a < b ? a : b));
  const maxWeek = ends.reduce((a, b) => (a > b ? a : b));
  const weeks = listWeeks(minWeek, maxWeek);

  // (project_id|week) -> committed hours that week (weekday-spread).
  const alloc = new Map<string, number>();
  for (const a of allocations) {
    for (const w of weeks) {
      const hrs = committedInWeek(a, w);
      if (hrs > 0) {
        const k = `${a.project_id}|${w}`;
        alloc.set(k, (alloc.get(k) ?? 0) + hrs);
      }
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-500">Timeline</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="border-collapse text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium">Project</th>
              {weeks.map((w) => (
                <th key={w} className="w-10 px-1 py-2 font-normal">{fmtShort(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const pStart = mondayOf(new Date(`${p.start_date}T00:00:00Z`));
              const pEnd = mondayOf(new Date(`${p.planned_end_date}T00:00:00Z`));
              return (
                <tr key={p.project_id} className="border-t border-gray-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <div className="max-w-[10rem] truncate font-medium text-gray-800" title={p.project_name}>
                      {p.project_name}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {fmtPct(p.pct_completion)} complete
                      {isOverrun(p.pct_completion) && (
                        <span className="ml-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold uppercase text-white">Over</span>
                      )}
                    </div>
                  </td>
                  {weeks.map((w) => {
                    const inRange = w >= pStart && w <= pEnd;
                    const a = alloc.get(`${p.project_id}|${w}`);
                    const intensity = a !== undefined ? Math.min(a, 40) / 40 * 0.6 + 0.15 : inRange ? 0.08 : 0;
                    return (
                      <td key={w} className="h-8 w-10 border-l border-gray-50"
                        title={a !== undefined ? `${p.project_name} · week of ${w}: ${round1(a)}h` : undefined}
                        style={inRange ? { backgroundColor: `rgba(124, 58, 237, ${intensity})` } : undefined}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Shaded cells span each project&apos;s Start→Planned End; darker = higher summed weekly allocation.
      </p>
    </section>
  );
}

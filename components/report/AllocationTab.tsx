import { mondayOf, listWeeks, fmtShort, fmtPct, isOverrun, committedInWeek } from "@/lib/format";
import type { ProjectMetrics } from "@/lib/types";
import type { ReportTeamRow } from "@/lib/report/types";

// Allocation tab — week-by-week timeline (moved from the dashboard's old
// ProjectTimeline). Each project spans Start→Planned End, subdivided into weekly
// segments. Unlike the old heat-intensity version, a staffed week is colored flatly
// by that project's own color (not shaded by how much allocation it carries).
export function AllocationTab({
  projects,
  team,
}: {
  projects: ProjectMetrics[];
  team: ReportTeamRow[];
}) {
  if (projects.length === 0) return <p className="text-sm text-gray-500">No projects to show.</p>;

  // Global week columns across all visible projects.
  const starts = projects.map((p) => mondayOf(new Date(`${p.start_date}T00:00:00Z`)));
  const ends = projects.map((p) => mondayOf(new Date(`${p.planned_end_date}T00:00:00Z`)));
  const minWeek = starts.reduce((a, b) => (a < b ? a : b));
  const maxWeek = ends.reduce((a, b) => (a > b ? a : b));
  const weeks = listWeeks(minWeek, maxWeek);

  // Group team rows by project_name (unique per project) — no project_id on
  // ReportTeamRow, but the name is a safe, DB-unique key.
  const teamByProject = new Map<string, ReportTeamRow[]>();
  for (const t of team) {
    const list = teamByProject.get(t.project_name);
    if (list) list.push(t);
    else teamByProject.set(t.project_name, [t]);
  }

  // (project_name|week) -> committed hours that week (weekday-spread), just to know
  // whether a week is staffed — no intensity scaling from the value itself anymore.
  const alloc = new Map<string, number>();
  for (const p of projects) {
    const rows = teamByProject.get(p.project_name) ?? [];
    for (const t of rows) {
      for (const w of weeks) {
        const hrs = committedInWeek(t, w);
        if (hrs > 0) {
          const k = `${p.project_name}|${w}`;
          alloc.set(k, (alloc.get(k) ?? 0) + hrs);
        }
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {projects.map((p) => (
          <span key={p.project_id} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colorForProject(p.project_name) }}
            />
            {p.project_name}
          </span>
        ))}
      </div>

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
              const color = colorForProject(p.project_name);
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
                    const staffed = (alloc.get(`${p.project_name}|${w}`) ?? 0) > 0;
                    return (
                      <td key={w} className="h-8 w-10 border-l border-gray-50"
                        title={staffed ? `${p.project_name} · week of ${w}` : undefined}
                        style={
                          staffed
                            ? { backgroundColor: color }
                            : inRange
                              ? { backgroundColor: "rgba(0, 0, 0, 0.04)" }
                              : undefined
                        }
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
        Shaded cells span each project&apos;s Start→Planned End; color = that project (see legend
        above), faint = in range but unstaffed that week.
      </p>
    </div>
  );
}

// Deterministic hash-to-HSL from the project name (DB-unique), so a project's color
// stays stable across reloads instead of reshuffling every render.
function colorForProject(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 55%)`;
}

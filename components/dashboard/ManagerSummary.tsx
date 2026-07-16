import type { ProjectMetrics } from "@/lib/types";

// Admin-only replacement for "At a Glance" — how projects are distributed across
// Manager/Leads, at a glance. Same tally-and-sort shape as SummaryCards.
export function ManagerSummary({ projects }: { projects: ProjectMetrics[] }) {
  const counts = tally(projects.map((p) => p.manager_lead_name ?? "—"));

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-500">
        Projects by Manager/Lead
      </h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Manager/Lead</th>
              <th className="px-4 py-2 text-right font-medium">Projects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {counts.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">No projects yet.</td>
              </tr>
            ) : (
              counts.map(([name, count]) => (
                <tr key={name}>
                  <td className="px-4 py-2 font-medium text-gray-800">{name}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function tally(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

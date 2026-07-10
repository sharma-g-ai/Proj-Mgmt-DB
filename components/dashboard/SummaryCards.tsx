import { fmtPct, isOverrun, round1 } from "@/lib/format";
import type { ProjectMetrics } from "@/lib/types";

// Spec 07 §2.1 — portfolio summary over the active, visible projects.
export function SummaryCards({ projects }: { projects: ProjectMetrics[] }) {
  const byStatus = tally(projects.map((p) => p.status_label ?? "—"));
  const byPriority = tally(projects.map((p) => p.priority));

  const completions = projects
    .map((p) => p.pct_completion)
    .filter((v): v is number => v !== null && v !== undefined);
  const avgCompletion =
    completions.length > 0 ? completions.reduce((a, b) => a + b, 0) / completions.length : null;

  const overCount = projects.filter((p) => isOverrun(p.pct_completion)).length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="By Status">
        <BreakdownList entries={byStatus} />
      </Card>
      <Card title="By Priority">
        <BreakdownList entries={byPriority} />
      </Card>
      <Card title="Avg % Completion">
        <div className="text-3xl font-semibold text-gray-900">
          {avgCompletion === null ? "—" : `${round1(avgCompletion)}%`}
        </div>
        <p className="mt-1 text-xs text-gray-500">across {projects.length} active project{projects.length === 1 ? "" : "s"}</p>
      </Card>
      <Card title="Overrun (OVER)">
        <div className={`text-3xl font-semibold ${overCount > 0 ? "text-red-600" : "text-gray-900"}`}>
          {overCount}
        </div>
        <p className="mt-1 text-xs text-gray-500">project{overCount === 1 ? "" : "s"} over 100%</p>
      </Card>
    </div>
  );
}

function tally(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function BreakdownList({ entries }: { entries: [string, number][] }) {
  if (entries.length === 0) return <p className="text-sm text-gray-400">—</p>;
  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([label, count]) => (
        <li key={label} className="flex items-center justify-between">
          <span className="text-gray-600">{label}</span>
          <span className="font-medium text-gray-900">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}

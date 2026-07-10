import Link from "next/link";
import { StatusBadge, OverBadge } from "@/components/Badges";
import { fmtPct } from "@/lib/format";
import type { ProjectMetrics } from "@/lib/types";

// Spec 07 §2.2 — compact at-a-glance cards linking into project detail.
export function GlanceCards({ projects }: { projects: ProjectMetrics[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-500">
        At a glance
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link
            key={p.project_id}
            href={`/projects/${p.project_id}`}
            className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-gray-900">{p.project_name}</span>
              <StatusBadge label={p.status_label} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">% Completion</span>
              <span className={p.pct_completion && p.pct_completion > 100 ? "font-medium text-red-600" : "font-medium text-gray-800"}>
                {fmtPct(p.pct_completion)}
                <OverBadge pctCompletion={p.pct_completion} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

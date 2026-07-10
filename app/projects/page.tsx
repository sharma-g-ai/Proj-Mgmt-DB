import Link from "next/link";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PriorityBadge, OverBadge, StatusBadge } from "@/components/Badges";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setArchived } from "@/app/projects/actions";
import { fmtPct, fmtDate, fmtHours } from "@/lib/format";
import type { ProjectMetrics, LookupOption, Priority } from "@/lib/types";

type SearchParams = {
  status?: string;
  priority?: string;
  type?: string;
  lead?: string;
  archived?: string;
  sort?: string;
  dir?: string;
};

const SORTABLE = new Set([
  "project_name",
  "stakeholder",
  "priority",
  "status_label",
  "planned_end_date",
  "allocation_pct",
  "pct_completion",
]);

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  const showArchived = searchParams.archived === "1";
  const sort = SORTABLE.has(searchParams.sort ?? "")
    ? (searchParams.sort as string)
    : "planned_end_date";
  const ascending = searchParams.dir !== "desc";

  // Build the RLS-scoped, filtered project query off the metrics view.
  let query = supabase.from("project_metrics").select("*");
  if (!showArchived) query = query.eq("is_archived", false);
  if (searchParams.status) query = query.eq("status_id", searchParams.status);
  if (searchParams.priority) query = query.eq("priority", searchParams.priority);
  if (searchParams.type) query = query.eq("project_type_id", searchParams.type);
  if (isAdmin && searchParams.lead) query = query.eq("manager_lead_id", searchParams.lead);

  const { data: projects } = await query.order(sort, { ascending, nullsFirst: false });

  // Filter dropdown options.
  const { data: statuses } = await supabase
    .from("status_option")
    .select("option_id, label, is_active")
    .order("label");
  const { data: types } = await supabase
    .from("project_type_option")
    .select("option_id, label, is_active")
    .order("label");
  const leads = isAdmin
    ? (
        await supabase
          .from("users")
          .select("user_id, full_name")
          .eq("is_active", true)
          .in("role", ["Admin", "Manager-Lead"])
          .order("full_name")
      ).data
    : null;

  const rows = (projects ?? []) as ProjectMetrics[];

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <Link
            href="/projects/new"
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            + New Project
          </Link>
        </div>

        {/* Filters (Spec 05 §2) — server-rendered GET form */}
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <FilterSelect name="status" label="Status" value={searchParams.status}
            options={(statuses ?? []).map((s: LookupOption) => ({ v: s.option_id, l: s.label }))} />
          <FilterSelect name="priority" label="Priority" value={searchParams.priority}
            options={["High", "Medium", "Low"].map((p) => ({ v: p, l: p }))} />
          <FilterSelect name="type" label="Type" value={searchParams.type}
            options={(types ?? []).map((t: LookupOption) => ({ v: t.option_id, l: t.label }))} />
          {isAdmin && leads && (
            <FilterSelect name="lead" label="Manager/Lead" value={searchParams.lead}
              options={leads.map((u) => ({ v: u.user_id, l: u.full_name }))} />
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
            Show archived
          </label>
          {/* preserve sort across filter submits */}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={ascending ? "asc" : "desc"} />
          <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            Apply
          </button>
          <Link href="/projects" className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            Clear
          </Link>
        </form>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Project" col="project_name" sp={searchParams} sort={sort} ascending={ascending} />
                <SortHeader label="Stakeholder" col="stakeholder" sp={searchParams} sort={sort} ascending={ascending} />
                <th className="px-4 py-2 font-medium">Type</th>
                <SortHeader label="Priority" col="priority" sp={searchParams} sort={sort} ascending={ascending} />
                <SortHeader label="Status" col="status_label" sp={searchParams} sort={sort} ascending={ascending} />
                <th className="px-4 py-2 font-medium">Manager/Lead</th>
                <SortHeader label="Allocation %" col="allocation_pct" sp={searchParams} sort={sort} ascending={ascending} />
                <SortHeader label="% Complete" col="pct_completion" sp={searchParams} sort={sort} ascending={ascending} />
                <SortHeader label="Planned End" col="planned_end_date" sp={searchParams} sort={sort} ascending={ascending} />
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                    No projects match.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.project_id} className={p.is_archived ? "bg-gray-50/60" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.project_id}`} className="font-medium text-gray-900 hover:underline">
                      {p.project_name}
                    </Link>
                    {p.is_archived && (
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.stakeholder}</td>
                  <td className="px-4 py-3 text-gray-600">{p.project_type_label ?? "—"}</td>
                  <td className="px-4 py-3"><PriorityBadge priority={p.priority as Priority} /></td>
                  <td className="px-4 py-3"><StatusBadge label={p.status_label} /></td>
                  <td className="px-4 py-3 text-gray-600">{p.manager_lead_name ?? "—"}</td>
                  <td className={`px-4 py-3 ${p.allocation_pct && p.allocation_pct > 100 ? "font-medium text-amber-600" : "text-gray-600"}`}
                    title={`${fmtHours(p.planned_hours)} planned / ${fmtHours(p.estimated_effort_hrs)} estimated`}>
                    {fmtPct(p.allocation_pct)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {fmtPct(p.pct_completion)}
                    <OverBadge pctCompletion={p.pct_completion} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(p.planned_end_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {!p.is_archived ? (
                        <ConfirmButton
                          action={setArchived.bind(null, p.project_id, true)}
                          message={`Archive "${p.project_name}"? It becomes read-only.`}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Archive
                        </ConfirmButton>
                      ) : isAdmin ? (
                        <ConfirmButton
                          action={setArchived.bind(null, p.project_id, false)}
                          message={`Unarchive "${p.project_name}"?`}
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Unarchive
                        </ConfirmButton>
                      ) : (
                        <span className="text-xs text-gray-400">Admin only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: { v: string; l: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-500">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortHeader({
  label,
  col,
  sp,
  sort,
  ascending,
}: {
  label: string;
  col: string;
  sp: SearchParams;
  sort: string;
  ascending: boolean;
}) {
  const active = sort === col;
  const nextDir = active && ascending ? "desc" : "asc";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "sort" && k !== "dir") params.set(k, v as string);
  }
  params.set("sort", col);
  params.set("dir", nextDir);
  return (
    <th className="px-4 py-2 font-medium">
      <Link href={`/projects?${params.toString()}`} className="inline-flex items-center gap-1 hover:text-gray-800">
        {label}
        {active && <span aria-hidden>{ascending ? "▲" : "▼"}</span>}
      </Link>
    </th>
  );
}

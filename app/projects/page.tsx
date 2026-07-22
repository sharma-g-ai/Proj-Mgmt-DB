import Link from "next/link";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { ProjectRow } from "@/components/projects/ProjectRow";
import type { ProjectMetrics, LookupOption } from "@/lib/types";

type SearchParams = {
  status?: string;
  priority?: string;
  type?: string;
  lead?: string;
  archived?: string;
  sort?: string;
  dir?: string;
};

const SORTABLE = new Set(["project_name", "status_label", "pct_completion"]);

type TeamOption = { user_id: string; name: string };

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
    : "project_name";
  const ascending = searchParams.dir !== "desc";

  // Build the RLS-scoped, filtered project query off the metrics view.
  let query = supabase.from("project_metrics").select("*");
  if (!showArchived) query = query.eq("is_archived", false);
  if (searchParams.status) query = query.eq("status_id", searchParams.status);
  if (searchParams.priority) query = query.eq("priority", searchParams.priority);
  if (searchParams.type) query = query.eq("project_type_id", searchParams.type);
  if (isAdmin && searchParams.lead) query = query.eq("manager_lead_id", searchParams.lead);

  const { data: projects } = await query.order(sort, { ascending, nullsFirst: false });
  const rows = (projects ?? []) as ProjectMetrics[];

  // Team members per visible project, for the inline quick-add hours form (RLS-scoped).
  // Organizational entries have no roster requirement — any active user can be
  // logged for (Spec 05 §4.3 addendum) — so they get the full active-user list.
  const ids = rows.map((r) => r.project_id);
  const orgIds = new Set(rows.filter((r) => r.is_organizational).map((r) => r.project_id));
  const teamByProject = new Map<string, TeamOption[]>();
  if (ids.length) {
    const nonOrgIds = ids.filter((id) => !orgIds.has(id));
    const [{ data: tm }, { data: allUsers }] = await Promise.all([
      nonOrgIds.length
        ? supabase.from("project_team_member").select("project_id, user_id, users(full_name)").in("project_id", nonOrgIds)
        : Promise.resolve({ data: [] as unknown[] }),
      orgIds.size
        ? supabase.from("users").select("user_id, full_name").eq("is_active", true).order("full_name")
        : Promise.resolve({ data: [] as { user_id: string; full_name: string }[] }),
    ]);
    for (const m of (tm ?? []) as unknown as {
      project_id: string;
      user_id: string;
      users: { full_name: string } | null;
    }[]) {
      const list = teamByProject.get(m.project_id) ?? [];
      if (!list.some((x) => x.user_id === m.user_id)) {
        list.push({ user_id: m.user_id, name: m.users?.full_name ?? "Unknown (pending user)" });
      }
      teamByProject.set(m.project_id, list);
    }
    if (allUsers?.length) {
      const orgOptions = allUsers.map((u) => ({ user_id: u.user_id, name: u.full_name }));
      for (const id of Array.from(orgIds)) teamByProject.set(id, orgOptions);
    }
  }

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

  const colSpan = isAdmin ? 6 : 5;

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <Link
            href="/projects/new"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
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
                <th className="px-4 py-2 font-medium">Type</th>
                <SortHeader label="Status" col="status_label" sp={searchParams} sort={sort} ascending={ascending} />
                {isAdmin && <th className="px-4 py-2 font-medium">Manager/Lead</th>}
                <SortHeader label="% Complete" col="pct_completion" sp={searchParams} sort={sort} ascending={ascending} />
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-gray-500">
                    No projects match.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <ProjectRow
                  key={p.project_id}
                  isAdmin={isAdmin}
                  teamOptions={teamByProject.get(p.project_id) ?? []}
                  project={{
                    project_id: p.project_id,
                    project_name: p.project_name,
                    project_type_label: p.project_type_label,
                    status_label: p.status_label,
                    manager_lead_name: p.manager_lead_name,
                    pct_completion: p.pct_completion,
                    is_archived: p.is_archived,
                    is_organizational: p.is_organizational,
                  }}
                />
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

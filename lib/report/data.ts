import type { SupabaseClient } from "@supabase/supabase-js";
import { addWeeks, mondayOf, round1 } from "@/lib/format";
import type { ProjectMetrics } from "@/lib/types";
import type {
  ReportData,
  ReportTeamRow,
  ReportHoursRow,
  ReportProjectRow,
  FinancePerson,
  FinanceHours,
} from "@/lib/report/types";

// Recent-weeks default for the Team Allocation sheet (Spec 08 §3.2).
const RECENT_WEEKS = 12;

// Gathers all report data using the CALLER'S session client, so RLS scopes it to
// exactly what the user may see (Spec 08 §1/§4 — no separate report-layer auth).
export async function gatherReportData(
  supabase: SupabaseClient,
  opts: {
    generatedBy: string;
    isAdmin: boolean;
    projectId?: string | null; // present => single-project scope
    includeArchived: boolean;
    fullHistory: boolean;
  }
): Promise<ReportData> {
  let pq = supabase.from("project_metrics").select("*");
  if (opts.projectId) pq = pq.eq("project_id", opts.projectId);
  if (!opts.includeArchived) pq = pq.eq("is_archived", false);
  const { data: projData } = await pq.order("planned_end_date", { ascending: true, nullsFirst: false });
  const projects = (projData ?? []) as ProjectMetrics[];
  const nameById = new Map(projects.map((p) => [p.project_id, p.project_name]));
  const ids = projects.map((p) => p.project_id);

  let team: ReportTeamRow[] = [];
  let hours: ReportHoursRow[] = [];
  // Per-logged-entry atoms the client pivots per month (admin Finance view).
  const financeHours: FinanceHours[] = [];

  if (ids.length > 0) {
    let tq = supabase
      .from("project_team_member")
      .select("project_id, user_id, allocated_hours, start_date, end_date, users(full_name)")
      .in("project_id", ids)
      .order("start_date", { ascending: false });
    if (!opts.fullHistory) {
      // Allocations still active within the recent window (range overlaps cutoff).
      tq = tq.gte("end_date", addWeeks(mondayOf(new Date()), -RECENT_WEEKS));
    }
    const { data: tRows } = await tq;
    const tList = (tRows ?? []) as unknown as {
      project_id: string;
      user_id: string;
      allocated_hours: number;
      start_date: string;
      end_date: string;
      users: { full_name: string } | null;
    }[];
    team = tList.map((r) => ({
      project_name: nameById.get(r.project_id) ?? "—",
      person: r.users?.full_name ?? "Unknown",
      start_date: r.start_date,
      end_date: r.end_date,
      allocated_hours: round1(r.allocated_hours),
    }));

    const { data: hRows } = await supabase
      .from("hours_log_entry")
      .select("project_id, user_id, hours_logged, start_date, end_date, source, users(full_name)")
      .in("project_id", ids)
      .order("start_date", { ascending: false });
    const hList = (hRows ?? []) as unknown as {
      project_id: string;
      user_id: string;
      hours_logged: number;
      start_date: string;
      end_date: string;
      source: string;
      users: { full_name: string } | null;
    }[];
    hours = hList.map((r) => ({
      project_name: nameById.get(r.project_id) ?? "—",
      person: r.users?.full_name ?? "Unknown",
      start_date: r.start_date,
      end_date: r.end_date,
      hours_logged: r.hours_logged,
      source: r.source,
    }));
    // Finance atoms (admin only): the client pivots logged hours per month.
    if (opts.isAdmin) {
      for (const r of hList) {
        financeHours.push({
          user_id: r.user_id,
          project_name: nameById.get(r.project_id) ?? "—",
          hours_logged: r.hours_logged,
          start_date: r.start_date,
          end_date: r.end_date,
        });
      }
    }
  }

  // Expand to one row per (project × team member); project columns repeat. A
  // project with no members appears once with a placeholder resource so it still
  // shows in the Portfolio view. Grouped by project (projects are already ordered).
  const teamByProject = new Map<string, ReportTeamRow[]>();
  for (const t of team) {
    const list = teamByProject.get(t.project_name);
    if (list) list.push(t);
    else teamByProject.set(t.project_name, [t]);
  }
  const projectRows: ReportProjectRow[] = [];
  for (const p of projects) {
    const members = teamByProject.get(p.project_name) ?? [];
    if (members.length === 0) {
      projectRows.push({ ...p, person: "—", allocated_hours: null });
    } else {
      for (const m of members) {
        projectRows.push({ ...p, person: m.person, allocated_hours: m.allocated_hours });
      }
    }
  }

  // Finance pivot (admin only): the client pivots financeHours (logged entries) per
  // month. We send the directory (all users, incl. bench) so zero rows appear, plus
  // the project-name columns. Role label = the user's designation.
  const financeProjects = projects.map((p) => p.project_name);
  let financePeople: FinancePerson[] = [];
  if (opts.isAdmin) {
    const { data: uRows } = await supabase
      .from("users")
      .select("user_id, full_name, employee_id, designation:designation_option(label)")
      .order("full_name");
    financePeople = ((uRows ?? []) as unknown as {
      user_id: string;
      full_name: string;
      employee_id: string | null;
      designation: { label: string } | null;
    }[]).map((u) => ({
      user_id: u.user_id,
      employee_id: u.employee_id,
      name: u.full_name,
      role_label: u.designation?.label ?? "—",
    }));
  }

  const scopeLabel = opts.projectId
    ? `Project: ${projects[0]?.project_name ?? "—"}`
    : opts.isAdmin
      ? "All Projects — Admin View"
      : "My Projects — Manager-Lead View";

  return {
    generatedBy: opts.generatedBy,
    generatedAt: new Date(),
    scopeLabel,
    projects,
    projectRows,
    team,
    hours,
    finance: [], // computed client-side per month; carried on the export POST
    financePeople,
    financeHours,
    financeProjects,
  };
}

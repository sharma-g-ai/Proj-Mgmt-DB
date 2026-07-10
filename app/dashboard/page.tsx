import Link from "next/link";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { GlanceCards } from "@/components/dashboard/GlanceCards";
import { AllocationHeatmap } from "@/components/dashboard/AllocationHeatmap";
import { ProjectTimeline } from "@/components/dashboard/ProjectTimeline";
import { mondayOf } from "@/lib/format";
import type { ProjectMetrics, AllocationRow } from "@/lib/types";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const { profile } = await requireActiveUser();
  const supabase = createClient();
  const selectedWeek = searchParams.week ?? mondayOf(new Date());

  // Projects and the org-wide committed-hours RPC are independent — run together.
  // (The RPC only needs the week; Spec 07 §2.3 security-definer aggregate.)
  const [{ data: projData }, { data: committedRows }] = await Promise.all([
    supabase
      .from("project_metrics")
      .select("*")
      .eq("is_archived", false)
      .order("planned_end_date", { ascending: true, nullsFirst: false }),
    supabase.rpc("fn_all_person_committed_hours", { p_week: selectedWeek }),
  ]);

  const projects = (projData ?? []) as ProjectMetrics[];
  const projectIds = projects.map((p) => p.project_id);

  // Allocation rows for those projects (RLS scopes to the visible set already).
  const allocations = projectIds.length
    ? (((
        await supabase
          .from("project_team_member")
          .select("allocated_hours, start_date, end_date, user_id, project_id, users(full_name)")
          .in("project_id", projectIds)
      ).data ?? []) as unknown as AllocationRow[])
    : [];

  const committedByUser = new Map<string, number>(
    ((committedRows ?? []) as { user_id: string; committed: number }[]).map((r) => [
      r.user_id,
      Number(r.committed),
    ])
  );

  // Weekly capacity per person shown (for over/under against committed hours).
  const peopleIds = Array.from(new Set(allocations.map((a) => a.user_id)));
  const capacityByUser = new Map<string, number>();
  if (peopleIds.length) {
    const { data: caps } = await supabase
      .from("users")
      .select("user_id, weekly_capacity_hrs")
      .in("user_id", peopleIds);
    for (const c of caps ?? []) capacityByUser.set(c.user_id, Number(c.weekly_capacity_hrs));
  }

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <Link href="/projects" className="text-sm text-gray-500 hover:text-gray-700">
            Manage projects →
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-16 text-center">
            <p className="text-gray-600">No projects visible yet.</p>
            <Link href="/projects/new" className="mt-3 inline-block rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Create your first project
            </Link>
          </div>
        ) : (
          <>
            <SummaryCards projects={projects} />
            <GlanceCards projects={projects} />
            <AllocationHeatmap
              projects={projects}
              allocations={allocations}
              selectedWeek={selectedWeek}
              committedByUser={committedByUser}
              capacityByUser={capacityByUser}
            />
            <ProjectTimeline projects={projects} allocations={allocations} />
          </>
        )}
      </main>
    </div>
  );
}

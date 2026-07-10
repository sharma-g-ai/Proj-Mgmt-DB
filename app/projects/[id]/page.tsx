import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { TeamSection } from "@/components/TeamSection";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PriorityBadge, OverBadge, StatusBadge } from "@/components/Badges";
import { setArchived } from "@/app/projects/actions";
import { fmtPct, fmtHours, fmtDate } from "@/lib/format";
import type { ProjectMetrics, TeamMemberRow, UserOption, Priority } from "@/lib/types";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  // Fetch metrics, members and the people directory in parallel (independent).
  const [{ data: m }, { data: memberData }, { data: allUsers }] = await Promise.all([
    supabase.from("project_metrics").select("*").eq("project_id", params.id).maybeSingle(),
    supabase
      .from("project_team_member")
      .select("assignment_id, user_id, allocated_hours, start_date, end_date, users(full_name, email, weekly_capacity_hrs, is_active)")
      .eq("project_id", params.id)
      .order("start_date", { ascending: true }),
    // All people (resources included) are allocatable, not just login users.
    supabase.from("users").select("user_id, full_name, email").order("full_name"),
  ]);

  if (!m) notFound();
  const project = m as ProjectMetrics;
  const readOnly = project.is_archived;

  const members = (memberData ?? []) as unknown as TeamMemberRow[];

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* Breadcrumb + title + actions */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
            <Link href="/projects" className="hover:text-gray-700">Projects</Link>
            <span>/</span>
            <span className="text-gray-700">{project.project_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{project.project_name}</h1>
              <PriorityBadge priority={project.priority as Priority} />
              {project.is_archived && (
                <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium uppercase text-gray-600">
                  Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${project.project_id}/hours`}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
                Log time
              </Link>
              {!readOnly && (
                <>
                  <Link href={`/projects/${project.project_id}/edit`}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
                    Edit
                  </Link>
                  <ConfirmButton
                    action={setArchived.bind(null, project.project_id, true)}
                    message={`Archive "${project.project_name}"? It becomes read-only.`}
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    Archive
                  </ConfirmButton>
                </>
              )}
              {readOnly && isAdmin && (
                <ConfirmButton
                  action={setArchived.bind(null, project.project_id, false)}
                  message={`Unarchive "${project.project_name}"?`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Unarchive
                </ConfirmButton>
              )}
              {readOnly && !isAdmin && (
                <span className="text-xs text-gray-500">Archived — contact an Admin to unarchive.</span>
              )}
            </div>
          </div>
        </div>

        {/* Overview */}
        <section className="grid grid-cols-1 gap-6 rounded-xl border border-gray-200 bg-white p-5 md:grid-cols-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detail label="Stakeholder" value={project.stakeholder} />
            <Detail label="Type" value={project.project_type_label ?? "—"} />
            <Detail label="Manager/Lead" value={project.manager_lead_name ?? "—"} />
            <Detail label="Status" value={<StatusBadge label={project.status_label} />} />
            <Detail label="Start Date" value={fmtDate(project.start_date)} />
            <Detail label="Planned End" value={fmtDate(project.planned_end_date)} />
            <Detail label="Estimated Effort" value={`${fmtHours(project.estimated_effort_hrs)} hrs`} />
            <Detail label="Working days left" value={String(project.working_days_remaining)} />
            {project.stakeholder_description && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-gray-400">Stakeholder Detail</dt>
                <dd className="mt-0.5 text-gray-700">{project.stakeholder_description}</dd>
              </div>
            )}
            {project.description && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-gray-400">Description</dt>
                <dd className="mt-0.5 whitespace-pre-line text-gray-700">{project.description}</dd>
              </div>
            )}
            {project.status_detail && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-gray-400">Status Detail</dt>
                <dd className="mt-0.5 text-gray-700">{project.status_detail}</dd>
              </div>
            )}
          </dl>

          {/* Calculated fields */}
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Allocation %"
              value={
                <span className={project.allocation_pct && project.allocation_pct > 100 ? "text-amber-600" : ""}>
                  {fmtPct(project.allocation_pct)}
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    {fmtHours(project.planned_hours)}/{fmtHours(project.estimated_effort_hrs)}h
                  </span>
                </span>
              }
            />
            <Stat
              label="% Completion"
              value={
                <span className={project.pct_completion && project.pct_completion > 100 ? "text-red-600" : ""}>
                  {fmtPct(project.pct_completion)}
                  <OverBadge pctCompletion={project.pct_completion} />
                </span>
              }
            />
            <Stat label="Logged Hrs" value={fmtHours(project.logged_hours)} />
            <Stat
              label="Pending Hrs"
              value={
                <span className={project.pending_hours < 0 ? "text-red-600" : ""}>
                  {fmtHours(project.pending_hours)}
                </span>
              }
            />
            <Stat label="Pending %" value={fmtPct(project.pending_pct)} />
          </div>
        </section>

        <TeamSection
          projectId={project.project_id}
          members={members}
          activeUsers={(allUsers ?? []) as UserOption[]}
          defaultStart={project.start_date}
          defaultEnd={project.planned_end_date}
          readOnly={readOnly}
        />
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-gray-800">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

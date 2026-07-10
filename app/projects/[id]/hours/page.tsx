import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { HoursSection } from "@/components/HoursSection";
import type { HoursEntryRow, TeamMemberRow } from "@/lib/types";

export default async function ProjectHoursPage({ params }: { params: { id: string } }) {
  const { profile } = await requireActiveUser();
  const supabase = createClient();

  const [{ data: project }, { data: memberData }, { data: entryData }] = await Promise.all([
    supabase
      .from("project")
      .select("project_id, project_name, is_archived")
      .eq("project_id", params.id)
      .maybeSingle(),
    supabase
      .from("project_team_member")
      .select("assignment_id, user_id, allocated_hours, start_date, end_date, users(full_name, email, weekly_capacity_hrs, is_active)")
      .eq("project_id", params.id),
    supabase
      .from("hours_log_entry")
      .select("entry_id, user_id, hours_logged, entry_date, source, users(full_name, email)")
      .eq("project_id", params.id)
      .order("entry_date", { ascending: false }),
  ]);

  if (!project) notFound();

  const members = (memberData ?? []) as unknown as TeamMemberRow[];
  const entries = (entryData ?? []) as unknown as HoursEntryRow[];

  // Hours can only be logged for this project's team members (Spec 05 §4.3).
  const teamOptions = Array.from(
    new Map(
      members.map((m) => [
        m.user_id,
        { user_id: m.user_id, name: m.users?.full_name ?? "Unknown (pending user)" },
      ])
    ).values()
  );

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
            <Link href="/projects" className="hover:text-gray-700">Projects</Link>
            <span>/</span>
            <Link href={`/projects/${project.project_id}`} className="hover:text-gray-700">
              {project.project_name}
            </Link>
            <span>/</span>
            <span className="text-gray-700">Time log</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Log time — {project.project_name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Record completed hours for people on this project&apos;s team.
          </p>
        </div>

        <HoursSection
          projectId={project.project_id}
          entries={entries}
          teamOptions={teamOptions}
          readOnly={project.is_archived}
        />
      </main>
    </div>
  );
}

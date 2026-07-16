import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { ProjectForm } from "@/components/ProjectForm";
import { updateProject } from "@/app/projects/actions";
import type { LookupOption, UserOption } from "@/lib/types";

export default async function EditProjectPage({ params }: { params: { id: string } }) {
  const { profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  const { data: project } = await supabase
    .from("project")
    .select("*")
    .eq("project_id", params.id)
    .maybeSingle();

  if (!project) notFound();
  // Archived projects are read-only (Spec 05 §4.4).
  if (project.is_archived) redirect(`/projects/${params.id}`);

  const [{ data: types }, { data: statuses }] = await Promise.all([
    supabase.from("project_type_option").select("option_id, label, is_active").eq("is_active", true).order("label"),
    supabase.from("status_option").select("option_id, label, is_active").eq("is_active", true).order("label"),
  ]);

  const leads = isAdmin
    ? ((await supabase
        .from("users")
        .select("user_id, full_name")
        .eq("is_active", true)
        .in("role", ["Admin", "Manager-Lead"])
        .order("full_name")).data ?? [])
    : [];

  const action = updateProject.bind(null, params.id);

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/projects" className="hover:text-gray-700">Projects</Link>
          <span>/</span>
          <Link href={`/projects/${params.id}`} className="hover:text-gray-700">{project.project_name}</Link>
          <span>/</span>
          <span className="text-gray-700">Edit</span>
        </div>
        <h1 className="mb-6 text-xl font-semibold tracking-tight">Edit Project</h1>
        <ProjectForm
          mode="edit"
          action={action}
          types={(types ?? []) as LookupOption[]}
          statuses={(statuses ?? []) as LookupOption[]}
          leads={leads as UserOption[]}
          isAdmin={isAdmin}
          currentUser={{ user_id: profile.user_id, full_name: profile.full_name }}
          initial={{
            project_name: project.project_name,
            stakeholder: project.stakeholder,
            stakeholder_description: project.stakeholder_description,
            description: project.description,
            project_type_id: project.project_type_id,
            priority: project.priority,
            status_id: project.status_id,
            manager_lead_id: project.manager_lead_id,
            start_date: project.start_date,
            planned_end_date: project.planned_end_date,
            estimated_effort_hrs: project.estimated_effort_hrs,
            status_detail: project.status_detail,
            jira_url: project.jira_url,
          }}
          cancelHref={`/projects/${params.id}`}
        />
      </main>
    </div>
  );
}

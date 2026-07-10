import Link from "next/link";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { ProjectForm } from "@/components/ProjectForm";
import { createProject } from "@/app/projects/actions";
import type { LookupOption, UserOption } from "@/lib/types";

export default async function NewProjectPage() {
  const { profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

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

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/projects" className="hover:text-gray-700">Projects</Link>
          <span>/</span>
          <span className="text-gray-700">New</span>
        </div>
        <h1 className="mb-6 text-xl font-semibold tracking-tight">New Project</h1>
        <ProjectForm
          mode="create"
          action={createProject}
          types={(types ?? []) as LookupOption[]}
          statuses={(statuses ?? []) as LookupOption[]}
          leads={leads as UserOption[]}
          isAdmin={isAdmin}
          currentUser={{ user_id: profile.user_id, full_name: profile.full_name }}
          cancelHref="/projects"
        />
      </main>
    </div>
  );
}

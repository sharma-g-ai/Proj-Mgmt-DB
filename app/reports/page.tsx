import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { ReportWorkbook } from "@/components/report/ReportWorkbook";
import { gatherReportData } from "@/lib/report/data";

export default async function ReportsPage() {
  const { profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  // Load the full RLS-scoped dataset once; column filters replace the old
  // scope/archived/full checkboxes (Spec 08). Archived + full history are included
  // so they can be filtered in/out on-page.
  const data = await gatherReportData(supabase, {
    generatedBy: profile.full_name,
    isAdmin,
    projectId: null,
    includeArchived: true,
    fullHistory: true,
  });

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mb-6 text-sm text-gray-500">
          Preview, sort and filter your data below, then export the current view to PDF or XLSX.
          Data is scoped to what you can see —
          {isAdmin ? " all projects." : " the projects you lead."}
        </p>
        <ReportWorkbook
          projects={data.projects}
          projectRows={data.projectRows}
          team={data.team}
          hours={data.hours}
          financePeople={data.financePeople}
          financeHours={data.financeHours}
          financeProjects={data.financeProjects}
          scopeLabel={data.scopeLabel}
          isAdmin={isAdmin}
        />
      </main>
    </div>
  );
}

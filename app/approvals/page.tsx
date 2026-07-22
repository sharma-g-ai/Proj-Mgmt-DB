import { requireAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ApprovalsList } from "@/components/ApprovalsList";
import { getPendingChangeRequests } from "@/app/projects/actions";

export default async function ApprovalsPage() {
  const { profile } = await requireAdmin();
  const requests = await getPendingChangeRequests();

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="mb-6 text-sm text-gray-500">
          Estimated Effort Hrs changes, and any resource-allocation change to a project that&apos;s
          already been staffed once, wait here until you approve or reject them.
        </p>
        <ApprovalsList requests={requests} />
      </main>
    </div>
  );
}

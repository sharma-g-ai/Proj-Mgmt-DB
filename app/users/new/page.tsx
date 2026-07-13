import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { UserForm } from "@/components/UserForm";
import { createUser } from "@/app/users/actions";
import type { LookupOption } from "@/lib/types";

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: { kind?: string };
}) {
  const { profile } = await requireAdmin();
  const supabase = createClient();
  const isResource = searchParams.kind === "resource";

  const { data: designations } = await supabase
    .from("designation_option")
    .select("option_id, label, is_active")
    .eq("is_active", true)
    .order("label");

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/users" className="hover:text-gray-700">Users</Link>
          <span>/</span>
          <span className="text-gray-700">{isResource ? "New Resource" : "New User"}</span>
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          {isResource ? "Add Resource" : "New User"}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {isResource
            ? "Add a non-login resource — allocatable to projects but without app access. Capture their email, employee ID and designation."
            : "Pre-create a profile before the person's first login. Their Google sign-in later links to this record by email — landing them straight into an active account instead of the pending screen."}
        </p>
        <UserForm
          mode="create"
          action={createUser}
          designations={(designations ?? []) as LookupOption[]}
          variant={isResource ? "resource" : "user"}
          initial={{ weekly_capacity_hrs: 40, is_active: !isResource }}
        />
      </main>
    </div>
  );
}

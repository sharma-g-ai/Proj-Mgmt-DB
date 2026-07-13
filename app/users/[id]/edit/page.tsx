import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { UserForm } from "@/components/UserForm";
import { updateUser } from "@/app/users/actions";
import type { LookupOption } from "@/lib/types";

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAdmin();
  const supabase = createClient();

  const [{ data: user }, { data: designations }] = await Promise.all([
    supabase
      .from("users")
      .select("user_id, full_name, email, role, weekly_capacity_hrs, is_active, employee_id, designation_id")
      .eq("user_id", params.id)
      .maybeSingle(),
    supabase
      .from("designation_option")
      .select("option_id, label, is_active")
      .eq("is_active", true)
      .order("label"),
  ]);

  if (!user) notFound();

  const isPending = !user.is_active && user.role === null;
  const action = updateUser.bind(null, params.id);

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/users" className="hover:text-gray-700">Users</Link>
          <span>/</span>
          <span className="text-gray-700">{user.full_name}</span>
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          {isPending ? "Activate User" : "Edit User"}
        </h1>
        {isPending && (
          <p className="mb-6 text-sm text-amber-600">
            This user signed in and is awaiting activation. Assign an access level and check
            &ldquo;Active&rdquo; to grant access.
          </p>
        )}
        <UserForm
          mode="edit"
          action={action}
          designations={(designations ?? []) as LookupOption[]}
          initial={{
            full_name: user.full_name,
            email: user.email,
            role: user.role,
            weekly_capacity_hrs: user.weekly_capacity_hrs,
            is_active: user.is_active,
            employee_id: user.employee_id,
            designation_id: user.designation_id,
          }}
        />
      </main>
    </div>
  );
}

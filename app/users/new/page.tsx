import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { UserForm } from "@/components/UserForm";
import { createUser } from "@/app/users/actions";

export default async function NewUserPage() {
  const { profile } = await requireAdmin();

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/users" className="hover:text-gray-700">Users</Link>
          <span>/</span>
          <span className="text-gray-700">New</span>
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">New User</h1>
        <p className="mb-6 text-sm text-gray-500">
          Pre-create a profile before the person&apos;s first login. Their Google sign-in
          later links to this record by email — landing them straight into an active
          account instead of the pending screen.
        </p>
        <UserForm mode="create" action={createUser} initial={{ weekly_capacity_hrs: 40, is_active: true }} />
      </main>
    </div>
  );
}

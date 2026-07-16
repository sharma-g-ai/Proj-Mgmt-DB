import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { UsersTable } from "@/components/UsersTable";
import type { UserRow } from "@/lib/types";

type SearchParams = { role?: string; status?: string };
type Status = "Active" | "Pending" | "Deactivated";

function userStatus(u: { is_active: boolean; role: string | null }): Status {
  if (u.is_active) return "Active";
  return u.role === null ? "Pending" : "Deactivated";
}

// Pending first (needs action), then Active, then Deactivated.
const statusOrder: Record<Status, number> = { Pending: 0, Active: 1, Deactivated: 2 };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAdmin();
  const supabase = createClient();

  const { data } = await supabase
    .from("users")
    .select("user_id, full_name, email, role, weekly_capacity_hrs, is_active, employee_id, designation:designation_option(label)")
    .order("full_name");

  let users = (data ?? []) as unknown as UserRow[];
  if (searchParams.role) users = users.filter((u) => u.role === searchParams.role);
  if (searchParams.status)
    users = users.filter((u) => userStatus(u) === searchParams.status);

  users = users.sort(
    (a, b) =>
      statusOrder[userStatus(a)] - statusOrder[userStatus(b)] ||
      a.full_name.localeCompare(b.full_name)
  );

  const pendingCount = (data ?? []).filter((u) => userStatus(u) === "Pending").length;

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Users</h1>
            {pendingCount > 0 && (
              <p className="mt-1 text-sm text-amber-600">
                {pendingCount} pending user{pendingCount === 1 ? "" : "s"} awaiting activation.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/users/designations" className="px-2 py-1.5 text-sm text-gray-500 hover:text-brand-700">
              Manage designations
            </Link>
            <Link href="/users/new"
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              + New User
            </Link>
          </div>
        </div>

        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Filter name="role" label="Access" value={searchParams.role}
            options={["Admin", "Manager-Lead"]} />
          <Filter name="status" label="Status" value={searchParams.status}
            options={["Active", "Pending", "Deactivated"]} />
          <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            Apply
          </button>
          <Link href="/users" className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            Clear
          </Link>
        </form>

        <UsersTable users={users} />
      </main>
    </div>
  );
}

function Filter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-500">
      {label}
      <select name={name} defaultValue={value ?? ""}
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

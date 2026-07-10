import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import type { Profile } from "@/lib/types";

type SearchParams = { role?: string; status?: string };
type Status = "Active" | "Pending" | "Deactivated";

function userStatus(u: { is_active: boolean; role: string | null }): Status {
  if (u.is_active) return "Active";
  return u.role === null ? "Pending" : "Deactivated";
}

const statusStyles: Record<Status, string> = {
  Active: "bg-green-50 text-green-700 ring-green-600/20",
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Deactivated: "bg-gray-100 text-gray-500 ring-gray-500/20",
};

// Pending first (needs action), then Active, then Deactivated.
const statusOrder: Record<Status, number> = { Pending: 0, Active: 1, Deactivated: 2 };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAdmin();
  const supabase = createClient();

  const { data } = await supabase
    .from("users")
    .select("user_id, full_name, email, role, weekly_capacity_hrs, is_active")
    .order("full_name");

  let users = (data ?? []) as Profile[];
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
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Users</h1>
            {pendingCount > 0 && (
              <p className="mt-1 text-sm text-amber-600">
                {pendingCount} pending user{pendingCount === 1 ? "" : "s"} awaiting activation.
              </p>
            )}
          </div>
          <Link href="/users/new"
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
            + New User
          </Link>
        </div>

        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Filter name="role" label="Role" value={searchParams.role}
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

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Full Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Capacity (hrs)</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">No users match.</td>
                </tr>
              )}
              {users.map((u) => {
                const status = userStatus(u);
                return (
                  <tr key={u.user_id} className={status === "Pending" ? "bg-amber-50/40" : ""}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.full_name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600">{u.role ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{u.weekly_capacity_hrs}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/users/${u.user_id}/edit`} className="text-sm text-gray-700 hover:underline">
                        {status === "Pending" ? "Activate" : "Edit"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

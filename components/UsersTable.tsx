"use client";

import { useState } from "react";
import Link from "next/link";
import type { UserRow } from "@/lib/types";

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

// Instant, client-side search over the already-fetched (and role/status GET-filtered)
// user list — narrows by name/email/employee ID as you type, no page reload.
export function UsersTable({ users }: { users: UserRow[] }) {
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? users.filter((u) =>
        [u.full_name, u.email, u.employee_id ?? ""].some((v) => v.toLowerCase().includes(needle))
      )
    : users;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, email, or employee ID…"
        className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800"
      />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Full Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Employee ID</th>
              <th className="px-4 py-2 font-medium">Access</th>
              <th className="px-4 py-2 font-medium">Designation</th>
              <th className="px-4 py-2 font-medium">Capacity (hrs)</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">No users match.</td>
              </tr>
            )}
            {filtered.map((u) => {
              const status = userStatus(u);
              return (
                <tr key={u.user_id} className={status === "Pending" ? "bg-amber-50/40" : ""}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{u.employee_id ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.role ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.designation?.label ?? "—"}</td>
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
    </div>
  );
}

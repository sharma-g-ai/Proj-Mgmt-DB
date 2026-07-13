import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { AddDesignation } from "@/components/AddDesignation";
import { setDesignationActive } from "@/app/users/actions";

type Designation = { option_id: string; label: string; is_active: boolean };

export default async function DesignationsPage() {
  const { profile } = await requireAdmin();
  const supabase = createClient();

  const { data } = await supabase
    .from("designation_option")
    .select("option_id, label, is_active")
    .order("label");
  const designations = (data ?? []) as Designation[];

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/users" className="hover:text-gray-700">Users</Link>
          <span>/</span>
          <span className="text-gray-700">Designations</span>
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Designations</h1>
        <p className="mb-6 text-sm text-gray-500">
          Job titles you can assign to users. Deactivate a title to hide it from the user form
          without affecting people who already have it.
        </p>

        <div className="mb-6">
          <AddDesignation />
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Designation</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {designations.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-gray-500">No designations yet.</td>
                </tr>
              )}
              {designations.map((d) => (
                <tr key={d.option_id} className={d.is_active ? "" : "bg-gray-50/60"}>
                  <td className="px-4 py-3 font-medium text-gray-900">{d.label}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      d.is_active
                        ? "bg-green-50 text-green-700 ring-green-600/20"
                        : "bg-gray-100 text-gray-500 ring-gray-500/20"
                    }`}>
                      {d.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={setDesignationActive.bind(null, d.option_id, !d.is_active)}>
                      <button className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                        {d.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

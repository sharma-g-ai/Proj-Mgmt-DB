"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { logHours, setArchived } from "@/app/projects/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OverBadge, StatusBadge } from "@/components/Badges";
import { fmtPct } from "@/lib/format";

type TeamOption = { user_id: string; name: string };

export type ProjectRowData = {
  project_id: string;
  project_name: string;
  project_type_label: string | null;
  status_label: string | null;
  manager_lead_name: string | null;
  pct_completion: number | null;
  is_archived: boolean;
};

// One Projects-list row: a lean display row plus an expandable quick-add hours form.
// Full hours editing still lives on the project's Hours page.
export function ProjectRow({
  project,
  isAdmin,
  teamOptions,
}: {
  project: ProjectRowData;
  isAdmin: boolean;
  teamOptions: TeamOption[];
}) {
  const readOnly = project.is_archived;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(logHours.bind(null, project.project_id), undefined);
  const today = new Date().toISOString().slice(0, 10);
  const colSpan = isAdmin ? 6 : 5;

  // Collapse once a log succeeds (the list revalidates and % Complete updates).
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <tr className={readOnly ? "bg-gray-50/60" : ""}>
        <td className="px-4 py-3">
          <Link href={`/projects/${project.project_id}`} className="font-medium text-gray-900 hover:underline">
            {project.project_name}
          </Link>
          {readOnly && (
            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
              Archived
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-600">{project.project_type_label ?? "—"}</td>
        <td className="px-4 py-3"><StatusBadge label={project.status_label} /></td>
        {isAdmin && <td className="px-4 py-3 text-gray-600">{project.manager_lead_name ?? "—"}</td>}
        <td className="px-4 py-3 text-gray-600">
          {fmtPct(project.pct_completion)}
          <OverBadge pctCompletion={project.pct_completion} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            {!readOnly && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs hover:bg-gray-50"
              >
                Log hours {open ? "▴" : "▾"}
              </button>
            )}
            {!readOnly ? (
              <ConfirmButton
                action={setArchived.bind(null, project.project_id, true)}
                message={`Archive "${project.project_name}"? It becomes read-only.`}
                className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Archive
              </ConfirmButton>
            ) : isAdmin ? (
              <ConfirmButton
                action={setArchived.bind(null, project.project_id, false)}
                message={`Unarchive "${project.project_name}"?`}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Unarchive
              </ConfirmButton>
            ) : (
              <span className="text-xs text-gray-400">Admin only</span>
            )}
          </div>
        </td>
      </tr>

      {open && !readOnly && (
        <tr className="bg-gray-50/70">
          <td colSpan={colSpan} className="px-4 py-3">
            {teamOptions.length === 0 ? (
              <p className="text-xs text-gray-500">
                Add a team member first — hours can only be logged for this project&apos;s team.{" "}
                <Link href={`/projects/${project.project_id}`} className="underline">
                  Manage team
                </Link>
              </p>
            ) : (
              <form action={formAction} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Person
                  <select name="user_id" required defaultValue=""
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="" disabled>Team member…</option>
                    {teamOptions.map((t) => (
                      <option key={t.user_id} value={t.user_id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Date
                  <input type="date" name="entry_date" required defaultValue={today}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Hours
                  <input type="number" name="hours_logged" required min="0.1" step="0.1"
                    className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
                <button className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                  + Log
                </button>
                {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

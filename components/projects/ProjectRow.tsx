"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { logHours, setArchived } from "@/app/projects/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OverBadge, StatusBadge } from "@/components/Badges";
import { Toast } from "@/components/Toast";
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
  is_organizational: boolean;
};

// One Projects-list row: a lean display row plus an expandable quick-add hours form.
// Full hours editing still lives on the project's Hours page.
export function ProjectRow({
  project,
  isAdmin,
  teamOptions,
  projectHref,
  hideHours,
}: {
  project: ProjectRowData;
  isAdmin: boolean;
  teamOptions: TeamOption[];
  /** Override project link (e.g. InfraOps → InfraSpecs). */
  projectHref?: string;
  /** Hide log-hours / archive controls (InfraOps). */
  hideHours?: boolean;
}) {
  const readOnly = project.is_archived;
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [state, formAction] = useFormState(logHours.bind(null, project.project_id), undefined);
  const today = new Date().toISOString().slice(0, 10);
  const colSpan = isAdmin ? 6 : 5;
  const href = projectHref ?? `/projects/${project.project_id}`;

  // Collapse once a log succeeds (the list revalidates and % Complete updates).
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setToast("Hours logged successfully.");
    }
  }, [state]);

  return (
    <>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <tr className={readOnly ? "bg-gray-50/60" : ""}>
        <td className="px-4 py-3">
          <Link href={href} className="font-medium text-gray-900 hover:underline">
            {project.project_name}
          </Link>
          {readOnly && (
            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
              Archived
            </span>
          )}
          {project.is_organizational && (
            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-700">
              Organizational
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
            {hideHours ? (
              <Link
                href={href}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                InfraSpecs
              </Link>
            ) : (
              <>
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
              </>
            )}
          </div>
        </td>
      </tr>

      {open && !readOnly && !hideHours && (
        <tr className="bg-gray-50/70">
          <td colSpan={colSpan} className="px-4 py-3">
            {teamOptions.length === 0 ? (
              <p className="text-xs text-gray-500">
                Add a team member first — hours can only be logged for this project&apos;s team.{" "}
                <Link href={href} className="underline">
                  Manage team
                </Link>
              </p>
            ) : (
              <form action={formAction} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Person
                  <select name="user_id" required defaultValue=""
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="" disabled>Person…</option>
                    {teamOptions.map((t) => (
                      <option key={t.user_id} value={t.user_id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Start Date
                  <input type="date" name="start_date" required defaultValue={today}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  End Date
                  <input type="date" name="end_date" required defaultValue={today}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Hours
                  <input type="number" name="hours_logged" required min="0.1" step="0.1"
                    className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Category
                  <select name="category" defaultValue="Implementation"
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="Implementation">Implementation</option>
                    <option value="Collaboration">Collaboration</option>
                  </select>
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

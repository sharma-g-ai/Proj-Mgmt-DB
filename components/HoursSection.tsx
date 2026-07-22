"use client";

import { useFormState } from "react-dom";
import { logHours, updateHours, deleteHours } from "@/app/projects/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { round1, businessDays, isWeekend } from "@/lib/format";
import type { HoursEntryRow } from "@/lib/types";

type TeamOption = { user_id: string; name: string };

export function HoursSection({
  projectId,
  entries,
  teamOptions,
  readOnly,
  editableEntries = true,
}: {
  projectId: string;
  entries: HoursEntryRow[];
  teamOptions: TeamOption[];
  readOnly: boolean;
  editableEntries?: boolean;
}) {
  const [state, formAction] = useFormState(logHours.bind(null, projectId), undefined);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">Hours Log</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Start Date</th>
              <th className="px-4 py-2 font-medium">End Date</th>
              <th className="px-4 py-2 font-medium">Hours</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Source</th>
              {!readOnly && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  No hours logged yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <HoursRow key={e.entry_id} projectId={projectId} entry={e} readOnly={readOnly} editableEntries={editableEntries} />
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Person
            <select name="user_id" required defaultValue="" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
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
              className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Category
            <select name="category" defaultValue="Implementation" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="Implementation">Implementation</option>
              <option value="Collaboration">Collaboration</option>
            </select>
          </label>
          <button className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
            + Log Hours
          </button>
          {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
          {teamOptions.length === 0 && (
            <p className="w-full text-xs text-gray-500">
              Add a team member first — hours can only be logged for this project&apos;s team.
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function HoursRow({
  projectId,
  entry,
  readOnly,
  editableEntries,
}: {
  projectId: string;
  entry: HoursEntryRow;
  readOnly: boolean;
  editableEntries: boolean;
}) {
  const [state, formAction] = useFormState(
    updateHours.bind(null, projectId, entry.entry_id),
    undefined
  );
  const name = entry.users?.full_name ?? "Unknown (pending user)";
  const days = businessDays(entry.start_date, entry.end_date);
  const perDay = days > 0 ? round1(entry.hours_logged / days) : 0;
  const weekendWarn = isWeekend(entry.start_date) || isWeekend(entry.end_date);
  // JIRA rows would be read-only once sync exists (Spec 05 §4.3); none at v1.
  // Organizational-entry hours also render read-only for non-admins — editing
  // stays Admin-only there (no "logged by" column to scope to your own).
  const rowReadOnly = readOnly || entry.source === "JIRA" || !editableEntries;

  if (rowReadOnly) {
    return (
      <tr>
        <td className="px-4 py-3">{name}</td>
        <td className="px-4 py-3 text-gray-600">{entry.start_date}</td>
        <td className="px-4 py-3 text-gray-600">{entry.end_date}</td>
        <td className="px-4 py-3 text-gray-600">
          {round1(entry.hours_logged)}{" "}
          <span className="text-xs text-gray-400">({perDay}/d, {days}d)</span>
        </td>
        <td className="px-4 py-3 text-gray-500">{entry.category}</td>
        <td className="px-4 py-3 text-gray-500">{entry.source}</td>
        {!readOnly && <td className="px-4 py-3 text-xs text-gray-400">read-only</td>}
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-4 py-3">{name}</td>
      <td className="px-4 py-2">
        <form id={`h-${entry.entry_id}`} action={formAction} className="contents">
          <input type="date" name="start_date" defaultValue={entry.start_date}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </form>
      </td>
      <td className="px-4 py-2">
        <input form={`h-${entry.entry_id}`} type="date" name="end_date" defaultValue={entry.end_date}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input form={`h-${entry.entry_id}`} type="number" name="hours_logged"
          defaultValue={round1(entry.hours_logged)} min="0.1" step="0.1"
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        <div className="mt-1 text-xs text-gray-400">
          {perDay}/d ({days}d){weekendWarn && <span className="ml-1 text-amber-600">weekend date</span>}
        </div>
      </td>
      <td className="px-4 py-2">
        <select form={`h-${entry.entry_id}`} name="category" defaultValue={entry.category}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="Implementation">Implementation</option>
          <option value="Collaboration">Collaboration</option>
        </select>
      </td>
      <td className="px-4 py-3 text-gray-500">{entry.source}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button form={`h-${entry.entry_id}`}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
            Save
          </button>
          <ConfirmButton
            action={deleteHours.bind(null, projectId, entry.entry_id)}
            message="Delete this hours entry?"
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Delete
          </ConfirmButton>
        </div>
        {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      </td>
    </tr>
  );
}

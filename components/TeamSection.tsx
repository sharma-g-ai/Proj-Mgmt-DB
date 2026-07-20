"use client";

import { useEffect, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { addTeamMember, updateTeamMembers, removeTeamMember, type TeamMemberEdit } from "@/app/projects/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { isWeekend } from "@/lib/format";
import type { TeamMemberRow, UserOption } from "@/lib/types";

type Edit = { start_date: string; end_date: string; allocated_hours: number };

function toEdit(m: TeamMemberRow): Edit {
  return { start_date: m.start_date, end_date: m.end_date, allocated_hours: m.allocated_hours };
}

export function TeamSection({
  projectId,
  members,
  activeUsers,
  defaultStart,
  defaultEnd,
  readOnly,
}: {
  projectId: string;
  members: TeamMemberRow[];
  activeUsers: UserOption[];
  defaultStart: string;
  defaultEnd: string;
  readOnly: boolean;
}) {
  const [state, formAction] = useFormState(addTeamMember.bind(null, projectId), undefined);

  // Local, per-row edits — reset from the server-fetched members whenever they
  // change (after add/remove/save revalidates the page).
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(members.map((m) => [m.assignment_id, toEdit(m)]))
  );
  useEffect(() => {
    setEdits(Object.fromEntries(members.map((m) => [m.assignment_id, toEdit(m)])));
  }, [members]);

  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = members.filter((m) => {
    const e = edits[m.assignment_id];
    return e && (e.start_date !== m.start_date || e.end_date !== m.end_date || e.allocated_hours !== m.allocated_hours);
  });

  function setEdit(assignmentId: string, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [assignmentId]: { ...prev[assignmentId], ...patch } }));
  }

  function handleSave() {
    setSaveError(null);
    const updates: TeamMemberEdit[] = dirty.map((m) => ({ assignment_id: m.assignment_id, ...edits[m.assignment_id] }));
    startSaving(async () => {
      const res = await updateTeamMembers(projectId, updates);
      if (res.error) setSaveError(res.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">Team &amp; Allocation</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Man-hours are spread across weekdays (Mon–Fri) in the range.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">End</th>
              <th className="px-4 py-2 font-medium">Man-hours</th>
              {!readOnly && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No team members yet.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <MemberRow
                key={m.assignment_id}
                projectId={projectId}
                member={m}
                edit={edits[m.assignment_id] ?? toEdit(m)}
                onChange={(patch) => setEdit(m.assignment_id, patch)}
                readOnly={readOnly}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && dirty.length > 0 && (
        <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save Changes (${dirty.length})`}
          </button>
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        </div>
      )}

      {!readOnly && (
        <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Person
            <select name="user_id" required defaultValue="" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="" disabled>Select person…</option>
              {activeUsers.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.full_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Start
            <input type="date" name="start_date" required defaultValue={defaultStart}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            End
            <input type="date" name="end_date" required defaultValue={defaultEnd}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Man-hours
            <input type="number" name="allocated_hours" required min="0.5" step="0.5"
              className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <button className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
            + Add
          </button>
          {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
        </form>
      )}
    </section>
  );
}

function MemberRow({
  projectId,
  member,
  edit,
  onChange,
  readOnly,
}: {
  projectId: string;
  member: TeamMemberRow;
  edit: Edit;
  onChange: (patch: Partial<Edit>) => void;
  readOnly: boolean;
}) {
  const name = member.users?.full_name ?? "Unknown (pending user)";
  const weekendWarn = isWeekend(edit.start_date) || isWeekend(edit.end_date);

  if (readOnly) {
    return (
      <tr>
        <td className="px-4 py-3">{name}</td>
        <td className="px-4 py-3 text-gray-600">{member.start_date}</td>
        <td className="px-4 py-3 text-gray-600">{member.end_date}</td>
        <td className="px-4 py-3 text-gray-600">{member.allocated_hours}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-4 py-3">{name}</td>
      <td className="px-4 py-2">
        <input type="date" value={edit.start_date} onChange={(e) => onChange({ start_date: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input type="date" value={edit.end_date} onChange={(e) => onChange({ end_date: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input type="number" value={edit.allocated_hours} min="0.5" step="0.5"
          onChange={(e) => onChange({ allocated_hours: Number(e.target.value) })}
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        {weekendWarn && <span className="ml-1 text-xs text-amber-600">weekend date</span>}
      </td>
      <td className="px-4 py-2">
        <ConfirmButton
          action={removeTeamMember.bind(null, projectId, member.assignment_id)}
          message={`Remove ${name} from this project?`}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          Remove
        </ConfirmButton>
      </td>
    </tr>
  );
}

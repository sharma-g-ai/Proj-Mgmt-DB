"use client";

import { useFormState } from "react-dom";
import { addTeamMember, updateTeamMember, removeTeamMember } from "@/app/projects/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHours, round1, businessDays, isWeekend } from "@/lib/format";
import type { TeamMemberRow, UserOption } from "@/lib/types";

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
              <th className="px-4 py-2 font-medium">Per weekday</th>
              {!readOnly && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No team members yet.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <MemberRow key={m.assignment_id} projectId={projectId} member={m} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      </div>

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
          <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">
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
  readOnly,
}: {
  projectId: string;
  member: TeamMemberRow;
  readOnly: boolean;
}) {
  const [state, formAction] = useFormState(
    updateTeamMember.bind(null, projectId, member.assignment_id),
    undefined
  );
  const name = member.users?.full_name ?? "Unknown (pending user)";
  const days = businessDays(member.start_date, member.end_date);
  const perDay = days > 0 ? round1(member.allocated_hours / days) : 0;
  const weekendWarn = isWeekend(member.start_date) || isWeekend(member.end_date);

  if (readOnly) {
    return (
      <tr>
        <td className="px-4 py-3">{name}</td>
        <td className="px-4 py-3 text-gray-600">{member.start_date}</td>
        <td className="px-4 py-3 text-gray-600">{member.end_date}</td>
        <td className="px-4 py-3 text-gray-600">{fmtHours(member.allocated_hours)}</td>
        <td className="px-4 py-3 text-gray-600">{perDay} <span className="text-xs text-gray-400">({days}d)</span></td>
      </tr>
    );
  }

  const fid = `u-${member.assignment_id}`;
  return (
    <tr>
      <td className="px-4 py-3">{name}</td>
      <td className="px-4 py-2">
        <form id={fid} action={formAction} className="contents">
          <input type="date" name="start_date" defaultValue={member.start_date}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </form>
      </td>
      <td className="px-4 py-2">
        <input form={fid} type="date" name="end_date" defaultValue={member.end_date}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input form={fid} type="number" name="allocated_hours"
          defaultValue={round1(member.allocated_hours)} min="0.5" step="0.5"
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-3 text-gray-600">
        {perDay} <span className="text-xs text-gray-400">({days}d)</span>
        {weekendWarn && <span className="ml-1 text-xs text-amber-600">weekend date</span>}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button form={fid} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
            Save
          </button>
          <ConfirmButton
            action={removeTeamMember.bind(null, projectId, member.assignment_id)}
            message={`Remove ${name} from this project?`}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Remove
          </ConfirmButton>
        </div>
        {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      </td>
    </tr>
  );
}

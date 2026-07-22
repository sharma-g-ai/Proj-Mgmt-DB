"use client";

import { useEffect, useState, useTransition } from "react";
import { saveTeamChanges } from "@/app/projects/actions";
import { ReasonModal } from "@/components/ReasonModal";
import { isWeekend } from "@/lib/format";
import type { NewMember, TeamMemberEdit, TeamMemberRow, UserOption } from "@/lib/types";

type Edit = { start_date: string; end_date: string; allocated_hours: number };
type Draft = { tempId: string; user_id: string; start_date: string; end_date: string; allocated_hours: number };

function toEdit(m: TeamMemberRow): Edit {
  return { start_date: m.start_date, end_date: m.end_date, allocated_hours: m.allocated_hours };
}

let draftCounter = 0;
function nextDraftId(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
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
  // Local, per-row edits — reset from the server-fetched members whenever they
  // change (after save/remove revalidates the page).
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(members.map((m) => [m.assignment_id, toEdit(m)]))
  );
  useEffect(() => {
    setEdits(Object.fromEntries(members.map((m) => [m.assignment_id, toEdit(m)])));
  }, [members]);

  // New, not-yet-saved rows — added via "+ Add row", cleared once the batch
  // save succeeds (revalidation brings them back as real `members` rows).
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Existing rows marked for removal — cleared (undoable) locally until Save
  // Changes actually deletes/stages them (Spec 10: removal is gated too).
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  useEffect(() => {
    setPendingRemovals(new Set());
  }, [members]);

  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [needsReason, setNeedsReason] = useState(false);

  const dirty = members.filter((m) => {
    if (pendingRemovals.has(m.assignment_id)) return false;
    const e = edits[m.assignment_id];
    return e && (e.start_date !== m.start_date || e.end_date !== m.end_date || e.allocated_hours !== m.allocated_hours);
  });
  const pendingCount = dirty.length + drafts.length + pendingRemovals.size;

  function setEdit(assignmentId: string, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [assignmentId]: { ...prev[assignmentId], ...patch } }));
  }

  function toggleRemoval(assignmentId: string) {
    setPendingRemovals((prev) => {
      const next = new Set(prev);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  }

  function addDraftRow() {
    setDrafts((prev) => [
      ...prev,
      { tempId: nextDraftId(), user_id: "", start_date: defaultStart, end_date: defaultEnd, allocated_hours: 0 },
    ]);
  }

  function setDraft(tempId: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)));
  }

  function removeDraft(tempId: string) {
    setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
  }

  function handleSave(reason?: string) {
    setSaveError(null);
    setSaveMessage(null);
    const adds: NewMember[] = drafts.map((d) => ({
      user_id: d.user_id,
      start_date: d.start_date,
      end_date: d.end_date,
      allocated_hours: d.allocated_hours,
    }));
    if (adds.some((a) => !a.user_id)) {
      setSaveError("Select a person for every new row.");
      return;
    }
    const updates: TeamMemberEdit[] = dirty.map((m) => ({ assignment_id: m.assignment_id, ...edits[m.assignment_id] }));
    const removes = Array.from(pendingRemovals);
    startSaving(async () => {
      const res = await saveTeamChanges(projectId, adds, updates, removes, reason);
      if (res.needsReason) {
        setNeedsReason(true);
        return;
      }
      setNeedsReason(false);
      if (res.error) setSaveError(res.error);
      else {
        setDrafts([]);
        setPendingRemovals(new Set());
        if (res.message) setSaveMessage(res.message);
      }
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
            {members.length === 0 && drafts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No team members yet.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <MemberRow
                key={m.assignment_id}
                member={m}
                edit={edits[m.assignment_id] ?? toEdit(m)}
                onChange={(patch) => setEdit(m.assignment_id, patch)}
                readOnly={readOnly}
                markedForRemoval={pendingRemovals.has(m.assignment_id)}
                onToggleRemoval={() => toggleRemoval(m.assignment_id)}
              />
            ))}
            {!readOnly &&
              drafts.map((d) => (
                <DraftRow
                  key={d.tempId}
                  draft={d}
                  activeUsers={activeUsers}
                  onChange={(patch) => setDraft(d.tempId, patch)}
                  onRemove={() => removeDraft(d.tempId)}
                />
              ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={addDraftRow}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            + Add row
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={saving}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save Changes (${pendingCount})`}
            </button>
          )}
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saveMessage && <p className="text-sm text-blue-700">{saveMessage}</p>}
        </div>
      )}

      {needsReason && (
        <ReasonModal
          title="Reason for this allocation change"
          pending={saving}
          onCancel={() => setNeedsReason(false)}
          onSubmit={(reason) => handleSave(reason)}
        />
      )}
    </section>
  );
}

function MemberRow({
  member,
  edit,
  onChange,
  readOnly,
  markedForRemoval,
  onToggleRemoval,
}: {
  member: TeamMemberRow;
  edit: Edit;
  onChange: (patch: Partial<Edit>) => void;
  readOnly: boolean;
  markedForRemoval: boolean;
  onToggleRemoval: () => void;
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

  if (markedForRemoval) {
    return (
      <tr className="bg-red-50/40 text-gray-400 line-through">
        <td className="px-4 py-3">{name}</td>
        <td className="px-4 py-3">{member.start_date}</td>
        <td className="px-4 py-3">{member.end_date}</td>
        <td className="px-4 py-3">{member.allocated_hours}</td>
        <td className="px-4 py-2 no-underline">
          <button type="button" onClick={onToggleRemoval}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-white">
            Undo
          </button>
        </td>
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
        <button type="button" onClick={onToggleRemoval}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
          Remove
        </button>
      </td>
    </tr>
  );
}

function DraftRow({
  draft,
  activeUsers,
  onChange,
  onRemove,
}: {
  draft: Draft;
  activeUsers: UserOption[];
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const weekendWarn = isWeekend(draft.start_date) || isWeekend(draft.end_date);
  return (
    <tr className="bg-brand-50/40">
      <td className="px-4 py-2">
        <select value={draft.user_id} onChange={(e) => onChange({ user_id: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="" disabled>Select person…</option>
          {activeUsers.map((u) => (
            <option key={u.user_id} value={u.user_id}>{u.full_name}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <input type="date" value={draft.start_date} onChange={(e) => onChange({ start_date: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input type="date" value={draft.end_date} onChange={(e) => onChange({ end_date: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-4 py-2">
        <input type="number" value={draft.allocated_hours || ""} min="0.5" step="0.5"
          onChange={(e) => onChange({ allocated_hours: Number(e.target.value) })}
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        {weekendWarn && <span className="ml-1 text-xs text-amber-600">weekend date</span>}
      </td>
      <td className="px-4 py-2">
        <button type="button" onClick={onRemove}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
          Discard
        </button>
      </td>
    </tr>
  );
}

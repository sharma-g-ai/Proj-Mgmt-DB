"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { isWeekend } from "@/lib/format";
import type { ActionState, LookupOption, UserOption } from "@/lib/types";

type Initial = {
  project_name?: string;
  stakeholder?: string;
  stakeholder_description?: string | null;
  description?: string | null;
  project_type_id?: string;
  priority?: string;
  status_id?: string;
  manager_lead_id?: string;
  start_date?: string;
  planned_end_date?: string;
  estimated_effort_hrs?: number;
  status_detail?: string | null;
};

export function ProjectForm({
  mode,
  action,
  types,
  statuses,
  leads,
  isAdmin,
  currentUser,
  initial,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  types: LookupOption[];
  statuses: LookupOption[];
  leads: UserOption[];
  isAdmin: boolean;
  currentUser: { user_id: string; full_name: string };
  initial?: Initial;
  cancelHref: string;
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [start, setStart] = useState(initial?.start_date ?? "");
  const [end, setEnd] = useState(initial?.planned_end_date ?? "");
  const dateOrderInvalid = start && end && end < start;
  const startWeekend = start && isWeekend(start);
  const endWeekend = end && isWeekend(end);
  const invalid = Boolean(dateOrderInvalid || startWeekend || endWeekend);

  // Spec 05 §3.2 / §4.1: a non-Admin can only ever be the lead themselves.
  const lockLead = !isAdmin;

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Field label="Project Name" required>
        <input name="project_name" required defaultValue={initial?.project_name}
          className="input" placeholder="e.g. F2MX" />
      </Field>

      <Field label="Stakeholder" required>
        <select name="stakeholder" required defaultValue={initial?.stakeholder ?? ""} className="input">
          <option value="" disabled>Select…</option>
          <option value="Internal">Internal</option>
          <option value="External">External</option>
        </select>
      </Field>

      <Field label="Stakeholder Description">
        <textarea name="stakeholder_description" defaultValue={initial?.stakeholder_description ?? ""} rows={2}
          className="input" placeholder="Who the stakeholder is, context, contacts…" />
      </Field>

      <Field label="Project Description">
        <textarea name="description" defaultValue={initial?.description ?? ""} rows={3}
          className="input" placeholder="What this project is about" />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Project Type" required>
          <select name="project_type_id" required defaultValue={initial?.project_type_id ?? ""} className="input">
            <option value="" disabled>Select…</option>
            {types.map((t) => (
              <option key={t.option_id} value={t.option_id}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Priority" required>
          <select name="priority" required defaultValue={initial?.priority ?? ""} className="input">
            <option value="" disabled>Select…</option>
            {["High", "Medium", "Low"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>

        <Field label="Status" required>
          <select name="status_id" required defaultValue={initial?.status_id ?? ""} className="input">
            <option value="" disabled>Select…</option>
            {statuses.map((s) => (
              <option key={s.option_id} value={s.option_id}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Manager/Lead" required>
          {lockLead ? (
            <>
              <input type="hidden" name="manager_lead_id" value={currentUser.user_id} />
              <input className="input bg-gray-50 text-gray-500" value={currentUser.full_name} disabled />
            </>
          ) : (
            <select name="manager_lead_id" required defaultValue={initial?.manager_lead_id ?? currentUser.user_id} className="input">
              {leads.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.full_name}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Start Date" required error={startWeekend ? "Must be a weekday (no weekends)." : undefined}>
          <input type="date" name="start_date" required value={start}
            onChange={(e) => setStart(e.target.value)} className="input" />
        </Field>

        <Field label="Planned End Date" required
          error={endWeekend ? "Must be a weekday (no weekends)." : dateOrderInvalid ? "Must be on or after Start Date." : undefined}>
          <input type="date" name="planned_end_date" required value={end}
            onChange={(e) => setEnd(e.target.value)} className="input" />
        </Field>
      </div>

      <Field label="Estimated Effort Hrs" required>
        <input type="number" name="estimated_effort_hrs" required min="0.1" step="0.1"
          defaultValue={initial?.estimated_effort_hrs} className="input" placeholder="e.g. 160" />
      </Field>

      {mode === "edit" && (
        <Field label="Status Detail (note)">
          <textarea name="status_detail" defaultValue={initial?.status_detail ?? ""} rows={3}
            className="input" placeholder="Free-text status note" />
        </Field>
      )}

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton disabled={invalid} label={mode === "create" ? "Create Project" : "Save Changes"} />
        <Link href={cancelHref} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </Link>
      </div>

      <style>{`
        .input { width:100%; border:1px solid #d1d5db; border-radius:0.5rem; padding:0.5rem 0.625rem; font-size:0.875rem; }
        .input:focus { outline:2px solid #111827; outline-offset:-1px; }
      `}</style>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

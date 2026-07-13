"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { ActionState, LookupOption } from "@/lib/types";

type Initial = {
  full_name?: string;
  email?: string;
  role?: string | null;
  weekly_capacity_hrs?: number;
  is_active?: boolean;
  employee_id?: string | null;
  designation_id?: string | null;
};

export function UserForm({
  mode,
  action,
  initial,
  designations,
  variant = "user",
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  initial?: Initial;
  designations: LookupOption[];
  variant?: "user" | "resource";
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [role, setRole] = useState(initial?.role ?? "");
  const [active, setActive] = useState(initial?.is_active ?? false);
  const isResource = variant === "resource";
  const activateNeedsRole = active && !role;

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Field label="Full Name" required>
        <input name="full_name" required defaultValue={initial?.full_name} className="input" />
      </Field>

      <Field label="Email" required>
        <input name="email" type="email" required defaultValue={initial?.email}
          className="input" placeholder="name@amzur.com" />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {!isResource && (
          <Field label="Access level" required={active}>
            <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="input">
              <option value="">— None (no access)</option>
              <option value="Manager-Lead">Manager-Lead</option>
              <option value="Admin">Admin</option>
            </select>
          </Field>
        )}

        <Field label="Employee ID" required={isResource}>
          <input name="employee_id" required={isResource} defaultValue={initial?.employee_id ?? ""}
            className="input" placeholder="AMZ/IND/000" />
        </Field>

        <Field label="Designation">
          <select name="designation_id" defaultValue={initial?.designation_id ?? ""} className="input">
            <option value="">— None</option>
            {designations.map((d) => (
              <option key={d.option_id} value={d.option_id}>{d.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Weekly Capacity (Hrs)" required>
          <input type="number" name="weekly_capacity_hrs" required min="0.1" step="0.1"
            defaultValue={initial?.weekly_capacity_hrs ?? 40} className="input" />
        </Field>
      </div>

      {!isResource && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="is_active" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (can sign in and access data)
          </label>
          {activateNeedsRole && (
            <p className="-mt-3 text-xs text-red-600">Assign an access level to activate this user.</p>
          )}
        </>
      )}
      {isResource && (
        <p className="text-xs text-gray-500">
          Resources are allocatable to projects but have no login. Assign access later by editing
          the user.
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton
          disabled={activateNeedsRole}
          label={mode === "create" ? (isResource ? "Add Resource" : "Create User") : "Save Changes"}
        />
        <Link href="/users" className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

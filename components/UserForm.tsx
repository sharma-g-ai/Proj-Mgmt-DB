"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { ActionState } from "@/lib/types";

type Initial = {
  full_name?: string;
  email?: string;
  role?: string | null;
  weekly_capacity_hrs?: number;
  is_active?: boolean;
};

export function UserForm({
  mode,
  action,
  initial,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  initial?: Initial;
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [role, setRole] = useState(initial?.role ?? "");
  const [active, setActive] = useState(initial?.is_active ?? false);
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
        {mode === "edit" ? (
          <input className="input bg-gray-50 text-gray-500" value={initial?.email} disabled />
        ) : (
          <input name="email" type="email" required className="input" placeholder="name@amzur.com" />
        )}
      </Field>
      {mode === "edit" && (
        <p className="-mt-3 text-xs text-gray-400">
          Email is the identity key and can&apos;t be changed here.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Role" required={active}>
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="input">
            <option value="">— Pending (no role)</option>
            <option value="Manager-Lead">Manager-Lead</option>
            <option value="Admin">Admin</option>
          </select>
        </Field>

        <Field label="Weekly Capacity (Hrs)" required>
          <input type="number" name="weekly_capacity_hrs" required min="0.1" step="0.1"
            defaultValue={initial?.weekly_capacity_hrs ?? 40} className="input" />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="is_active" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (can sign in and access data)
      </label>
      {activateNeedsRole && (
        <p className="-mt-3 text-xs text-red-600">Assign a role to activate this user.</p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton
          disabled={activateNeedsRole}
          label={mode === "create" ? "Create User" : "Save Changes"}
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

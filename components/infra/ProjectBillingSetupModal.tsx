"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  addProjectBillingAccount,
  removeProjectBillingAccount,
  saveProjectBillingSetup,
} from "@/app/projects/[id]/infra/actions";
import { HelpTip } from "@/components/HelpTip";
import type { ActionState, ProjectBillingAccount, ProviderOption } from "@/lib/types";

function SaveBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function accountChipLabel(a: ProjectBillingAccount): string {
  if (a.account_name?.trim()) return `${a.account_name.trim()} (${a.account_id})`;
  return a.account_id;
}

/** Blocking first-visit setup: billing tool required; account restriction is optional. */
export function ProjectBillingSetupModal({
  projectId,
  providers,
  initialProviderLabel = "",
  initialEnforce = false,
}: {
  projectId: string;
  providers: ProviderOption[];
  initialProviderLabel?: string;
  initialEnforce?: boolean;
}) {
  const router = useRouter();
  const action = saveProjectBillingSetup.bind(null, projectId);
  const [state, formAction] = useFormState(action, undefined as ActionState);
  // New projects: default On so InfraOps enter account #s for invoice restriction.
  const [enforce, setEnforce] = useState(initialEnforce || true);
  const [accounts, setAccounts] = useState<{ account_id: string; account_name: string }[]>([
    { account_id: "", account_name: "" },
  ]);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-setup-title"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id="billing-setup-title" className="text-base font-semibold text-gray-900">
          Set up project billing
          <HelpTip text="Choose the billing tool. If you add account numbers, invoice uploads for this project are restricted to those accounts." />
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Set the billing tool for this project. Adding account number(s) turns restriction{" "}
          <span className="font-medium">On</span> — only matching invoices are kept.
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              Billing tool <span className="text-red-600">*</span>
              <HelpTip text="Uploads are locked to this tool (e.g. AWS, E2E). Used for reporting columns." />
            </span>
            <input
              name="provider_label"
              list="billing-setup-providers"
              className="input"
              required
              defaultValue={initialProviderLabel}
              placeholder="e.g. AWS, E2E, Atlassian"
            />
            <datalist id="billing-setup-providers">
              {providers.map((p) => (
                <option key={p.provider_id} value={p.label} />
              ))}
            </datalist>
          </label>

          <div className="rounded-lg border border-gray-200 bg-slate-50 px-3 py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="enforce_billing_accounts"
                value="on"
                checked={enforce}
                onChange={(e) => setEnforce(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-brand-500"
              />
              <span className="text-sm">
                <span className="font-medium text-gray-900">
                  Restrict invoices by account number
                  <HelpTip text="On: enter account number + name; uploads must match or they are rejected. Off: tool only — any invoice can be uploaded." />
                </span>
                <span className="mt-0.5 block text-xs text-gray-600">
                  {enforce
                    ? "On — enter account number + name for this project."
                    : "Off — tool only; invoices are not filtered by account."}
                </span>
              </span>
            </label>
          </div>

          {enforce && (
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Accounts <span className="text-red-600">*</span>
                <HelpTip text="Matching uses account number only (trim + case-insensitive). Account name is for display in the UI." />
              </span>
              <div className="space-y-2">
                {accounts.map((row, idx) => (
                  <div key={idx} className="flex flex-wrap gap-2">
                    <input
                      name="account_id"
                      className="input min-w-[10rem] flex-1"
                      value={row.account_id}
                      onChange={(e) => {
                        const next = [...accounts];
                        next[idx] = { ...next[idx], account_id: e.target.value };
                        setAccounts(next);
                      }}
                      placeholder="Account number"
                      required
                    />
                    <input
                      name="account_name"
                      className="input min-w-[10rem] flex-1"
                      value={row.account_name}
                      onChange={(e) => {
                        const next = [...accounts];
                        next[idx] = { ...next[idx], account_name: e.target.value };
                        setAccounts(next);
                      }}
                      placeholder="Account name"
                      required
                    />
                    {accounts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAccounts(accounts.filter((_, i) => i !== idx))}
                        className="rounded-md border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setAccounts([...accounts, { account_id: "", account_name: "" }])
                }
                className="mt-2 text-sm font-medium text-brand-700 hover:underline"
              >
                + Add another account
              </button>
            </div>
          )}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex justify-end">
            <SaveBtn label="Save billing setup" />
          </div>
        </form>
      </div>
    </div>
  );
}

/** Summary strip + edit accounts / change tool after setup. */
export function ProjectBillingSummary({
  projectId,
  providerLabel,
  accounts,
  providers,
  canEdit,
  invoiceCount,
  enforceBillingAccounts,
}: {
  projectId: string;
  providerLabel: string;
  accounts: ProjectBillingAccount[];
  providers: ProviderOption[];
  canEdit: boolean;
  invoiceCount: number;
  enforceBillingAccounts: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [enforce, setEnforce] = useState(enforceBillingAccounts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addAction = addProjectBillingAccount.bind(null, projectId);
  const [addState, addFormAction] = useFormState(addAction, undefined as ActionState);
  const addFormRef = useRef<HTMLFormElement>(null);

  const saveAction = saveProjectBillingSetup.bind(null, projectId);
  const [saveState, saveFormAction] = useFormState(saveAction, undefined as ActionState);

  useEffect(() => {
    if (!editing) setEnforce(enforceBillingAccounts);
  }, [enforceBillingAccounts, editing]);

  useEffect(() => {
    if (addState?.ok) {
      addFormRef.current?.reset();
      router.refresh();
    }
    if (addState?.error) setError(addState.error);
  }, [addState, router]);

  useEffect(() => {
    if (saveState?.ok) {
      setEditing(false);
      router.refresh();
    }
    if (saveState?.error) setError(saveState.error);
  }, [saveState, router]);

  // While editing, summary follows the draft toggle so it doesn’t contradict the checkbox.
  const shownEnforce = editing ? enforce : enforceBillingAccounts;

  function startOrCancelEdit() {
    if (editing) {
      setEditing(false);
      setEnforce(enforceBillingAccounts);
      setError(null);
      return;
    }
    if (
      invoiceCount > 0 &&
      !window.confirm(
        "This project already has invoices. Changing the billing tool or account restriction may affect new uploads. Continue?"
      )
    ) {
      return;
    }
    setEnforce(enforceBillingAccounts);
    setEditing(true);
    setError(null);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Billing binding
            <HelpTip text="Project billing tool and optional account allow-list used when uploading invoices." />
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {shownEnforce
              ? "Account restriction is on — only invoices matching the allow-listed account numbers are kept."
              : "Account restriction is off — any invoice can be uploaded for this tool."}
            {editing && shownEnforce !== enforceBillingAccounts && (
              <span className="ml-1 font-medium text-amber-700">(unsaved)</span>
            )}
          </p>
          <p className="mt-2 text-sm text-gray-800">
            <span className="font-medium">Tool:</span> {providerLabel}
            <HelpTip text="Upload modal locks to this tool." />
          </p>
          <p className="mt-1 text-sm text-gray-800">
            <span className="font-medium">Account restriction:</span>{" "}
            {shownEnforce ? "On" : "Off"}
            <HelpTip text="Toggle this under Edit setup. When on, each account needs a number and a name. Click Save setup to apply." />
          </p>
          {/* Only show allow-list chips when restriction is on (or while editing it on). */}
          {shownEnforce ? (
            accounts.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {accounts.map((a) => (
                  <li
                    key={a.account_row_id}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 ring-1 ring-inset ring-slate-200"
                    title={
                      a.account_name
                        ? `Name: ${a.account_name} · Number: ${a.account_id}`
                        : a.account_id
                    }
                  >
                    {accountChipLabel(a)}
                    {canEdit && !editing && accounts.length > 1 && (
                      <button
                        type="button"
                        disabled={busyId === a.account_row_id}
                        onClick={async () => {
                          setBusyId(a.account_row_id);
                          setError(null);
                          const res = await removeProjectBillingAccount(
                            projectId,
                            a.account_row_id
                          );
                          setBusyId(null);
                          if (res?.error) setError(res.error);
                          else router.refresh();
                        }}
                        className="text-slate-500 hover:text-red-700 disabled:opacity-50"
                        aria-label={`Remove ${a.account_id}`}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                Restriction is on — add at least one account under Edit setup.
              </p>
            )
          ) : null}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={startOrCancelEdit}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            {editing ? "Cancel" : "Edit setup"}
          </button>
        )}
      </div>

      {canEdit && !editing && enforceBillingAccounts && (
        <form ref={addFormRef} action={addFormAction} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[10rem] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              Account number
              <HelpTip text="Must match the account number extracted from invoices." />
            </span>
            <input name="account_id" required className="input" placeholder="Account number" />
          </label>
          <label className="min-w-[10rem] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              Account name
              <HelpTip text="Display label only (e.g. Prod, Staging). Not used for matching." />
            </span>
            <input name="account_name" required className="input" placeholder="e.g. Prod, Staging" />
          </label>
          <SaveBtn label="Add" />
        </form>
      )}

      {canEdit && editing && (
        <form action={saveFormAction} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              Billing tool
              <HelpTip text="Changing the tool locks future uploads to the new tool." />
            </span>
            <input
              name="provider_label"
              list="billing-edit-providers"
              className="input"
              required
              defaultValue={providerLabel}
            />
            <datalist id="billing-edit-providers">
              {providers.map((p) => (
                <option key={p.provider_id} value={p.label} />
              ))}
            </datalist>
          </label>

          <div className="rounded-lg border border-gray-200 bg-slate-50 px-3 py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="enforce_billing_accounts"
                value="on"
                checked={enforce}
                onChange={(e) => setEnforce(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-brand-500"
              />
              <span className="text-sm">
                <span className="font-medium text-gray-900">
                  Restrict invoices by account number
                  <HelpTip text="Off: upload any invoice. On: reject invoices whose extracted account is missing or not on the allow-list." />
                </span>
              </span>
            </label>
          </div>

          {enforce && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-gray-700">
                Accounts
                <HelpTip text="Each row needs account number + name when restriction is on." />
              </span>
              {accounts.map((a) => (
                <div key={a.account_row_id} className="flex flex-wrap gap-2">
                  <input
                    name="account_id"
                    className="input min-w-[10rem] flex-1"
                    defaultValue={a.account_id}
                    required
                    placeholder="Account number"
                  />
                  <input
                    name="account_name"
                    className="input min-w-[10rem] flex-1"
                    defaultValue={a.account_name ?? ""}
                    required
                    placeholder="Account name"
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <input
                  name="account_id"
                  className="input min-w-[10rem] flex-1"
                  placeholder="Optional extra account number"
                />
                <input
                  name="account_name"
                  className="input min-w-[10rem] flex-1"
                  placeholder="Account name"
                />
              </div>
            </div>
          )}
          <SaveBtn label="Save setup" />
        </form>
      )}

      {(error || addState?.error || saveState?.error) && (
        <p className="mt-2 text-sm text-red-600">
          {error || addState?.error || saveState?.error}
        </p>
      )}
    </section>
  );
}

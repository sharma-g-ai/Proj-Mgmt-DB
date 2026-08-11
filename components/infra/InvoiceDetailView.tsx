"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertModal } from "@/components/AlertModal";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Toast } from "@/components/Toast";
import { ExtractProgressPanel } from "@/components/infra/ExtractProgressPanel";
import {
  confirmInfraInvoiceBilling,
  deleteInfraInvoice,
  extractInfraInvoice,
  parseInfraInvoiceText,
  rejectInfraInvoiceBilling,
  saveInfraInvoiceEdit,
} from "@/app/projects/[id]/infra/actions";
import {
  BILLING_CONFIRM_REASON_KEY,
  payloadNeedsBillingConfirm,
} from "@/lib/infra/billingBinding";
import { lineMatchesScope, type ScopeResource } from "@/lib/infra/discrepancies";
import { normalizeCurrencyCode } from "@/lib/infra/currency";
import { REPORT_CURRENCY } from "@/lib/infra/fxConstants";
import { effectiveInvoiceAmount, resolveInvoiceCurrency } from "@/lib/infra/money";
import { fmtDate, fmtMoney, round1 } from "@/lib/format";
import type {
  ActionState,
  InfraDiscrepancyRow,
  InfraInvoiceLineRow,
  InfraInvoiceRow,
  ProviderOption,
} from "@/lib/types";

type AlertTone = "info" | "success" | "warning" | "error";
type AlertState = { title: string; message: string; tone: AlertTone };

const EDIT_FORM_ID = "invoice-edit-form";

function needsDualCurrency(currency: string | null | undefined): boolean {
  const cur = normalizeCurrencyCode(currency);
  return !!cur && cur !== REPORT_CURRENCY;
}

function toUsd(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  usdRates: Record<string, number>
): number | null {
  if (amount == null || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) return null;
  const cur = normalizeCurrencyCode(currency);
  if (!cur) return null;
  if (cur === REPORT_CURRENCY) return round1(n);
  const rate = usdRates[cur];
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return round1(n * rate);
}

function lineIsOutOfScope(
  line: {
    amount?: number | string | null;
    line_label?: string | null;
    resource_type_label?: string | null;
    attributes?: InfraInvoiceLineRow["attributes"];
  },
  scoped: ScopeResource[]
): boolean {
  const amt = line.amount == null || Number.isNaN(Number(line.amount)) ? 0 : Number(line.amount);
  if (Math.abs(amt) < 0.01) return false;
  return !lineMatchesScope(
    {
      amount: line.amount != null ? Number(line.amount) : null,
      line_label: line.line_label,
      resource_type_label: line.resource_type_label,
      attributes: line.attributes ?? {},
    },
    scoped
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function FormPendingWatcher({ onPendingChange }: { onPendingChange: (pending: boolean) => void }) {
  const { pending } = useFormStatus();
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  return null;
}

function previewKind(mime: string | null | undefined, filename: string | null | undefined) {
  const m = (mime || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (m.includes("pdf") || name.endsWith(".pdf")) return "pdf" as const;
  if (m.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image" as const;
  if (m.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) return "text" as const;
  return "other" as const;
}

export function InvoiceDetailView({
  projectId,
  invoice,
  lines,
  providers,
  scopedResources,
  discrepancies,
  usdRates,
  fileUrl,
  fileError,
  canEdit,
  backHref,
}: {
  projectId: string;
  invoice: InfraInvoiceRow;
  lines: InfraInvoiceLineRow[];
  providers: ProviderOption[];
  scopedResources: ScopeResource[];
  discrepancies: InfraDiscrepancyRow[];
  usdRates: Record<string, number>;
  fileUrl: string | null;
  fileError: string | null;
  canEdit: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const invCur = resolveInvoiceCurrency(invoice);
  const invAmount = effectiveInvoiceAmount(invoice, lines);
  const dual = needsDualCurrency(invCur);
  const totalUsd = toUsd(invAmount, invCur, usdRates);
  const kind = previewKind(invoice.mime_type, invoice.original_filename);
  const oosCount = lines.filter((l) => lineIsOutOfScope(l, scopedResources)).length;
  const openDiscs = discrepancies.filter((d) => d.status === "open");
  const needsBillingConfirm = payloadNeedsBillingConfirm(invoice.extracted_payload);
  const billingConfirmReason =
    typeof invoice.extracted_payload?.[BILLING_CONFIRM_REASON_KEY] === "string"
      ? String(invoice.extracted_payload[BILLING_CONFIRM_REASON_KEY])
      : "This invoice does not match the project billing binding.";

  function handleActionState(state: ActionState) {
    if (!state) return;
    if (state.needsConfirm) {
      setAlert({
        title: "Confirm invoice for this project?",
        message: state.confirmReason || billingConfirmReason,
        tone: "warning",
      });
      router.refresh();
      return;
    }
    if (state.error) {
      setAlert({ title: "Something went wrong", message: state.error, tone: "error" });
      return;
    }
    if (state.warning) {
      setAlert({ title: "Review this invoice", message: state.warning, tone: "warning" });
    }
    if (state.message) setToast(state.message);
    router.refresh();
  }

  async function runExtract() {
    setExtracting(true);
    try {
      const state = await extractInfraInvoice(projectId, invoice.invoice_id);
      handleActionState(state);
    } catch (e) {
      setAlert({
        title: "Extraction failed",
        message: e instanceof Error ? e.message : "Extract failed.",
        tone: "error",
      });
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-5">
      {canEdit && needsBillingConfirm && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Billing confirmation needed</p>
          <p className="mt-1 whitespace-pre-wrap">{billingConfirmReason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={billingBusy}
              onClick={async () => {
                setBillingBusy(true);
                try {
                  const state = await rejectInfraInvoiceBilling(projectId, [
                    invoice.invoice_id,
                  ]);
                  if (state?.error) {
                    setAlert({ title: "Reject failed", message: state.error, tone: "error" });
                  } else {
                    setToast(state?.message || "Invoice rejected and removed.");
                    router.push(`/projects/${projectId}/infra`);
                    router.refresh();
                  }
                } finally {
                  setBillingBusy(false);
                }
              }}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={billingBusy}
              onClick={async () => {
                setBillingBusy(true);
                try {
                  const state = await confirmInfraInvoiceBilling(projectId, [
                    invoice.invoice_id,
                  ]);
                  handleActionState(state);
                } finally {
                  setBillingBusy(false);
                }
              }}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Proceed
            </button>
          </div>
        </div>
      )}

      {extracting && (
        <ExtractProgressPanel
          fileCount={1}
          fileNames={[
            invoice.original_filename || invoice.invoice_number || "invoice",
          ]}
          label="Re-extracting this invoice…"
        />
      )}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-700 ring-1 ring-inset ring-slate-200">
              {invCur ?? "No currency"}
            </span>
            <span className="text-xs text-gray-500">
              {invoice.processing_status === "parsed"
                ? "Extracted"
                : invoice.processing_status === "failed"
                  ? "Extraction failed"
                  : invoice.processing_status}
            </span>
            {oosCount > 0 && (
              <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 ring-1 ring-inset ring-red-200">
                {oosCount} out of scope
              </span>
            )}
            {openDiscs.some((d) => d.discrepancy_type.startsWith("duplicate")) && (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                Duplicate
              </span>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              {(invoice.processing_status === "failed" ||
                invoice.processing_status === "parsed") && (
                <button
                  type="button"
                  disabled={extracting}
                  onClick={runExtract}
                  className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
                >
                  {extracting
                    ? "Extracting…"
                    : invoice.processing_status === "failed"
                      ? "Retry extract"
                      : "Re-extract"}
                </button>
              )}
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="text-sm text-gray-600 hover:underline"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form={EDIT_FORM_ID}
                    disabled={editPending}
                    className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {editPending ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Edit extracted data
                </button>
              )}
              <ConfirmButton
                action={async () => {
                  const result = await deleteInfraInvoice(projectId, invoice.invoice_id);
                  if (result?.error) {
                    setAlert({ title: "Delete failed", message: result.error, tone: "error" });
                    return;
                  }
                  router.push(backHref);
                }}
                message="Delete this invoice and its file?"
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </ConfirmButton>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Uploaded file</h2>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {invoice.original_filename ?? "Invoice file"}
              </p>
            </div>
            {fileUrl && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Open in new tab
              </a>
            )}
          </div>
          <div className="bg-gray-50 p-4">
            {!fileUrl ? (
              <div className="flex h-[78vh] min-h-[28rem] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 text-center text-sm text-gray-500">
                {fileError || "Preview unavailable."}
              </div>
            ) : kind === "pdf" ? (
              <iframe
                title="Invoice PDF"
                src={fileUrl}
                className="h-[78vh] min-h-[28rem] w-full rounded-xl border border-gray-200 bg-white"
              />
            ) : kind === "image" ? (
              <div className="flex max-h-[78vh] min-h-[28rem] items-start justify-center overflow-auto rounded-xl border border-gray-200 bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl}
                  alt={invoice.original_filename ?? "Invoice"}
                  className="max-h-[76vh] w-auto max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-[78vh] min-h-[28rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-white px-6 text-center">
                <p className="text-sm font-medium text-gray-800">Preview not available</p>
                <p className="text-sm text-gray-500">
                  This file type can’t be previewed in-browser.
                </p>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Download / open file
                </a>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-5">
          {invoice.error_message && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {invoice.error_message}
            </div>
          )}

          {editing && canEdit ? (
            <InvoiceEditForm
              formId={EDIT_FORM_ID}
              projectId={projectId}
              invoice={invoice}
              lines={lines}
              providers={providers}
              amountFallback={invAmount}
              scopedResources={scopedResources}
              onPendingChange={setEditPending}
              onDone={(state) => {
                if (state?.needsConfirm) {
                  setEditing(false);
                  handleActionState(state);
                  return;
                }
                if (state?.error) {
                  setAlert({ title: "Could not save", message: state.error, tone: "error" });
                  return;
                }
                if (state?.ok) {
                  setToast(state.message || "Saved.");
                  if (state.warning) {
                    setAlert({
                      title: "Review this invoice",
                      message: state.warning,
                      tone: "warning",
                    });
                  }
                  setEditing(false);
                  router.refresh();
                }
              }}
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                  <h2 className="text-base font-semibold text-gray-900">Extracted details</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Values pulled from the invoice — edit if extraction missed something.
                  </p>
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2">
                  <Meta label="Invoice #" value={invoice.invoice_number ?? "—"} />
                  <Meta
                    label="Vendor"
                    value={
                      (typeof invoice.extracted_payload?.vendor_name === "string" &&
                        invoice.extracted_payload.vendor_name) ||
                      invoice.provider?.label ||
                      "—"
                    }
                  />
                  <Meta
                    label="Account ID"
                    value={
                      (typeof invoice.extracted_payload?.account_id === "string" &&
                        invoice.extracted_payload.account_id) ||
                      "—"
                    }
                  />
                  <Meta
                    label="Invoice date"
                    value={
                      typeof invoice.extracted_payload?.invoice_date === "string" &&
                      invoice.extracted_payload.invoice_date
                        ? fmtDate(invoice.extracted_payload.invoice_date)
                        : "—"
                    }
                  />
                  <Meta
                    label="Billing period"
                    value={
                      invoice.billing_period_start
                        ? `${fmtDate(invoice.billing_period_start)}${
                            invoice.billing_period_end
                              ? ` – ${fmtDate(invoice.billing_period_end)}`
                              : ""
                          }`
                        : "—"
                    }
                  />
                  <Meta label="Currency" value={invCur ?? invoice.currency ?? "—"} />
                  <Meta
                    label={invCur ? `Amount (${invCur})` : "Amount"}
                    value={fmtMoney(invAmount, invCur)}
                    emphasize
                  />
                  {dual && (
                    <Meta
                      label={`Amount (${REPORT_CURRENCY})`}
                      value={totalUsd == null ? "—" : fmtMoney(totalUsd, REPORT_CURRENCY)}
                      emphasize
                    />
                  )}
                  <Meta label="Billing tool" value={invoice.provider?.label ?? "—"} />
                  <Meta label="Lines" value={String(lines.length)} />
                </div>
              </div>

              <LinesPanel
                lines={lines}
                currency={invCur}
                amountTotal={invAmount}
                usdRates={usdRates}
                scopedResources={scopedResources}
              />
            </>
          )}

          {canEdit && invoice.processing_status === "failed" && (
            <ParseTextForm
              action={parseInfraInvoiceText.bind(null, projectId, invoice.invoice_id)}
              onDone={(state) => {
                if (state?.needsConfirm) {
                  handleActionState(state);
                  return;
                }
                if (state?.error) {
                  setAlert({ title: "Parse failed", message: state.error, tone: "error" });
                  return;
                }
                if (state?.ok) {
                  setToast(state.message || "Parsed.");
                  router.refresh();
                }
              }}
            />
          )}
        </section>
      </div>

      {alert && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          tone={alert.tone}
          onClose={() => setAlert(null)}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function Meta({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-slate-50/80 px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm ${
          emphasize ? "font-semibold tabular-nums text-gray-900" : "text-gray-800"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}

type DraftLine = {
  key: string;
  line_id: string | null;
  line_label: string;
  resource_type_label: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  amount: string;
};

function linesToDraft(lines: InfraInvoiceLineRow[]): DraftLine[] {
  return lines.map((l) => ({
    key: l.line_id,
    line_id: l.line_id,
    line_label: l.line_label ?? "",
    resource_type_label: l.resource_type_label ?? "",
    quantity: l.quantity != null ? String(l.quantity) : "",
    unit: l.unit ?? "",
    unit_cost: l.unit_cost != null ? String(l.unit_cost) : "",
    amount: l.amount != null ? String(l.amount) : "",
  }));
}

function InvoiceEditForm({
  formId,
  projectId,
  invoice,
  lines,
  providers,
  amountFallback,
  scopedResources,
  onPendingChange,
  onDone,
}: {
  formId: string;
  projectId: string;
  invoice: InfraInvoiceRow;
  lines: InfraInvoiceLineRow[];
  providers: ProviderOption[];
  amountFallback: number | null;
  scopedResources: ScopeResource[];
  onPendingChange: (pending: boolean) => void;
  onDone: (state: ActionState) => void;
}) {
  const action = saveInfraInvoiceEdit.bind(null, projectId, invoice.invoice_id);
  const [state, formAction] = useFormState(action, undefined as ActionState);
  const handled = useRef<ActionState>(undefined);

  const showQty = lines.some(
    (l) => l.quantity != null || (typeof l.unit === "string" && l.unit.trim() !== "")
  );
  const showUnitCost = lines.some((l) => l.unit_cost != null);
  const orig = normalizeCurrencyCode(resolveInvoiceCurrency(invoice));
  const amountLabel = orig ? `Amount (${orig})` : "Amount";

  const [draft, setDraft] = useState(() => linesToDraft(lines));
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const linesSig = lines
    .map(
      (l) =>
        `${l.line_id}:${l.line_label ?? ""}:${l.amount ?? ""}:${l.resource_type_label ?? ""}:${l.quantity ?? ""}:${l.unit_cost ?? ""}`
    )
    .join("|");
  const [sourceSig, setSourceSig] = useState(linesSig);
  if (linesSig !== sourceSig) {
    setSourceSig(linesSig);
    setDraft(linesToDraft(lines));
    setDeletedIds([]);
  }

  useEffect(() => {
    if (state && state !== handled.current) {
      handled.current = state;
      onDone(state);
    }
  }, [state, onDone]);

  const payload = invoice.extracted_payload ?? {};
  const vendor = typeof payload.vendor_name === "string" ? payload.vendor_name : "";
  const accountId = typeof payload.account_id === "string" ? payload.account_id : "";
  const invoiceDate =
    typeof payload.invoice_date === "string" ? payload.invoice_date.slice(0, 10) : "";

  function updateRow(key: string, patch: Partial<DraftLine>) {
    setDraft((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(row: DraftLine) {
    if (row.line_id) {
      setDeletedIds((ids) => (ids.includes(row.line_id!) ? ids : [...ids, row.line_id!]));
    }
    setDraft((rows) => rows.filter((r) => r.key !== row.key));
  }

  function addRow() {
    setDraft((rows) => [
      ...rows,
      {
        key: `new-${crypto.randomUUID()}`,
        line_id: null,
        line_label: "",
        resource_type_label: "",
        quantity: "",
        unit: "",
        unit_cost: "",
        amount: "",
      },
    ]);
  }

  return (
    <form id={formId} action={formAction} className="space-y-5">
      <FormPendingWatcher onPendingChange={onPendingChange} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify({
          deleted_ids: deletedIds,
          lines: draft.map((r) => ({
            line_id: r.line_id,
            line_label: r.line_label,
            resource_type_label: r.resource_type_label,
            quantity: showQty ? r.quantity : "",
            unit: showQty ? r.unit : "",
            unit_cost: showUnitCost ? r.unit_cost : "",
            amount: r.amount,
          })),
        })}
      />

      {state?.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Invoice details</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Correct fields if extraction missed or mismatched the bill.
          </p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Invoice #">
            <input
              name="invoice_number"
              className="input"
              defaultValue={invoice.invoice_number ?? ""}
            />
          </Field>
          <Field label="Vendor">
            <input name="vendor_name" className="input" defaultValue={vendor} />
          </Field>
          <Field label="Account ID">
            <input name="account_id" className="input" defaultValue={accountId} />
          </Field>
          <Field label="Invoice date">
            <input name="invoice_date" type="date" className="input" defaultValue={invoiceDate} />
          </Field>
          <Field label="Period start">
            <input
              name="billing_period_start"
              type="date"
              className="input"
              defaultValue={invoice.billing_period_start ?? ""}
            />
          </Field>
          <Field label="Period end">
            <input
              name="billing_period_end"
              type="date"
              className="input"
              defaultValue={invoice.billing_period_end ?? ""}
            />
          </Field>
          <Field label="Currency">
            <input
              name="currency"
              className="input"
              placeholder="USD"
              defaultValue={invoice.currency ?? ""}
            />
          </Field>
          <Field label="Amount total">
            <input
              name="amount_total"
              type="number"
              step="any"
              min="0"
              className="input"
              defaultValue={
                invoice.amount_total != null
                  ? String(invoice.amount_total)
                  : amountFallback != null
                    ? String(amountFallback)
                    : ""
              }
            />
          </Field>
          <Field label="Billing tool" className="sm:col-span-2">
            <select name="provider_id" className="input" defaultValue={invoice.provider_id ?? ""}>
              <option value="">—</option>
              {providers.map((p) => (
                <option key={p.provider_id} value={p.provider_id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Line items</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Edit rows below. One Save at the top writes details and lines together.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Add line
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Type</th>
                {showQty && (
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Qty</th>
                )}
                {showUnitCost && (
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    Unit{orig ? ` (${orig})` : ""}
                  </th>
                )}
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{amountLabel}</th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {draft.length === 0 ? (
                <tr>
                  <td
                    colSpan={4 + (showQty ? 1 : 0) + (showUnitCost ? 1 : 0)}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    No lines yet.{" "}
                    <button
                      type="button"
                      onClick={addRow}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Add a line
                    </button>
                  </td>
                </tr>
              ) : (
                draft.map((row) => {
                  const oos = lineIsOutOfScope(
                    {
                      line_label: row.line_label,
                      resource_type_label: row.resource_type_label || null,
                      amount: row.amount === "" ? null : Number(row.amount),
                    },
                    scopedResources
                  );
                  return (
                    <tr
                      key={row.key}
                      className={`border-b border-gray-100 last:border-0 ${
                        oos ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-3 py-1.5 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="input min-w-[10rem] flex-1 py-1.5"
                            value={row.line_label}
                            onChange={(e) => updateRow(row.key, { line_label: e.target.value })}
                            required
                          />
                          {oos && (
                            <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 ring-1 ring-inset ring-red-200">
                              Out of scope
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <input
                          className="input py-1.5"
                          value={row.resource_type_label}
                          onChange={(e) =>
                            updateRow(row.key, { resource_type_label: e.target.value })
                          }
                          placeholder="Optional"
                        />
                      </td>
                      {showQty && (
                        <td className="px-3 py-1.5 align-middle">
                          <div className="flex justify-end gap-1">
                            <input
                              type="number"
                              step="any"
                              className="input w-16 py-1.5 text-right"
                              value={row.quantity}
                              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                            />
                            <input
                              className="input w-14 py-1.5"
                              value={row.unit}
                              onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                              placeholder="unit"
                            />
                          </div>
                        </td>
                      )}
                      {showUnitCost && (
                        <td className="px-3 py-1.5 align-middle">
                          <input
                            type="number"
                            step="any"
                            className="input ml-auto block w-24 py-1.5 text-right"
                            value={row.unit_cost}
                            onChange={(e) => updateRow(row.key, { unit_cost: e.target.value })}
                          />
                        </td>
                      )}
                      <td className="px-3 py-1.5 align-middle">
                        <input
                          type="number"
                          step="any"
                          className="input ml-auto block w-28 py-1.5 text-right"
                          value={row.amount}
                          onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                          required
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right align-middle">
                        <button
                          type="button"
                          onClick={() => removeRow(row)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </form>
  );
}

function LinesPanel({
  lines,
  currency,
  amountTotal,
  usdRates,
  scopedResources,
}: {
  lines: InfraInvoiceLineRow[];
  currency: string | null | undefined;
  amountTotal: number | string | null | undefined;
  usdRates: Record<string, number>;
  scopedResources: ScopeResource[];
}) {
  const dual = needsDualCurrency(currency);
  const orig = normalizeCurrencyCode(currency);
  const showQty = lines.some(
    (l) => l.quantity != null || (typeof l.unit === "string" && l.unit.trim() !== "")
  );
  const showUnitCost = lines.some((l) => l.unit_cost != null);
  const labelColSpan = 2 + (showQty ? 1 : 0) + (showUnitCost ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Line items</h2>
        <p className="mt-0.5 text-xs text-gray-500">Amounts extracted from the invoice.</p>
      </div>

      {lines.length === 0 ? (
        <div className="mx-5 my-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-800">No line items extracted</p>
          <p className="mt-1 text-sm text-gray-500">
            Re-extract the file or edit the invoice to add charges.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Type</th>
                {showQty && (
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Qty</th>
                )}
                {showUnitCost && (
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                    Unit{orig ? ` (${orig})` : ""}
                  </th>
                )}
                <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                  Amount{orig ? ` (${orig})` : ""}
                </th>
                {dual && orig && (
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                    Amount ({REPORT_CURRENCY})
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const oos = lineIsOutOfScope(l, scopedResources);
                const usdAmt = toUsd(l.amount, currency, usdRates);
                return (
                  <tr
                    key={l.line_id}
                    className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/80 ${
                      oos ? "bg-red-50/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 align-middle text-gray-900">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span>{l.line_label ?? "—"}</span>
                        {oos && (
                          <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 ring-1 ring-inset ring-red-200">
                            Out of scope
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-gray-700">
                      {l.resource_type_label ?? "—"}
                    </td>
                    {showQty && (
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle tabular-nums text-gray-700">
                        {l.quantity ?? "—"}
                        {l.unit ? ` ${l.unit}` : ""}
                      </td>
                    )}
                    {showUnitCost && (
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle tabular-nums text-gray-700">
                        {fmtMoney(l.unit_cost)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-medium tabular-nums text-gray-900">
                      {fmtMoney(l.amount)}
                    </td>
                    {dual && orig && (
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle tabular-nums text-gray-700">
                        {usdAmt == null ? "—" : fmtMoney(usdAmt)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td
                  colSpan={labelColSpan}
                  className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500"
                >
                  Invoice total
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                  {fmtMoney(amountTotal)}
                </td>
                {dual && orig && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                    {(() => {
                      const usd = toUsd(amountTotal, currency, usdRates);
                      return usd == null ? "—" : fmtMoney(usd);
                    })()}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function ParseTextForm({
  action,
  onDone,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  onDone: (state: ActionState) => void;
}) {
  const [state, formAction] = useFormState(action, undefined as ActionState);
  const handled = useRef<ActionState>(undefined);

  useEffect(() => {
    if (state && state !== handled.current) {
      handled.current = state;
      onDone(state);
    }
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900">Paste invoice text</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          If file extract failed, paste the bill text here and parse again.
        </p>
      </div>
      <div className="space-y-3 p-5">
        {state?.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        <textarea
          name="invoice_text"
          rows={6}
          className="input font-mono text-xs"
          placeholder="Paste invoice text…"
          required
        />
        <div className="flex justify-end">
          <Submit label="Parse text" />
        </div>
      </div>
    </form>
  );
}

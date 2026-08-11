"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertModal } from "@/components/AlertModal";
import { HelpTip } from "@/components/HelpTip";
import { Toast } from "@/components/Toast";
import {
  ExtractProgressPanel,
  FormExtractProgress,
} from "@/components/infra/ExtractProgressPanel";
import {
  uploadInfraInvoice,
  extractInfraInvoice,
  recheckAllInvoiceDiscrepancies,
  confirmInfraInvoiceBilling,
  rejectInfraInvoiceBilling,
} from "@/app/projects/[id]/infra/actions";
import { billingMonthKey } from "@/lib/report/infraBilling";
import { lineMatchesScope, type ScopeResource } from "@/lib/infra/discrepancies";
import {
  BILLING_CONFIRM_REASON_KEY,
  UNSPECIFIED_BILLING_ACCOUNT,
  billingAccountBucket,
  invoiceExtractedAccountId,
  payloadNeedsBillingConfirm,
} from "@/lib/infra/billingBinding";
import { normalizeCurrencyCode } from "@/lib/infra/currency";
import { REPORT_CURRENCY } from "@/lib/infra/fxConstants";
import { effectiveInvoiceAmount, resolveInvoiceCurrency } from "@/lib/infra/money";
import { fmtDate, fmtMoney, fmtMonthLabel, round1 } from "@/lib/format";
import type {
  ActionState,
  InfraDiscrepancyRow,
  InfraInvoiceLineRow,
  InfraInvoiceRow,
  InfraResourceRow,
  ProjectBillingAccount,
  ProviderOption,
} from "@/lib/types";

const DUP_TYPES = new Set(["duplicate_invoice_number", "duplicate_billing_period"]);

type AlertTone = "info" | "success" | "warning" | "error";
type AlertState = { title: string; message: string; tone: AlertTone };

function toUsd(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  usdRates: Record<string, number>
): number | null {
  if (amount == null || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) return null;
  // Never invent USD when currency is unknown.
  const cur = normalizeCurrencyCode(currency);
  if (!cur) return null;
  if (cur === REPORT_CURRENCY) return round1(n);
  const rate = usdRates[cur];
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return round1(n * rate);
}

/** Compact total for list rows: original · USD when dual, else single currency. */
function fmtMoneyBoth(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  usdRates: Record<string, number>
): string {
  const cur = normalizeCurrencyCode(currency);
  if (!cur) return fmtMoney(amount, null);
  if (cur === REPORT_CURRENCY) return fmtMoney(amount, REPORT_CURRENCY);
  const original = fmtMoney(amount, cur);
  const usd = toUsd(amount, cur, usdRates);
  if (usd == null) return original;
  return `${original} · ${fmtMoney(usd, REPORT_CURRENCY)}`;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {pending ? "Extracting…" : label}
    </button>
  );
}

function StatusPill({
  children,
  tone = "red",
}: {
  children: React.ReactNode;
  tone?: "red" | "amber" | "sky";
}) {
  const cls =
    tone === "amber"
      ? "bg-amber-50 text-amber-900 ring-amber-200"
      : tone === "sky"
        ? "bg-sky-50 text-sky-900 ring-sky-200"
        : "bg-red-50 text-red-800 ring-red-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}

function PillButton({
  children,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  tone?: "red" | "amber" | "sky";
  onClick: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      className="inline-flex cursor-pointer"
    >
      <StatusPill tone={tone}>{children}</StatusPill>
    </span>
  );
}

function lineIsOutOfScope(
  line: InfraInvoiceLineRow,
  scoped: ScopeResource[]
): boolean {
  const amt = line.amount == null || Number.isNaN(Number(line.amount)) ? 0 : Number(line.amount);
  if (Math.abs(amt) < 0.01) return false;
  // Empty InfraSpecs inventory → every charged line is out of scope.
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

type BillingConfirmState = {
  invoiceIds: string[];
  reason: string;
  files: string[];
};

export function InfraInvoicesSection({
  projectId,
  invoices,
  linesByInvoice,
  discrepanciesByInvoice = {},
  resources,
  projectProviderLabel = null,
  billingSetupComplete = true,
  billingAccounts = [],
  usdRates = { USD: 1 },
  canEdit,
}: {
  projectId: string;
  invoices: InfraInvoiceRow[];
  linesByInvoice: Record<string, InfraInvoiceLineRow[]>;
  discrepanciesByInvoice?: Record<string, InfraDiscrepancyRow[]>;
  resources: InfraResourceRow[];
  /** Kept for callers; upload tool is locked to project billing setup. */
  providers?: ProviderOption[];
  projectProviderLabel?: string | null;
  billingSetupComplete?: boolean;
  billingAccounts?: ProjectBillingAccount[];
  /** Live ISO→USD multipliers (from Google Finance / ECB). */
  usdRates?: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | "all">("all");
  const [rechecking, setRechecking] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [billingConfirm, setBillingConfirm] = useState<BillingConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [autoExtractProgress, setAutoExtractProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  } | null>(null);
  const autoExtractKey = useRef<string>("");
  const pendingConfirmWarned = useRef(false);
  const pendingOosAfterConfirm = useRef(0);

  function showAlert(next: AlertState) {
    setAlert(next);
  }

  function openBillingConfirm(state: ActionState) {
    if (!state?.needsConfirm || !state.confirmInvoiceIds?.length) return;
    setBillingConfirm({
      invoiceIds: state.confirmInvoiceIds,
      reason: state.confirmReason || "This invoice does not match the project billing binding.",
      files: state.confirmFiles ?? [],
    });
  }

  function showOutOfScopeNotice(count: number) {
    if (count <= 0) return;
    showAlert({
      title: "Out of scope",
      message: `${count} out-of-scope line(s) in the uploaded invoice(s) — check pills on invoices.`,
      tone: "info",
    });
  }

  function showActionFeedback(state: ActionState) {
    if (!state) return;
    if (state.needsConfirm) {
      openBillingConfirm(state);
      // Defer OOS popup until after Proceed (avoid stacking with confirm modal).
      pendingOosAfterConfirm.current = state.outOfScopeCount ?? 0;
      if (state.error) {
        // Secondary issues (e.g. duplicates in same batch) after confirm dialog.
        setToast(state.error);
      }
      return;
    }
    if (state.error) {
      showAlert({
        title: /duplicate/i.test(state.error) ? "Duplicate not added" : "Something went wrong",
        message: state.error,
        tone: "error",
      });
      // Mixed batch: some uploaded OK — still toast the summary.
      if (state.ok && state.message) setToast(state.message);
      return;
    }
    if (state.outOfScopeCount && state.outOfScopeCount > 0) {
      showOutOfScopeNotice(state.outOfScopeCount);
      if (state.message) setToast(state.message);
      return;
    }
    if (state.warning) {
      showAlert({ title: "Review this invoice", message: state.warning, tone: "warning" });
      return;
    }
    if (state.message) {
      const failed = /fail/i.test(state.message);
      if (failed) {
        showAlert({ title: "Extraction issue", message: state.message, tone: "warning" });
      } else {
        setToast(state.message);
      }
    }
  }

  // Surface invoices already waiting for Proceed/Reject after a previous upload.
  useEffect(() => {
    if (!canEdit || pendingConfirmWarned.current || billingConfirm) return;
    const pending = invoices.filter((inv) =>
      payloadNeedsBillingConfirm(
        inv.extracted_payload && typeof inv.extracted_payload === "object"
          ? (inv.extracted_payload as Record<string, unknown>)
          : null
      )
    );
    if (pending.length === 0) return;
    pendingConfirmWarned.current = true;
    const reasons = pending.map((inv) => {
      const payload =
        inv.extracted_payload && typeof inv.extracted_payload === "object"
          ? (inv.extracted_payload as Record<string, unknown>)
          : {};
      return typeof payload[BILLING_CONFIRM_REASON_KEY] === "string"
        ? String(payload[BILLING_CONFIRM_REASON_KEY])
        : "";
    });
    setBillingConfirm({
      invoiceIds: pending.map((p) => p.invoice_id),
      reason: reasons.filter(Boolean)[0] || "One or more invoices need billing confirmation.",
      files: pending.map((p) => p.original_filename || p.invoice_id.slice(0, 8)),
    });
  }, [billingConfirm, canEdit, invoices]);

  // Auto-extract pending uploads. Reset key on cleanup so React Strict Mode remounts retry.
  useEffect(() => {
    if (!canEdit) return;
    const pending = invoices.filter((i) => i.processing_status === "pending");
    if (pending.length === 0) return;
    const key = pending
      .map((p) => p.invoice_id)
      .sort()
      .join(",");
    if (autoExtractKey.current === key) return;
    autoExtractKey.current = key;
    let cancelled = false;
    (async () => {
      let lastWarning: string | undefined;
      let lastError: string | undefined;
      let anyOk = false;
      let outOfScopeTotal = 0;
      let confirmState: ActionState | undefined;
      const total = pending.length;
      for (let i = 0; i < pending.length; i++) {
        const inv = pending[i];
        if (cancelled) break;
        setAutoExtractProgress({
          current: i + 1,
          total,
          filename: inv.original_filename || inv.invoice_id.slice(0, 8),
        });
        const result = await extractInfraInvoice(projectId, inv.invoice_id);
        if (result?.outOfScopeCount) outOfScopeTotal += result.outOfScopeCount;
        if (result?.needsConfirm) {
          confirmState = {
            needsConfirm: true,
            confirmInvoiceIds: [
              ...(confirmState?.confirmInvoiceIds ?? []),
              ...(result.confirmInvoiceIds ?? []),
            ],
            confirmFiles: [
              ...(confirmState?.confirmFiles ?? []),
              ...(result.confirmFiles ?? []),
            ],
            confirmReason: result.confirmReason || confirmState?.confirmReason,
            outOfScopeCount: outOfScopeTotal > 0 ? outOfScopeTotal : undefined,
          };
          continue;
        }
        if (result?.error) lastError = result.error;
        if (result?.warning) lastWarning = result.warning;
        if (result?.ok) anyOk = true;
      }
      if (cancelled) {
        autoExtractKey.current = "";
        setAutoExtractProgress(null);
        return;
      }
      setAutoExtractProgress(null);
      if (confirmState?.needsConfirm) {
        openBillingConfirm(confirmState);
        pendingOosAfterConfirm.current = outOfScopeTotal;
      } else if (lastError) {
        showAlert({ title: "Extraction failed", message: lastError, tone: "error" });
      } else if (outOfScopeTotal > 0) {
        showOutOfScopeNotice(outOfScopeTotal);
        if (anyOk) setToast("Invoice extracted into month-wise billing.");
      } else if (lastWarning) {
        showAlert({ title: "Review this invoice", message: lastWarning, tone: "warning" });
      } else if (anyOk) {
        setToast("Invoice extracted into month-wise billing.");
      }
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, invoices, projectId, router]);

  const scopedResources: ScopeResource[] = useMemo(
    () =>
      resources.map((r) => ({
        resource_id: r.resource_id,
        name: r.name,
        external_id: r.external_id,
        resource_type_label: r.resource_type?.label ?? null,
      })),
    [resources]
  );

  const { months, byMonth } = useMemo(() => {
    const monthSet = new Set<string>();
    const map = new Map<string, InfraInvoiceRow[]>();
    for (const inv of invoices) {
      const key = billingMonthKey(inv.billing_period_start, inv.billing_period_end) ?? "unknown";
      if (key !== "unknown") monthSet.add(key);
      const list = map.get(key) ?? [];
      list.push(inv);
      map.set(key, list);
    }
    const months = Array.from(monthSet).sort().reverse();
    if (map.has("unknown")) months.push("unknown");
    return { months, byMonth: map };
  }, [invoices]);

  /** Ordered account columns for the by-month sheet (allow-list first, then extras). */
  const accountColumns = useMemo(() => {
    type Col = { key: string; label: string };
    const cols: Col[] = [];
    const seen = new Set<string>();
    for (const a of billingAccounts) {
      const key = billingAccountBucket(a.account_id);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = a.account_name?.trim();
      cols.push({
        key,
        label: name ? `${name} (${a.account_id})` : a.account_id,
      });
    }
    for (const inv of invoices) {
      const extracted = invoiceExtractedAccountId(inv.extracted_payload);
      const key = billingAccountBucket(extracted);
      if (seen.has(key)) continue;
      seen.add(key);
      cols.push({
        key,
        label: extracted?.trim() || UNSPECIFIED_BILLING_ACCOUNT,
      });
    }
    if (cols.length === 0) {
      cols.push({ key: UNSPECIFIED_BILLING_ACCOUNT, label: UNSPECIFIED_BILLING_ACCOUNT });
    }
    return cols;
  }, [billingAccounts, invoices]);

  const splitByAccount = accountColumns.length > 1;

  /** Both copies of a duplicate pair — live match by invoice # or same period+amount. */
  const liveDuplicateIds = useMemo(() => {
    const ids = new Set<string>();
    const EPS = 0.05;
    for (let i = 0; i < invoices.length; i++) {
      const a = invoices[i];
      const aAmt = effectiveInvoiceAmount(a, linesByInvoice[a.invoice_id] ?? []);
      const aNum = a.invoice_number?.trim().toLowerCase();
      for (let j = i + 1; j < invoices.length; j++) {
        const b = invoices[j];
        const bNum = b.invoice_number?.trim().toLowerCase();
        if (aNum && bNum && aNum === bNum) {
          ids.add(a.invoice_id);
          ids.add(b.invoice_id);
          continue;
        }
        if (
          a.billing_period_start &&
          a.billing_period_end &&
          a.billing_period_start === b.billing_period_start &&
          a.billing_period_end === b.billing_period_end
        ) {
          const bAmt = effectiveInvoiceAmount(b, linesByInvoice[b.invoice_id] ?? []);
          if (
            aAmt == null ||
            bAmt == null ||
            Math.abs(Number(aAmt) - Number(bAmt)) <= EPS
          ) {
            ids.add(a.invoice_id);
            ids.add(b.invoice_id);
          }
        }
      }
    }
    return ids;
  }, [invoices, linesByInvoice]);

  const { monthTotalsUsd, monthAccountTotalsUsd, excludedFromUsdCount } = useMemo(() => {
    const totals: Record<string, number> = {};
    const byAccount: Record<string, Record<string, number>> = {};
    let excluded = 0;
    for (const [m, list] of Array.from(byMonth.entries())) {
      totals[m] = 0;
      byAccount[m] = {};
      for (const inv of list) {
        const cur = resolveInvoiceCurrency(inv);
        const amt = effectiveInvoiceAmount(inv, linesByInvoice[inv.invoice_id] ?? []);
        const usd = toUsd(amt, cur, usdRates);
        if (usd == null) {
          if (amt != null && Math.abs(Number(amt)) > 0.009) excluded += 1;
          continue;
        }
        totals[m] += usd;
        const ak = billingAccountBucket(invoiceExtractedAccountId(inv.extracted_payload));
        byAccount[m][ak] = (byAccount[m][ak] ?? 0) + usd;
      }
      totals[m] = round1(totals[m]);
      for (const k of Object.keys(byAccount[m])) {
        byAccount[m][k] = round1(byAccount[m][k]);
      }
    }
    return {
      monthTotalsUsd: totals,
      monthAccountTotalsUsd: byAccount,
      excludedFromUsdCount: excluded,
    };
  }, [byMonth, linesByInvoice, usdRates]);

  /** Shared invoice currency when every invoice uses the same non-USD code (else null). */
  const sharedOrigCurrency = useMemo(() => {
    if (invoices.length === 0) return null;
    const codes = invoices.map((inv) => resolveInvoiceCurrency(inv));
    // Require every invoice to have the same resolvable non-USD currency.
    if (codes.some((c) => !c)) return null;
    const unique = new Set(codes as string[]);
    if (unique.size !== 1) return null;
    const only = Array.from(unique)[0];
    return only !== REPORT_CURRENCY ? only : null;
  }, [invoices]);

  const monthTotalsOrig = useMemo(() => {
    if (!sharedOrigCurrency) return {} as Record<string, number>;
    const totals: Record<string, number> = {};
    for (const [m, list] of Array.from(byMonth.entries())) {
      totals[m] = 0;
      for (const inv of list) {
        const cur = resolveInvoiceCurrency(inv);
        if (cur !== sharedOrigCurrency) continue;
        const n = effectiveInvoiceAmount(inv, linesByInvoice[inv.invoice_id] ?? []) ?? 0;
        totals[m] += n;
      }
      totals[m] = round1(totals[m]);
    }
    return totals;
  }, [byMonth, linesByInvoice, sharedOrigCurrency]);

  const grandTotalUsd = useMemo(
    () => round1(Object.values(monthTotalsUsd).reduce((a, b) => a + b, 0)),
    [monthTotalsUsd]
  );

  const grandTotalOrig = useMemo(() => {
    if (!sharedOrigCurrency) return null;
    return round1(Object.values(monthTotalsOrig).reduce((a, b) => a + b, 0));
  }, [monthTotalsOrig, sharedOrigCurrency]);

  const knownMonths = useMemo(
    () => months.filter((m) => m !== "unknown"),
    [months]
  );

  const monthlyAvgUsd = useMemo(() => {
    if (knownMonths.length === 0) return 0;
    const sum = knownMonths.reduce((acc, m) => acc + (monthTotalsUsd[m] ?? 0), 0);
    return round1(sum / knownMonths.length);
  }, [knownMonths, monthTotalsUsd]);

  const monthlyAvgOrig = useMemo(() => {
    if (!sharedOrigCurrency || knownMonths.length === 0) return null;
    const sum = knownMonths.reduce((acc, m) => acc + (monthTotalsOrig[m] ?? 0), 0);
    return round1(sum / knownMonths.length);
  }, [knownMonths, monthTotalsOrig, sharedOrigCurrency]);

  const showDualSummary = !!sharedOrigCurrency;

  const parsedCount = invoices.filter((i) => i.processing_status === "parsed").length;

  const visibleInvoices = useMemo(() => {
    if (selectedMonth === "all") return invoices;
    return invoices.filter(
      (inv) =>
        (billingMonthKey(inv.billing_period_start, inv.billing_period_end) ?? "unknown") ===
        selectedMonth
    );
  }, [invoices, selectedMonth]);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Billing sheet
            <HelpTip text="Month-wise totals from extracted invoices. When account restriction is on, only allow-listed accounts are accepted on upload." />
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Extracted invoice totals grouped by billing month
          </p>
        </div>
        {canEdit && billingSetupComplete && (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Upload invoices
          </button>
        )}
      </div>

      <div className="space-y-5 p-5">
        {autoExtractProgress && (
          <ExtractProgressPanel
            fileCount={autoExtractProgress.total}
            fileNames={[autoExtractProgress.filename]}
            label={`Extracting ${autoExtractProgress.current} of ${autoExtractProgress.total}…`}
            percent={Math.min(
              95,
              Math.round(
                ((autoExtractProgress.current - 0.35) /
                  Math.max(1, autoExtractProgress.total)) *
                  100
              )
            )}
            stage={autoExtractProgress.filename}
          />
        )}
        {invoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
            <p className="text-sm font-medium text-gray-800">No invoices yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Upload one or more PDFs — we extract period, total, and line items into this sheet.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-4 text-sm font-medium text-brand-700 hover:underline"
              >
                Upload your first invoices
              </button>
            )}
          </div>
        ) : (
          <>
            {excludedFromUsdCount > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {excludedFromUsdCount} invoice{excludedFromUsdCount === 1 ? "" : "s"} excluded
                from USD totals (missing currency or FX).
              </p>
            )}
            {/* Summary strip */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Total billed
                </p>
                {showDualSummary && grandTotalOrig != null ? (
                  <>
                    <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                      {fmtMoney(grandTotalOrig, sharedOrigCurrency)}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums text-gray-600">
                      ≈ {fmtMoney(grandTotalUsd, REPORT_CURRENCY)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                    {fmtMoney(grandTotalUsd, REPORT_CURRENCY)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-gray-100 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Invoices
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                  {invoices.length}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({parsedCount} extracted)
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Monthly avg
                </p>
                {showDualSummary && monthlyAvgOrig != null ? (
                  <>
                    <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                      {fmtMoney(monthlyAvgOrig, sharedOrigCurrency)}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums text-gray-600">
                      ≈ {fmtMoney(monthlyAvgUsd, REPORT_CURRENCY)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                    {fmtMoney(monthlyAvgUsd, REPORT_CURRENCY)}
                  </p>
                )}
              </div>
            </div>

            {/* By month sheet */}
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  By month
                </p>
                {selectedMonth !== "all" && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth("all")}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Show all invoices
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Month</th>
                      {splitByAccount ? (
                        <>
                          {accountColumns.map((col) => (
                            <th
                              key={col.key}
                              className="max-w-[9rem] px-3 py-2.5 font-medium text-right"
                              title={col.label}
                            >
                              <span className="line-clamp-2">{col.label}</span>
                              <span className="mt-0.5 block font-normal normal-case text-gray-400">
                                {REPORT_CURRENCY}
                              </span>
                            </th>
                          ))}
                          <th className="px-4 py-2.5 font-medium text-right">
                            Total ({REPORT_CURRENCY})
                          </th>
                        </>
                      ) : showDualSummary ? (
                        <>
                          <th className="px-4 py-2.5 font-medium text-right">
                            Amount ({sharedOrigCurrency})
                          </th>
                          <th className="px-4 py-2.5 font-medium text-right">
                            Amount ({REPORT_CURRENCY})
                          </th>
                        </>
                      ) : (
                        <th className="px-4 py-2.5 font-medium text-right">
                          Amount ({REPORT_CURRENCY})
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => {
                      const active = selectedMonth === m;
                      return (
                        <tr
                          key={m}
                          onClick={() => setSelectedMonth(active ? "all" : m)}
                          className={`cursor-pointer border-b border-gray-50 last:border-0 ${
                            active ? "bg-slate-100" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-medium text-gray-900">
                            {m === "unknown" ? "Unspecified" : fmtMonthLabel(m)}
                          </td>
                          {splitByAccount ? (
                            <>
                              {accountColumns.map((col) => (
                                <td
                                  key={col.key}
                                  className="px-3 py-2.5 text-right font-medium tabular-nums text-gray-900"
                                >
                                  {fmtMoney(
                                    monthAccountTotalsUsd[m]?.[col.key] ?? 0,
                                    REPORT_CURRENCY
                                  )}
                                </td>
                              ))}
                              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                                {fmtMoney(monthTotalsUsd[m] ?? 0, REPORT_CURRENCY)}
                              </td>
                            </>
                          ) : showDualSummary ? (
                            <>
                              <td className="px-4 py-2.5 text-right font-medium tabular-nums text-gray-900">
                                {fmtMoney(monthTotalsOrig[m] ?? 0, sharedOrigCurrency)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                                {fmtMoney(monthTotalsUsd[m] ?? 0, REPORT_CURRENCY)}
                              </td>
                            </>
                          ) : (
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-gray-900">
                              {fmtMoney(monthTotalsUsd[m] ?? 0, REPORT_CURRENCY)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-50">
                      <td className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                        Total
                      </td>
                      {splitByAccount ? (
                        <>
                          {accountColumns.map((col) => {
                            const sum = round1(
                              months.reduce(
                                (acc, m) => acc + (monthAccountTotalsUsd[m]?.[col.key] ?? 0),
                                0
                              )
                            );
                            return (
                              <td
                                key={col.key}
                                className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900"
                              >
                                {fmtMoney(sum, REPORT_CURRENCY)}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                            {fmtMoney(grandTotalUsd, REPORT_CURRENCY)}
                          </td>
                        </>
                      ) : showDualSummary && grandTotalOrig != null ? (
                        <>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                            {fmtMoney(grandTotalOrig, sharedOrigCurrency)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-700">
                            {fmtMoney(grandTotalUsd, REPORT_CURRENCY)}
                          </td>
                        </>
                      ) : (
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                          {fmtMoney(grandTotalUsd, REPORT_CURRENCY)}
                        </td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Invoice cards — link to detail page */}
            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Invoices
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Open an invoice to view the file, edit details, and manage line items.
                  </p>
                </div>
                {canEdit && invoices.length > 0 ? (
                  <button
                    type="button"
                    disabled={rechecking}
                    onClick={async () => {
                      setRechecking(true);
                      try {
                        const state = await recheckAllInvoiceDiscrepancies(projectId);
                        showActionFeedback(
                          state ?? {
                            ok: true,
                            message: "Invoice scope rechecked against InfraSpecs.",
                          }
                        );
                        router.refresh();
                      } catch (e) {
                        showAlert({
                          title: "Recheck failed",
                          message: e instanceof Error ? e.message : "Could not recheck scope.",
                          tone: "error",
                        });
                      } finally {
                        setRechecking(false);
                      }
                    }}
                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {rechecking ? "Rechecking…" : "Recheck out-of-scope"}
                  </button>
                ) : null}
              </div>
              <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {visibleInvoices.map((inv) => {
                  const month =
                    billingMonthKey(inv.billing_period_start, inv.billing_period_end) ?? "unknown";
                  const lines = linesByInvoice[inv.invoice_id] ?? [];
                  const hasOutOfScope = lines.some((l) =>
                    lineIsOutOfScope(l, scopedResources)
                  );
                  const invDups = (discrepanciesByInvoice[inv.invoice_id] ?? []).filter(
                    (d) => d.status === "open" && DUP_TYPES.has(d.discrepancy_type)
                  );
                  const isDuplicate =
                    invDups.length > 0 || liveDuplicateIds.has(inv.invoice_id);
                  const invCur = resolveInvoiceCurrency(inv);
                  const invAmount = effectiveInvoiceAmount(inv, lines);
                  const curNorm = normalizeCurrencyCode(invCur);
                  const missingFx =
                    !!curNorm &&
                    curNorm !== REPORT_CURRENCY &&
                    (invAmount ?? 0) > 0 &&
                    (usdRates[curNorm] == null ||
                      !Number.isFinite(usdRates[curNorm]) ||
                      usdRates[curNorm]! <= 0);
                  const missingCurrency =
                    inv.processing_status === "parsed" &&
                    !curNorm &&
                    (invAmount ?? 0) > 0;
                  const title =
                    inv.invoice_number ||
                    inv.original_filename ||
                    inv.invoice_id.slice(0, 8);
                  const extracting =
                    inv.processing_status === "pending" ||
                    inv.processing_status === "processing";
                  const needsBillingConfirm = payloadNeedsBillingConfirm(
                    inv.extracted_payload
                  );

                  return (
                    <li key={inv.invoice_id}>
                      <Link
                        href={`/projects/${projectId}/infra/invoices/${inv.invoice_id}`}
                        className="block overflow-hidden rounded-xl border border-gray-200 px-4 py-3 transition hover:border-gray-300 hover:bg-slate-50/50"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium text-gray-900">{title}</span>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-700 ring-1 ring-inset ring-slate-200">
                                {invCur ?? "No currency"}
                              </span>
                              {inv.processing_status === "failed" && (
                                <PillButton
                                  tone="red"
                                  onClick={() =>
                                    showAlert({
                                      title: "Extraction failed",
                                      message:
                                        inv.error_message ||
                                        "Could not extract this invoice. Open it to retry.",
                                      tone: "error",
                                    })
                                  }
                                >
                                  Failed
                                </PillButton>
                              )}
                              {needsBillingConfirm && (
                                <PillButton
                                  tone="amber"
                                  onClick={() => {
                                    const reason =
                                      typeof inv.extracted_payload?.[BILLING_CONFIRM_REASON_KEY] ===
                                      "string"
                                        ? String(inv.extracted_payload[BILLING_CONFIRM_REASON_KEY])
                                        : "Needs Proceed or Reject for project billing match.";
                                    setBillingConfirm({
                                      invoiceIds: [inv.invoice_id],
                                      reason,
                                      files: [
                                        inv.original_filename || inv.invoice_id.slice(0, 8),
                                      ],
                                    });
                                  }}
                                >
                                  Confirm billing
                                </PillButton>
                              )}
                              {isDuplicate && (
                                <PillButton
                                  tone="amber"
                                  onClick={() =>
                                    showAlert({
                                      title: "Duplicate",
                                      message:
                                        invDups.length > 0
                                          ? invDups.map((d) => `• ${d.message}`).join("\n")
                                          : "• Same billing period (or invoice #) as another upload. Delete extras if accidental.",
                                      tone: "warning",
                                    })
                                  }
                                >
                                  Duplicate
                                </PillButton>
                              )}
                              {hasOutOfScope && (
                                <PillButton
                                  onClick={() =>
                                    showAlert({
                                      title: "Out of scope",
                                      message:
                                        scopedResources.length === 0
                                          ? "No InfraSpecs resources yet — charged lines are out of scope until you add matching ones."
                                          : "Some lines don’t match this project’s InfraSpecs resources.",
                                      tone: "warning",
                                    })
                                  }
                                >
                                  Out of scope
                                </PillButton>
                              )}
                              {month === "unknown" && inv.processing_status === "parsed" && (
                                <StatusPill tone="amber">No period</StatusPill>
                              )}
                              {missingCurrency && (
                                <StatusPill tone="amber">No currency</StatusPill>
                              )}
                              {missingFx && <StatusPill tone="sky">No FX</StatusPill>}
                              {extracting && <StatusPill tone="amber">Extracting</StatusPill>}
                            </div>
                            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-gray-500 sm:grid-cols-3">
                              <span>
                                <span className="text-gray-400">Period · </span>
                                {month === "unknown"
                                  ? "Not detected"
                                  : fmtMonthLabel(month)}
                                {inv.billing_period_start && (
                                  <span className="text-gray-400">
                                    {" "}
                                    ({fmtDate(inv.billing_period_start)}
                                    {inv.billing_period_end
                                      ? ` – ${fmtDate(inv.billing_period_end)}`
                                      : ""}
                                    )
                                  </span>
                                )}
                              </span>
                              <span>
                                <span className="text-gray-400">Total · </span>
                                <span className="font-medium tabular-nums text-gray-800">
                                  {fmtMoneyBoth(invAmount, invCur, usdRates)}
                                </span>
                              </span>
                              <span>
                                <span className="text-gray-400">Lines · </span>
                                {lines.length}
                                {inv.provider?.label ? ` · ${inv.provider.label}` : ""}
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 pt-0.5 text-xs font-medium text-brand-700">
                            Open →
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>

      {uploadOpen && canEdit && (
        <UploadInvoiceModal
          projectId={projectId}
          projectProviderLabel={projectProviderLabel}
          onClose={() => setUploadOpen(false)}
          onDone={(state) => {
            setUploadOpen(false);
            showActionFeedback(state);
            router.refresh();
          }}
        />
      )}

      {billingConfirm && (
        <BillingConfirmModal
          reason={billingConfirm.reason}
          files={billingConfirm.files}
          busy={confirmBusy}
          onProceed={async () => {
            setConfirmBusy(true);
            try {
              const state = await confirmInfraInvoiceBilling(
                projectId,
                billingConfirm.invoiceIds
              );
              setBillingConfirm(null);
              pendingConfirmWarned.current = false;
              const deferredOos = pendingOosAfterConfirm.current;
              pendingOosAfterConfirm.current = 0;
              showActionFeedback(state);
              if (deferredOos > 0) showOutOfScopeNotice(deferredOos);
              router.refresh();
            } finally {
              setConfirmBusy(false);
            }
          }}
          onReject={async () => {
            setConfirmBusy(true);
            try {
              const state = await rejectInfraInvoiceBilling(
                projectId,
                billingConfirm.invoiceIds
              );
              setBillingConfirm(null);
              pendingConfirmWarned.current = false;
              pendingOosAfterConfirm.current = 0;
              showActionFeedback(state);
              router.refresh();
            } finally {
              setConfirmBusy(false);
            }
          }}
        />
      )}

      {alert && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          tone={alert.tone}
          onClose={() => setAlert(null)}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </section>
  );
}

function BillingConfirmModal({
  reason,
  files,
  busy,
  onProceed,
  onReject,
}: {
  reason: string;
  files: string[];
  busy: boolean;
  onProceed: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-800">
            !
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">
              Confirm invoice for this project?
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{reason}</p>
            {files.length > 0 && (
              <ul className="mt-2 max-h-28 list-inside list-disc overflow-y-auto text-xs text-gray-600">
                {files.map((f) => (
                  <li key={f} className="truncate">
                    {f}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500">
              Proceed keeps the invoice on this project. Reject deletes the invoice and file.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onReject()}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "Working…" : "Reject"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onProceed()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "Working…" : "Proceed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadInvoiceModal({
  projectId,
  projectProviderLabel,
  onClose,
  onDone,
}: {
  projectId: string;
  projectProviderLabel?: string | null;
  onClose: () => void;
  onDone: (state: ActionState) => void;
}) {
  const uploadAction = uploadInfraInvoice.bind(null, projectId);
  const [state, formAction] = useFormState(uploadAction, undefined as ActionState);
  const seen = useRef<ActionState>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!state || seen.current === state) return;
    seen.current = state;
    if (state.ok || state.error || state.needsConfirm) onDone(state);
  }, [state, onDone]);

  function assignFiles(list: FileList | File[] | null) {
    if (!list || !inputRef.current) return;
    const files = Array.from(list).filter((f) => f.size > 0);
    if (files.length === 0) return;
    const dt = new DataTransfer();
    for (const f of files.slice(0, 20)) dt.items.add(f);
    inputRef.current.files = dt.files;
    setFileNames(Array.from(dt.files).map((f) => f.name));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-white p-5 shadow-lg">
        <form action={formAction} className="relative space-y-3">
          <FormExtractProgress fileCount={fileNames.length} fileNames={fileNames} />
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Upload invoices
              <HelpTip text="Files are saved, extracted, then checked against this project’s billing setup. Duplicates and (when enabled) wrong accounts are rejected." />
            </h3>
            <UploadCloseButton onClose={onClose} />
          </div>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              assignFiles(e.dataTransfer.files);
            }}
            className={`rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm ${
              dragging ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-gray-50"
            }`}
          >
            <p className="font-medium text-gray-800">Drag & drop invoices here</p>
            <p className="mt-1 text-xs text-gray-500">
              Multiple PDF / CSV / TXT / images — up to 20 files for this project’s tool
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 text-sm text-brand-700 underline"
            >
              Browse files
            </button>
            {fileNames.length > 0 && (
              <ul className="mt-3 max-h-28 space-y-0.5 overflow-y-auto text-left text-xs text-gray-600">
                {fileNames.map((name) => (
                  <li key={name} className="truncate">
                    {name}
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={inputRef}
              name="file"
              type="file"
              multiple
              required
              accept=".pdf,.txt,.csv,image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv"
              className="hidden"
              onChange={(e) => assignFiles(e.target.files)}
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Billing tool
              <HelpTip text="Locked to the tool chosen in Billing binding. You cannot pick a different tool at upload." />
            </p>
            <p className="mt-0.5 font-medium text-gray-900">
              {projectProviderLabel || "Not set"}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Locked to this project’s billing setup. If account restriction is on, mismatched
              account numbers are rejected after extract.
            </p>
          </div>
          <UploadFooter
            fileCount={fileNames.length}
            onCancel={onClose}
          />
        </form>
      </div>
    </div>
  );
}

function UploadCloseButton({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onClose}
      disabled={pending}
      className="text-sm text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Close
    </button>
  );
}

function UploadFooter({
  fileCount,
  onCancel,
}: {
  fileCount: number;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <Submit
        label={
          fileCount > 1 ? `Upload & extract ${fileCount}` : "Upload & extract"
        }
      />
    </div>
  );
}

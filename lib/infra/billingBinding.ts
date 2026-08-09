/** Project billing tool + optional account allow-list matching for invoice gate. */

export type BillingBindingCode =
  | "tool_mismatch"
  | "account_mismatch"
  | "account_missing";

export type BillingBindingResult =
  | { ok: true }
  | { ok: false; code: BillingBindingCode; reason: string };

export function normalizeBillingAccount(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function normalizeToolLabel(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Compare extracted invoice identity to project binding.
 * - When `enforceAccounts` is false: always OK (no account restriction).
 * - When true: extracted account must be present and on the project allow-list.
 * Tool id/label is still checked when both sides have values and enforcement is on.
 */
export function matchProjectBillingBinding(input: {
  enforceAccounts?: boolean;
  projectToolLabel: string | null | undefined;
  projectToolId: string | null | undefined;
  allowedAccounts: string[];
  invoiceToolLabel: string | null | undefined;
  invoiceToolId: string | null | undefined;
  extractedAccountId: string | null | undefined;
}): BillingBindingResult {
  if (!input.enforceAccounts) {
    return { ok: true };
  }

  const projectTool = normalizeToolLabel(input.projectToolLabel);
  const invoiceTool = normalizeToolLabel(input.invoiceToolLabel);
  const projectToolId = (input.projectToolId ?? "").trim();
  const invoiceToolId = (input.invoiceToolId ?? "").trim();

  const toolIdMismatch =
    !!projectToolId && !!invoiceToolId && projectToolId !== invoiceToolId;
  const toolLabelMismatch =
    !!projectTool && !!invoiceTool && projectTool !== invoiceTool;

  if (toolIdMismatch || toolLabelMismatch) {
    return {
      ok: false,
      code: "tool_mismatch",
      reason: `Billing tool on this invoice (${input.invoiceToolLabel || "unknown"}) does not match this project’s tool (${input.projectToolLabel || "unset"}).`,
    };
  }

  const extracted = normalizeBillingAccount(input.extractedAccountId);
  if (!extracted) {
    return {
      ok: false,
      code: "account_missing",
      reason:
        "No account number was found on this invoice. Account restriction is on for this project — upload was rejected.",
    };
  }

  const allowed = new Set(
    (input.allowedAccounts ?? [])
      .map((a) => normalizeBillingAccount(a))
      .filter(Boolean)
  );
  if (allowed.size === 0) {
    return {
      ok: false,
      code: "account_missing",
      reason:
        "Account restriction is on, but this project has no billing account numbers configured.",
    };
  }

  if (!allowed.has(extracted)) {
    return {
      ok: false,
      code: "account_mismatch",
      reason: `Account “${input.extractedAccountId?.trim()}” is not in this project’s allow-list (${Array.from(allowed).slice(0, 5).join(", ")}${allowed.size > 5 ? ", …" : ""}). Upload was rejected.`,
    };
  }

  return { ok: true };
}

export const BILLING_CONFIRM_FLAG = "needs_billing_confirm";
export const BILLING_CONFIRM_REASON_KEY = "billing_confirm_reason";

export function payloadNeedsBillingConfirm(
  payload: Record<string, unknown> | null | undefined
): boolean {
  return payload?.[BILLING_CONFIRM_FLAG] === true;
}

/** Extracted cloud/subscription account from invoice payload (display-trimmed). */
export function invoiceExtractedAccountId(
  payload: Record<string, unknown> | null | undefined
): string | null {
  const raw = payload?.account_id;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t || null;
  }
  return null;
}

export const UNSPECIFIED_BILLING_ACCOUNT = "Unspecified";

/** Stable bucket key for pivoting (empty → Unspecified). */
export function billingAccountBucket(
  accountId: string | null | undefined
): string {
  const n = normalizeBillingAccount(accountId);
  return n || UNSPECIFIED_BILLING_ACCOUNT;
}

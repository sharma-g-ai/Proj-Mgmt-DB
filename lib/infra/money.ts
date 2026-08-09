/**
 * Parse invoice money values from LLM/OCR (numbers, "23,113.80", "₹ 1,234", etc.).
 */

import { normalizeCurrencyCode } from "@/lib/infra/currency";

const AMOUNT_EPS = 0.0001;

export function parseMoneyNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  let s = String(v).trim();
  if (!s) return null;

  s = s
    .replace(/[₹$€£]/g, "")
    .replace(/\bRs\.?\b/gi, "")
    .replace(/\bINR\b/gi, "")
    .replace(/\bUSD\b/gi, "")
    .trim();

  // European style: 1.234,56
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // US / Indian: 1,234.56 or 1,23,456.78
    s = s.replace(/,/g, "");
  }

  s = s.replace(/[^\d.-]/g, "");
  if (!s || s === "-" || s === "." || s === "-.") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Sum line amounts; ignores null/NaN. */
export function sumLineAmounts(lines: Array<{ amount?: unknown }> | null | undefined): number | null {
  if (!lines?.length) return null;
  let sum = 0;
  let any = false;
  for (const l of lines) {
    const n = parseMoneyNumber(l.amount);
    if (n == null) continue;
    sum += n;
    any = true;
  }
  if (!any) return null;
  return Math.round(sum * 100) / 100;
}

export type InvoiceAmountSource = {
  amount_total?: number | string | null;
  extracted_payload?: Record<string, unknown> | null;
};

/**
 * Effective invoice total: column → payload → DB lines → payload lines.
 * Treats 0 like missing so line sums can recover a wiped total.
 */
export function effectiveInvoiceAmount(
  inv: InvoiceAmountSource,
  lines: Array<{ amount?: unknown }> = []
): number | null {
  const direct = parseMoneyNumber(inv.amount_total);
  if (direct != null && Math.abs(direct) > AMOUNT_EPS) return direct;

  const payload = inv.extracted_payload;
  const payloadAmt = parseMoneyNumber(payload?.amount_total);
  if (payloadAmt != null && Math.abs(payloadAmt) > AMOUNT_EPS) return payloadAmt;

  const lineSum = sumLineAmounts(lines);
  if (lineSum != null && Math.abs(lineSum) > AMOUNT_EPS) return lineSum;

  const payloadLines = Array.isArray(payload?.lines)
    ? (payload.lines as Array<{ amount?: unknown }>)
    : [];
  const payloadLineSum = sumLineAmounts(payloadLines);
  if (payloadLineSum != null && Math.abs(payloadLineSum) > AMOUNT_EPS) return payloadLineSum;

  return direct ?? payloadAmt ?? lineSum ?? payloadLineSum;
}

/** Resolve ISO currency from column and/or extracted payload (not free-form notes). */
export function resolveInvoiceCurrency(inv: {
  currency?: string | null;
  extracted_payload?: Record<string, unknown> | null;
}): string | null {
  const fromCol = normalizeCurrencyCode(inv.currency);
  if (fromCol) return fromCol;
  const payload = inv.extracted_payload;
  if (payload && typeof payload.currency === "string") {
    return normalizeCurrencyCode(payload.currency);
  }
  return null;
}

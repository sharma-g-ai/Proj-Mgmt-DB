import { createClient } from "@/lib/supabase/server";
import {
  detectBillingDiscrepancies,
  validationStatusFromDiscrepancies,
} from "@/lib/infra/discrepancies";
import {
  extractTextFromInvoiceFile,
  isLikelyInvoiceImage,
} from "@/lib/infra/extractDocumentText";
import {
  extractInvoiceWithLlm,
  extractInvoiceWithLlmFromFile,
  type ExtractedInvoice,
  type InvoiceExtractionSchema,
  validateExtractedInvoice,
} from "@/lib/infra/llm";
import { deleteInvoiceObject, downloadInvoiceBytes } from "@/lib/infra/storage";

const DUP_DISCREPANCY_TYPES = new Set([
  "duplicate_invoice_number",
  "duplicate_billing_period",
]);

async function loadExtractionSchema(): Promise<InvoiceExtractionSchema> {
  const supabase = createClient();
  const { data: types } = await supabase
    .from("infra_resource_type")
    .select("resource_type_id, label")
    .eq("is_active", true);
  const { data: attrs } = await supabase
    .from("infra_resource_type_attribute")
    .select("resource_type_id, attr_key");

  const idToLabel = new Map((types ?? []).map((t) => [t.resource_type_id as string, t.label as string]));
  const attributeKeysByType: Record<string, string[]> = {};
  for (const a of attrs ?? []) {
    const label = idToLabel.get(a.resource_type_id as string);
    if (!label) continue;
    if (!attributeKeysByType[label]) attributeKeysByType[label] = [];
    attributeKeysByType[label].push(a.attr_key as string);
  }
  return {
    resourceTypeLabels: Array.from(idToLabel.values()),
    attributeKeysByType,
  };
}

export type ParseInvoiceResult = {
  error?: string;
  /** Soft warnings (e.g. out of scope) — shown as a popup, does not fail the action. */
  warning?: string;
  /** Out-of-scope line count written for this invoice (upload/extract feedback). */
  outOfScopeCount?: number;
  /** True when the invoice was rejected and removed as a duplicate. */
  duplicate?: boolean;
};

/** Persist validated extraction + recompute discrepancies for an invoice. */
export async function persistInvoiceExtraction(
  invoiceId: string,
  projectId: string,
  extracted: ExtractedInvoice,
  opts?: { rejectDuplicates?: boolean }
): Promise<ParseInvoiceResult> {
  const supabase = createClient();

  // Prefer explicit total; otherwise derive from lines so billing months aren't ₹0.
  let amountTotal = extracted.amount_total;
  const missingTotal =
    amountTotal == null ||
    !Number.isFinite(Number(amountTotal)) ||
    Math.abs(Number(amountTotal)) < 0.0001;
  if (missingTotal) {
    const sum = extracted.lines.reduce((acc, l) => {
      const n = l.amount == null ? NaN : Number(l.amount);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);
    if (extracted.lines.some((l) => l.amount != null && Number.isFinite(Number(l.amount)) && Math.abs(Number(l.amount)) >= 0.0001)) {
      amountTotal = Math.round(sum * 100) / 100;
      extracted = { ...extracted, amount_total: amountTotal };
    }
  }

  const { error: updErr } = await supabase
    .from("infra_invoice")
    .update({
      invoice_number: extracted.invoice_number,
      currency: extracted.currency,
      amount_total: amountTotal,
      billing_period_start: extracted.billing_period_start,
      billing_period_end: extracted.billing_period_end,
      extracted_payload: extracted,
      processing_status: "parsed",
      error_message: null,
    })
    .eq("invoice_id", invoiceId);
  if (updErr) return { error: updErr.message };

  await supabase.from("infra_invoice_line").delete().eq("invoice_id", invoiceId);

  if (extracted.lines.length) {
    const { error: lineErr } = await supabase.from("infra_invoice_line").insert(
      extracted.lines.map((l) => ({
        invoice_id: invoiceId,
        line_label: l.line_label,
        resource_type_label: l.resource_type_label,
        quantity: l.quantity,
        unit: l.unit,
        unit_cost: l.unit_cost,
        amount: l.amount,
        attributes: l.attributes,
      }))
    );
    if (lineErr) return { error: lineErr.message };
  }

  const result = await runAndStoreDiscrepancies(invoiceId, projectId, extracted, {
    // Don't mark the existing copy as duplicate when we're about to discard this one.
    recheckSiblingDuplicates: !opts?.rejectDuplicates,
  });
  if (result.error) return result;

  if (opts?.rejectDuplicates) {
    const { data: dups } = await supabase
      .from("infra_billing_discrepancy")
      .select("discrepancy_type, message")
      .eq("invoice_id", invoiceId)
      .eq("status", "open")
      .in("discrepancy_type", Array.from(DUP_DISCREPANCY_TYPES));

    if (dups && dups.length > 0) {
      const { data: inv } = await supabase
        .from("infra_invoice")
        .select("storage_path")
        .eq("invoice_id", invoiceId)
        .maybeSingle();
      await supabase.from("infra_invoice").delete().eq("invoice_id", invoiceId);
      if (inv?.storage_path) await deleteInvoiceObject(inv.storage_path);
      const why = dups.some((d) => d.discrepancy_type === "duplicate_invoice_number")
        ? "same invoice #"
        : "same billing period";
      return {
        duplicate: true,
        error: `Duplicate — not added (${why} already exists on this project).`,
      };
    }
  }

  return result;
}

function extractionWarningFrom(
  detected: {
    discrepancy_type: string;
    message: string;
    metadata?: Record<string, unknown>;
  }[],
  extracted?: { currency?: string | null; amount_total?: number | null } | null
): string | undefined {
  const bullets: string[] = [];

  // Upload rejects duplicates with an error popup — omit duplicate soft-warnings here.

  if (detected.some((d) => d.discrepancy_type === "missing_billing_period")) {
    bullets.push("No billing period → shows under Unspecified in Reports.");
  }

  if (extracted && !extracted.currency) {
    bullets.push("No currency → excluded from USD totals until re-extract.");
  }

  if (detected.some((d) => d.discrepancy_type === "missing_invoice_total")) {
    bullets.push("No invoice total → excluded from USD totals.");
  }

  const oos = detected.filter((d) => d.discrepancy_type === "out_of_scope_service");
  if (oos.length) {
    const emptyScope = oos.some((d) => d.metadata?.empty_scope === true);
    bullets.push(
      emptyScope
        ? `${oos.length} line(s) out of scope (no InfraSpecs resources yet).`
        : `${oos.length} line(s) out of scope (not in InfraSpecs).`
    );
  }

  if (bullets.length === 0) return undefined;
  return bullets.map((b) => `• ${b}`).join("\n");
}

export async function runAndStoreDiscrepancies(
  invoiceId: string,
  projectId: string,
  extracted?: ExtractedInvoice,
  opts?: { recheckSiblingDuplicates?: boolean }
): Promise<ParseInvoiceResult> {
  const supabase = createClient();
  const recheckSiblings = opts?.recheckSiblingDuplicates !== false;

  const { data: invoice } = await supabase
    .from("infra_invoice")
    .select(
      "invoice_id, amount_total, billing_period_start, billing_period_end, invoice_number, extracted_payload"
    )
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };

  const { data: lines } = await supabase
    .from("infra_invoice_line")
    .select("amount, line_label, resource_type_label, attributes")
    .eq("invoice_id", invoiceId);

  const { data: scopeRows } = await supabase
    .from("infra_resource")
    .select("resource_id, name, external_id, resource_type:infra_resource_type(label)")
    .eq("project_id", projectId);

  const scopedResources = ((scopeRows ?? []) as unknown as {
    resource_id: string;
    name: string;
    external_id: string | null;
    resource_type: { label: string } | null;
  }[]).map((r) => ({
    resource_id: r.resource_id,
    name: r.name,
    external_id: r.external_id,
    resource_type_label: r.resource_type?.label ?? null,
  }));

  const { data: siblings } = await supabase
    .from("infra_invoice")
    .select("invoice_id, invoice_number, billing_period_start, billing_period_end, amount_total")
    .eq("project_id", projectId);

  const payload =
    extracted ??
    (() => {
      try {
        return validateExtractedInvoice(invoice.extracted_payload);
      } catch {
        return null;
      }
    })();

  const lineChecks =
    payload?.lines?.map((l) => ({
      amount: l.amount,
      line_label: l.line_label,
      resource_type_label: l.resource_type_label,
      attributes: l.attributes,
    })) ??
    ((lines ?? []) as {
      amount: number | null;
      line_label: string | null;
      resource_type_label: string | null;
      attributes: Record<string, unknown>;
    }[]).map((l) => ({
      amount: l.amount != null ? Number(l.amount) : null,
      line_label: l.line_label,
      resource_type_label: l.resource_type_label,
      attributes: l.attributes ?? {},
    }));

  const detected = detectBillingDiscrepancies({
    invoiceId,
    amountTotal: invoice.amount_total != null ? Number(invoice.amount_total) : null,
    billingPeriodStart: invoice.billing_period_start,
    billingPeriodEnd: invoice.billing_period_end,
    invoiceNumber: invoice.invoice_number,
    lines: lineChecks,
    scopedResources,
    siblingInvoices: (siblings ?? []).map((s) => ({
      invoice_id: s.invoice_id,
      invoice_number: s.invoice_number,
      billing_period_start: s.billing_period_start,
      billing_period_end: s.billing_period_end,
      amount_total: s.amount_total != null ? Number(s.amount_total) : null,
    })),
  });

  await supabase.from("infra_billing_discrepancy").delete().eq("invoice_id", invoiceId);
  if (detected.length) {
    const { error } = await supabase.from("infra_billing_discrepancy").insert(
      detected.map((d) => ({
        invoice_id: invoiceId,
        discrepancy_type: d.discrepancy_type,
        severity: d.severity,
        message: d.message,
        expected_value: d.expected_value,
        actual_value: d.actual_value,
        status: "open",
        metadata: d.metadata,
      }))
    );
    if (error) return { error: error.message };
  }

  const validation_status = validationStatusFromDiscrepancies(detected);
  await supabase.from("infra_invoice").update({ validation_status }).eq("invoice_id", invoiceId);

  // Keep payload notes if we had extraction
  if (payload) {
    await supabase
      .from("infra_invoice")
      .update({ extracted_payload: payload })
      .eq("invoice_id", invoiceId);
  }

  // Flag the other copy too (avoid recursion with recheckSiblingDuplicates: false).
  if (recheckSiblings) {
    const peerIds = new Set<string>();
    for (const d of detected) {
      if (
        d.discrepancy_type !== "duplicate_invoice_number" &&
        d.discrepancy_type !== "duplicate_billing_period"
      ) {
        continue;
      }
      const other = d.metadata?.other_invoice_id;
      if (typeof other === "string" && other && other !== invoiceId) peerIds.add(other);
    }
    for (const peerId of Array.from(peerIds)) {
      await runAndStoreDiscrepancies(peerId, projectId, undefined, {
        recheckSiblingDuplicates: false,
      });
    }
  }

  const outOfScopeCount = detected.filter(
    (d) => d.discrepancy_type === "out_of_scope_service"
  ).length;
  return {
    warning: extractionWarningFrom(detected, payload ?? extracted),
    outOfScopeCount: outOfScopeCount > 0 ? outOfScopeCount : undefined,
  };
}

export async function parseInvoiceFromText(
  invoiceId: string,
  projectId: string,
  textContent: string
): Promise<ParseInvoiceResult> {
  const supabase = createClient();
  await supabase
    .from("infra_invoice")
    .update({ processing_status: "processing", error_message: null })
    .eq("invoice_id", invoiceId);

  try {
    const schema = await loadExtractionSchema();
    const extracted = await extractInvoiceWithLlm({ textContent, schema });
    return persistInvoiceExtraction(invoiceId, projectId, extracted);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Parse failed.";
    await supabase
      .from("infra_invoice")
      .update({ processing_status: "failed", error_message: message })
      .eq("invoice_id", invoiceId);
    return { error: message };
  }
}

/**
 * Full pipeline: PDF/text/image → extract → LLM → month-wise billing fields.
 */
export async function parseInvoiceFromBytes(params: {
  invoiceId: string;
  projectId: string;
  bytes: Uint8Array;
  filename: string;
  mimeType?: string | null;
  /** When true, duplicate invoices are deleted and returned as an error (not saved). */
  rejectDuplicates?: boolean;
}): Promise<ParseInvoiceResult> {
  const supabase = createClient();
  await supabase
    .from("infra_invoice")
    .update({ processing_status: "processing", error_message: null })
    .eq("invoice_id", params.invoiceId);

  try {
    const schema = await loadExtractionSchema();
    const mime = params.mimeType || "application/octet-stream";
    let text = "";
    try {
      const extractedDoc = await extractTextFromInvoiceFile({
        bytes: params.bytes,
        filename: params.filename,
        mimeType: mime,
      });
      text = extractedDoc.text;
    } catch {
      text = "";
    }

    let extracted: ExtractedInvoice;
    if (text.trim().length >= 40) {
      try {
        extracted = await extractInvoiceWithLlm({ textContent: text, schema });
      } catch (textErr) {
        // Fall back to multimodal if text LLM fails and file is PDF/image
        if (mime.includes("pdf") || isLikelyInvoiceImage(params.filename, mime)) {
          extracted = await extractInvoiceWithLlmFromFile({
            bytes: params.bytes,
            filename: params.filename,
            mimeType: mime.includes("pdf") ? "application/pdf" : mime,
            schema,
            textHint: text,
          });
        } else {
          throw textErr;
        }
      }
    } else if (mime.includes("pdf") || isLikelyInvoiceImage(params.filename, mime)) {
      extracted = await extractInvoiceWithLlmFromFile({
        bytes: params.bytes,
        filename: params.filename,
        mimeType: mime.includes("pdf") ? "application/pdf" : mime,
        schema,
        textHint: text || undefined,
      });
    } else {
      throw new Error(
        "Could not read invoice text. Upload a PDF/CSV/TXT, or paste invoice text after upload."
      );
    }

    return persistInvoiceExtraction(params.invoiceId, params.projectId, extracted, {
      rejectDuplicates: params.rejectDuplicates,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Parse failed.";
    await supabase
      .from("infra_invoice")
      .update({ processing_status: "failed", error_message: message })
      .eq("invoice_id", params.invoiceId);
    return { error: message };
  }
}

/** Re-download from storage and extract (for pending/failed invoices). */
export async function parseInvoiceFromStorage(
  invoiceId: string,
  projectId: string
): Promise<ParseInvoiceResult> {
  const supabase = createClient();
  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("storage_path, original_filename, mime_type")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv?.storage_path) return { error: "Invoice file not found." };

  const downloaded = await downloadInvoiceBytes(inv.storage_path);
  if (downloaded.error || !downloaded.bytes) {
    return { error: downloaded.error ?? "Could not download invoice file." };
  }

  return parseInvoiceFromBytes({
    invoiceId,
    projectId,
    bytes: downloaded.bytes,
    filename: inv.original_filename || "invoice.pdf",
    mimeType: inv.mime_type,
  });
}

/**
 * Portkey (OpenAI-compatible) client for invoice extraction.
 * Field lists come from runtime metadata — nothing provider-specific is hardcoded.
 */

import { normalizeCurrencyCode } from "@/lib/infra/currency";
import { parseMoneyNumber, sumLineAmounts } from "@/lib/infra/money";

export type InvoiceExtractionSchema = {
  resourceTypeLabels: string[];
  attributeKeysByType: Record<string, string[]>;
};

export type ExtractedInvoice = {
  invoice_number: string | null;
  vendor_name: string | null;
  account_id: string | null;
  invoice_date: string | null;
  currency: string | null;
  amount_total: number | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  lines: Array<{
    line_label: string | null;
    resource_type_label: string | null;
    quantity: number | null;
    unit: string | null;
    unit_cost: number | null;
    amount: number | null;
    attributes: Record<string, unknown>;
  }>;
  notes: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured.`);
  return v;
}

/** Portkey speaks OpenAI format at `{base}/chat/completions`. */
function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function llmConfig() {
  const base = (process.env.PORTKEY_BASE_URL || "https://api.portkey.ai/v1").replace(
    /\/$/,
    ""
  );
  const key = requireEnv("PORTKEY_API_KEY");
  const configId = requireEnv("PORTKEY_CONFIG_ID");
  // Config routing overrides this name (often Gemini). Do not branch on it.
  const model = process.env.PORTKEY_MODEL || "gpt-4o-mini";
  return { key, configId, model, url: chatCompletionsUrl(base) };
}

function portkeyHeaders(cfg: { key: string; configId: string }) {
  return {
    "Content-Type": "application/json",
    "x-portkey-api-key": cfg.key,
    "x-portkey-config": cfg.configId,
    "x-portkey-metadata": JSON.stringify({ feature: "invoice-extraction" }),
  };
}

export async function extractInvoiceWithLlm(params: {
  textContent: string;
  schema: InvoiceExtractionSchema;
}): Promise<ExtractedInvoice> {
  const { model, url, ...auth } = llmConfig();

  const system = [
    "You extract structured billing data from invoice text or invoice documents.",
    "Return ONLY valid JSON matching the schema described by the user.",
    "Never invent or guess values. If a field is not present in the invoice, use null.",
    "Do not invent line items that are not in the document.",
    "Dates must be YYYY-MM-DD or null. Amounts must be numbers or null.",
    "billing_period_start/end: use the stated billing/service period when present;",
    "if only an invoice date exists, use the first and last day of that invoice month.",
    "amount_total: use the invoice grand total / amount due when present (plain number, no commas).",
    "If amount_total is missing but line amounts exist, set amount_total to the sum of line amounts.",
    "vendor_name: bill-from / vendor / company name when present (e.g. Amazon Web Services).",
    "account_id: cloud account, payer account, or subscription ID when present.",
    "invoice_date: the invoice issue date when present (not the billing period).",
    "currency: ISO 4217 three-letter code exactly as on the invoice (INR, USD, EUR, GBP, …).",
    "Never default currency to USD. If the invoice shows ₹ / Rs / rupees use INR; if $ and clearly US dollars use USD; if unknown use null.",
    "amount_total and line amounts must stay in that invoice currency (do not convert).",
  ].join(" ");

  const user = JSON.stringify({
    instructions: {
      known_resource_type_labels: params.schema.resourceTypeLabels,
      attribute_keys_by_type: params.schema.attributeKeysByType,
      output_shape: {
        invoice_number: "string|null",
        vendor_name: "string|null",
        account_id: "string|null",
        invoice_date: "YYYY-MM-DD|null",
        currency: "ISO-4217 three-letter code|null (e.g. INR, USD) — never invent USD",
        amount_total: "number|null",
        billing_period_start: "YYYY-MM-DD|null",
        billing_period_end: "YYYY-MM-DD|null",
        lines: [
          {
            line_label: "string|null",
            resource_type_label: "string|null — prefer a known label when it clearly matches",
            quantity: "number|null",
            unit: "string|null",
            unit_cost: "number|null",
            amount: "number|null",
            attributes: "object — only keys supported for the resource type, values from invoice or omit",
          },
        ],
        notes: "string|null",
      },
    },
    invoice_text: params.textContent.slice(0, 120_000),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: portkeyHeaders(auth),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content.");

  return validateExtractedInvoice(JSON.parse(content));
}

/** Multimodal fallback for scanned PDFs / images via Portkey vision-capable models. */
export async function extractInvoiceWithLlmFromFile(params: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  schema: InvoiceExtractionSchema;
  textHint?: string;
}): Promise<ExtractedInvoice> {
  const { model, url, ...auth } = llmConfig();

  const b64 = Buffer.from(params.bytes).toString("base64");
  const mime = params.mimeType || "application/octet-stream";
  const dataUrl = `data:${mime};base64,${b64}`;

  const system = [
    "You extract structured billing data from an invoice document (PDF or image).",
    "Return ONLY valid JSON matching the requested schema.",
    "Never invent values. Use null when not visible.",
    "Dates YYYY-MM-DD or null. Amounts numbers or null.",
    "If billing period is missing but invoice date exists, use that calendar month (first–last day).",
    "vendor_name: bill-from / vendor / company name when present.",
    "account_id: cloud account, payer account, or subscription ID when present.",
    "invoice_date: the invoice issue date when present (not the billing period).",
    "currency: ISO 4217 three-letter code from the invoice (INR for ₹/Rs, USD only when clearly US dollars). Never invent USD. Do not convert amounts.",
  ].join(" ");

  const schemaBlock = JSON.stringify({
    known_resource_type_labels: params.schema.resourceTypeLabels,
    attribute_keys_by_type: params.schema.attributeKeysByType,
    output_shape: {
      invoice_number: "string|null",
      vendor_name: "string|null",
      account_id: "string|null",
      invoice_date: "YYYY-MM-DD|null",
      currency: "ISO-4217 three-letter code|null (e.g. INR, USD)",
      amount_total: "number|null",
      billing_period_start: "YYYY-MM-DD|null",
      billing_period_end: "YYYY-MM-DD|null",
      lines: [
        {
          line_label: "string|null",
          resource_type_label: "string|null",
          quantity: "number|null",
          unit: "string|null",
          unit_cost: "number|null",
          amount: "number|null",
          attributes: "object",
        },
      ],
      notes: "string|null",
    },
  });

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Extract invoice JSON.\nSchema:\n${schemaBlock}${
        params.textHint ? `\n\nPartial OCR/text hint:\n${params.textHint.slice(0, 20_000)}` : ""
      }`,
    },
  ];

  // Prefer image_url for images; Portkey / OpenAI-compat gateways also accept PDF data URLs.
  if (mime.startsWith("image/") || mime.includes("pdf")) {
    content.push({ type: "image_url", image_url: { url: dataUrl } });
  } else {
    content.push({
      type: "text",
      text: `Filename: ${params.filename}. Base64 document (truncated):\n${b64.slice(0, 50_000)}`,
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: portkeyHeaders(auth),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM vision request failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty content.");
  return validateExtractedInvoice(JSON.parse(raw));
}

export function validateExtractedInvoice(raw: unknown): ExtractedInvoice {
  if (!raw || typeof raw !== "object") {
    throw new Error("Extraction result must be an object.");
  }
  const o = raw as Record<string, unknown>;

  const numOrNull = (v: unknown): number | null => parseMoneyNumber(v);
  const strOrNull = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  const dateOrNull = (v: unknown): string | null => {
    const s = strOrNull(v);
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  };

  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines = linesRaw.map((line) => {
    const l = (line && typeof line === "object" ? line : {}) as Record<string, unknown>;
    const attrs =
      l.attributes && typeof l.attributes === "object" && !Array.isArray(l.attributes)
        ? (l.attributes as Record<string, unknown>)
        : {};
    return {
      line_label: strOrNull(l.line_label),
      resource_type_label: strOrNull(l.resource_type_label),
      quantity: numOrNull(l.quantity),
      unit: strOrNull(l.unit),
      unit_cost: numOrNull(l.unit_cost),
      amount: numOrNull(l.amount),
      attributes: attrs,
    };
  });

  let amount_total = numOrNull(o.amount_total);
  // Recover total when LLM omitted it, returned 0, or a non-numeric string.
  if (amount_total == null || Math.abs(amount_total) < 0.0001) {
    const lineSum = sumLineAmounts(lines);
    if (lineSum != null && Math.abs(lineSum) >= 0.0001) amount_total = lineSum;
  }

  return {
    invoice_number: strOrNull(o.invoice_number),
    vendor_name: strOrNull(o.vendor_name),
    account_id: strOrNull(o.account_id),
    invoice_date: dateOrNull(o.invoice_date),
    currency: normalizeCurrencyCode(strOrNull(o.currency)),
    amount_total,
    billing_period_start: dateOrNull(o.billing_period_start),
    billing_period_end: dateOrNull(o.billing_period_end),
    lines,
    notes: strOrNull(o.notes),
  };
}

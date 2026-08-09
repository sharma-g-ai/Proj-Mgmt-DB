/**
 * Normalize invoice currency labels/symbols into ISO 4217 codes.
 * LLMs often return "₹", "Rs", "rupees", etc. instead of "INR".
 */

const NAME_TO_CODE: Record<string, string> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  "us dollar": "USD",
  "us dollars": "USD",
  inr: "INR",
  rs: "INR",
  "rs.": "INR",
  rupee: "INR",
  rupees: "INR",
  "indian rupee": "INR",
  "indian rupees": "INR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  "pound sterling": "GBP",
  aud: "AUD",
  "australian dollar": "AUD",
  cad: "CAD",
  "canadian dollar": "CAD",
  sgd: "SGD",
  "singapore dollar": "SGD",
  jpy: "JPY",
  yen: "JPY",
  aed: "AED",
  "uae dirham": "AED",
  dirham: "AED",
  chf: "CHF",
  franc: "CHF",
  cny: "CNY",
  rmb: "CNY",
  yuan: "CNY",
};

/** Map free-text / symbol currency from an invoice into ISO 4217, or null. */
export function normalizeCurrencyCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;

  if (t.includes("₹")) return "INR";
  if (t.includes("€")) return "EUR";
  if (t.includes("£")) return "GBP";
  if (t.includes("¥")) return "JPY";
  // Bare "$" is treated as USD (common on US invoices).
  if (t === "$" || /^\$[\d,]/.test(t)) return "USD";

  const upper = t.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;

  // Allow mild noise only: "INR ", "USD." — never strip path junk like "../etc" → ETC.
  const mild = upper.match(/^([A-Z]{3})[\s.]*$/);
  if (mild) return mild[1];

  const lower = t.toLowerCase().replace(/\s+/g, " ");
  if (NAME_TO_CODE[lower]) return NAME_TO_CODE[lower];

  // Whole-word / phrase match only (avoid "cad" inside unrelated text).
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (name.length < 3) continue;
    const re = new RegExp(`(?:^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`, "i");
    if (re.test(lower)) return code;
  }

  return null;
}

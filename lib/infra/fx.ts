/**
 * Live FX rates — primary source Google Finance; Frankfurter (ECB) as fallback.
 * No hardcoded conversion rates. Currency codes are strictly validated before any
 * outbound request (prevents open-proxy / SSRF-style abuse via crafted codes).
 */

import { round1 } from "@/lib/format";
import { normalizeCurrencyCode } from "@/lib/infra/currency";
import { REPORT_CURRENCY } from "@/lib/infra/fxConstants";

export { REPORT_CURRENCY };

type CacheEntry = { rate: number; source: string; fetchedAt: number };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Cap unique non-USD currencies resolved per batch (DoS guard). */
const MAX_CURRENCIES_PER_BATCH = 32;
/** ISO 4217 alphabetic codes only. */
const CURRENCY_RE = /^[A-Z]{3}$/;

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** Returns a validated ISO currency code, or null if unsafe/invalid. */
export function sanitizeCurrencyCode(code: string | null | undefined): string | null {
  // Accept symbols/names (₹, Rs) then enforce [A-Z]{3}.
  const normalized = normalizeCurrencyCode(code) ?? norm(code);
  if (!normalized || !CURRENCY_RE.test(normalized)) return null;
  return normalized;
}

function cacheKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Parse a mid-market rate from a Google Finance quote HTML page. */
function parseGoogleFinanceRate(html: string): number | null {
  // Bound work on huge HTML responses.
  const slice = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html;
  const patterns = [
    /data-last-price="([\d.]+)"/i,
    /class="YMlKec[^"]*"[^>]*>\s*([\d,.]+)\s*</i,
    /jsname="ip75Kf"[^>]*>\s*([\d,.]+)\s*</i,
    /\["(?:price|last)"[,\s]+([\d.]+)\]/i,
  ];
  for (const re of patterns) {
    const m = slice.match(re);
    if (m?.[1]) {
      const n = Number(String(m[1]).replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0 && n < 1e9) return n;
    }
  }

  const series = Array.from(
    slice.matchAll(/\[\[[\d,]+(?:,null)*(?:,\[\])*\],\[([\d.]+),/g)
  );
  if (series.length > 0) {
    const last = Number(series[series.length - 1][1]);
    if (Number.isFinite(last) && last > 0 && last < 1e9) return last;
  }
  return null;
}

async function fetchGoogleFinanceRate(from: string, to: string): Promise<number | null> {
  // from/to already sanitized to [A-Z]{3}; hosts are fixed (no SSRF).
  const url = `https://www.google.com/finance/quote/${from}-${to}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  return parseGoogleFinanceRate(html);
}

/** ECB daily rates via Frankfurter — no API key. */
async function fetchFrankfurterRate(from: string, to: string): Promise<number | null> {
  const url = `https://api.frankfurter.dev/v2/rate/${from}/${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { rate?: number };
  const n = Number(data.rate);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

/**
 * Mid-market units of `to` per 1 unit of `from`.
 * Prefers Google Finance; falls back to Frankfurter if Google is unavailable.
 */
export async function getExchangeRate(
  from: string,
  to: string = REPORT_CURRENCY
): Promise<{ rate: number; source: string } | null> {
  const a = sanitizeCurrencyCode(from);
  const b = sanitizeCurrencyCode(to);
  if (!a || !b) return null;
  if (a === b) return { rate: 1, source: "identity" };

  const key = cacheKey(a, b);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { rate: hit.rate, source: hit.source };
  }

  let rate: number | null = null;
  let source = "";

  try {
    rate = await fetchGoogleFinanceRate(a, b);
    if (rate != null) source = "google_finance";
  } catch {
    rate = null;
  }

  if (rate == null) {
    try {
      rate = await fetchFrankfurterRate(a, b);
      if (rate != null) source = "frankfurter_ecb";
    } catch {
      rate = null;
    }
  }

  if (rate == null) {
    try {
      const inv = await fetchGoogleFinanceRate(b, a);
      if (inv != null && inv > 0) {
        rate = 1 / inv;
        source = "google_finance_inverse";
      }
    } catch {
      /* ignore */
    }
  }
  if (rate == null) {
    try {
      const inv = await fetchFrankfurterRate(b, a);
      if (inv != null && inv > 0) {
        rate = 1 / inv;
        source = "frankfurter_ecb_inverse";
      }
    } catch {
      /* ignore */
    }
  }

  if (rate == null) return null;
  cache.set(key, { rate, source, fetchedAt: Date.now() });
  return { rate, source };
}

export async function convertToUsd(
  amount: number | null | undefined,
  currency: string | null | undefined
): Promise<{
  usd: number | null;
  rate: number | null;
  source: string | null;
  originalCurrency: string;
}> {
  const cur = sanitizeCurrencyCode(currency);
  if (!cur) {
    return { usd: null, rate: null, source: null, originalCurrency: REPORT_CURRENCY };
  }
  if (amount == null || !Number.isFinite(Number(amount))) {
    return { usd: null, rate: null, source: null, originalCurrency: cur };
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || Math.abs(amt) > 1e15) {
    return { usd: null, rate: null, source: null, originalCurrency: cur };
  }
  if (cur === REPORT_CURRENCY) {
    return { usd: round1(amt), rate: 1, source: "identity", originalCurrency: cur };
  }
  const fx = await getExchangeRate(cur, REPORT_CURRENCY);
  if (!fx) {
    return { usd: null, rate: null, source: null, originalCurrency: cur };
  }
  return {
    usd: round1(amt * fx.rate),
    rate: fx.rate,
    source: fx.source,
    originalCurrency: cur,
  };
}

/** Batch-convert unique currencies, then map amounts. */
export async function loadUsdRatesForCurrencies(
  currencies: (string | null | undefined)[]
): Promise<Map<string, { rate: number; source: string }>> {
  const codes = Array.from(
    new Set(
      currencies
        .map(sanitizeCurrencyCode)
        .filter((c): c is string => !!c && c !== REPORT_CURRENCY)
    )
  ).slice(0, MAX_CURRENCIES_PER_BATCH);

  const map = new Map<string, { rate: number; source: string }>();
  map.set(REPORT_CURRENCY, { rate: 1, source: "identity" });
  await Promise.all(
    codes.map(async (c) => {
      const fx = await getExchangeRate(c, REPORT_CURRENCY);
      if (fx) map.set(c, fx);
    })
  );
  return map;
}

export function amountToUsd(
  amount: number | null | undefined,
  currency: string | null | undefined,
  rates: Map<string, { rate: number; source: string }>
): number | null {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const amt = Number(amount);
  if (Math.abs(amt) > 1e15) return null;
  // Unknown currency must not be treated as USD.
  const cur = sanitizeCurrencyCode(currency);
  if (!cur) return null;
  if (cur === REPORT_CURRENCY) return round1(amt);
  const fx = rates.get(cur);
  if (!fx) return null;
  return round1(amt * fx.rate);
}

/** Exposed for unit tests. */
export const __test = { parseGoogleFinanceRate, norm, sanitizeCurrencyCode };

import { round1 } from "@/lib/format";
import {
  billingAccountBucket,
  UNSPECIFIED_BILLING_ACCOUNT,
} from "@/lib/infra/billingBinding";

/** Month bucket when billing period is missing — shown as "Unspecified". */
export const UNKNOWN_BILLING_MONTH = "unknown";

/** One invoice atom used to build the InfraBilling pivot (months are dynamic). */
export type InfraBillingInvoiceAtom = {
  invoice_id?: string | null;
  invoice_number?: string | null;
  project_id: string;
  project_name: string;
  /** Project stakeholder: External | Internal */
  stakeholder: string | null;
  ownership_label: string | null;
  /** Cloud/tool/vendor for this invoice (AWS, E2E, …). */
  provider_label: string | null;
  /** Extracted billing account number (allow-list match); null if missing. */
  account_id?: string | null;
  /** Optional friendly label from project allow-list. */
  account_name?: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  amount_total: number | null;
  currency: string | null;
};

/** Flat row (export compat / tests). */
export type InfraBillingRow = {
  project_id: string;
  project_name: string;
  ownership_label: string;
  provider_label: string;
  currency: string;
  total: number;
  /** YYYY-MM → amount */
  months: Record<string, number>;
};

export type InfraBillingProjectCol = {
  project_id: string;
  project_name: string;
  /** Billing account bucket (normalized id or Unspecified). */
  account_id: string | null;
  /** Header label for this account column. */
  account_label: string | null;
  tool: string;
  months: Record<string, number>;
  total: number;
};

export type InfraBillingStakeholderGroup = {
  stakeholder: string;
  projects: InfraBillingProjectCol[];
  months: Record<string, number>;
  total: number;
};

/** One tool/vendor block inside the single InfraBilling sheet. */
export type InfraBillingToolBlock = {
  tool: string;
  groups: InfraBillingStakeholderGroup[];
  /** True when this tool has 2+ projects → show External | Internal. */
  showOwnershipHeaders: boolean;
  months: Record<string, number>;
  total: number;
};

/** Fallback column when invoice has no Source / vendor / project provider. */
export const UNSPECIFIED_TOOL = "Unspecified";

/** Single Excel-style sheet: tool column-groups, each with External | Internal when needed. */
export type InfraBillingToolSheet = {
  title: string;
  tools: string[];
  currency: string;
  months: string[];
  toolBlocks: InfraBillingToolBlock[];
  /**
   * @deprecated Flattened groups for older callers — prefer toolBlocks.
   * Empty when using toolBlocks-only UI.
   */
  groups: InfraBillingStakeholderGroup[];
  showOwnershipHeaders: boolean;
  /** Invoices with null USD amount (missing total/currency/FX) — excluded from sums. */
  excludedFromUsdCount: number;
};

/** @deprecated alias — prefer stakeholder */
export type InfraBillingOwnershipGroup = InfraBillingStakeholderGroup & {
  ownership_label: string;
};

/** Billing month key from a period — prefer start, else end. Null if missing. */
export function billingMonthKey(start: string | null, end: string | null): string | null {
  const d = start || end;
  if (!d || d.length < 7) return null;
  return d.slice(0, 7);
}

/** Month bucket for pivots — missing period → Unspecified (`unknown`). */
export function billingMonthBucket(start: string | null, end: string | null): string {
  return billingMonthKey(start, end) ?? UNKNOWN_BILLING_MONTH;
}

export function sortBillingMonths(keys: string[]): string[] {
  const known = keys.filter((k) => k !== UNKNOWN_BILLING_MONTH).sort();
  if (keys.includes(UNKNOWN_BILLING_MONTH)) known.push(UNKNOWN_BILLING_MONTH);
  return known;
}

export function collectBillingMonths(atoms: InfraBillingInvoiceAtom[]): string[] {
  const set = new Set<string>();
  for (const a of atoms) {
    set.add(billingMonthBucket(a.billing_period_start, a.billing_period_end));
  }
  return sortBillingMonths(Array.from(set));
}

/**
 * Drop duplicate invoices from report totals (keep first).
 * - Same project + tool + invoice number (always)
 * - Same project + tool + period + amount only when both lack an invoice number
 *   (avoids dropping distinct INV-A / INV-B that happen to share period+amount)
 */
export function dedupeInfraBillingAtoms(
  atoms: InfraBillingInvoiceAtom[]
): InfraBillingInvoiceAtom[] {
  const ordered = [...atoms].sort((a, b) =>
    String(a.invoice_id ?? "").localeCompare(String(b.invoice_id ?? ""))
  );
  const seenNum = new Set<string>();
  const seenPeriod = new Set<string>();
  const kept: InfraBillingInvoiceAtom[] = [];

  for (const a of ordered) {
    const tool = toolFromAtom(a) || a.provider_label?.trim() || UNSPECIFIED_TOOL;
    const num = a.invoice_number?.trim().toLowerCase();
    if (num) {
      const nk = `${a.project_id}|${tool}|${billingAccountBucket(a.account_id)}|${num}`;
      if (seenNum.has(nk)) continue;
      seenNum.add(nk);
      kept.push(a);
      continue;
    }
    if (a.billing_period_start && a.billing_period_end) {
      const amt = Math.round((Number(a.amount_total) || 0) * 100) / 100;
      const pk = `${a.project_id}|${tool}|${billingAccountBucket(a.account_id)}|${a.billing_period_start}|${a.billing_period_end}|${amt}`;
      if (seenPeriod.has(pk)) continue;
      seenPeriod.add(pk);
    }
    kept.push(a);
  }
  return kept;
}

/**
 * Short, stable tool labels for the report banner.
 * Maps legal vendor strings (e.g. "Amazon Web Services, Inc.") → AWS.
 */
export function normalizeToolLabel(raw: string | null | undefined): string {
  const s = raw?.trim();
  if (!s) return "";
  const lower = s.toLowerCase();

  if (
    lower === "aws" ||
    lower.startsWith("aws ") ||
    lower.includes("amazon web services") ||
    lower.includes("amazon.com")
  ) {
    return "AWS";
  }
  if (lower.includes("atlassian") || lower.includes("jira") || lower.includes("confluence")) {
    return "Atlassian";
  }
  if (lower.includes("azure") || lower.includes("microsoft corporation")) {
    return "Azure";
  }
  if (lower === "gcp" || lower.includes("google cloud") || lower.includes("google llc")) {
    return "GCP";
  }
  if (lower.includes("github") && lower.includes("copilot")) return "GitHub Copilot";
  if (lower.includes("github")) return "GitHub";
  if (lower.includes("openai")) return "OpenAI";
  if (lower === "e2e" || lower.startsWith("e2e ")) return "E2E";

  // Drop corporate suffixes for shorter banners; keep short names as-is.
  const shortened = s
    .replace(/,?\s*(inc\.?|ltd\.?|llc\.?|pty\.?\s*ltd\.?|corporation|corp\.?)\s*$/i, "")
    .trim();
  return shortened || s;
}

function toolFromAtom(a: InfraBillingInvoiceAtom): string {
  return normalizeToolLabel(a.provider_label);
}

export function normalizeStakeholder(label: string | null | undefined): string {
  const s = label?.trim();
  if (!s) return "External";
  const lower = s.toLowerCase();
  if (lower === "internal") return "Internal";
  if (lower === "external") return "External";
  return s;
}

function stakeholderSortKey(label: string): number {
  if (label === "External") return 0;
  if (label === "Internal") return 1;
  return 2;
}

type ProjAcc = {
  project_id: string;
  project_name: string;
  account_id: string | null;
  account_label: string | null;
  stakeholder: string;
  tool: string;
  currency: string;
  months: Record<string, number>;
  total: number;
};

function accountColumnLabel(a: InfraBillingInvoiceAtom): string {
  const name = a.account_name?.trim();
  const id = a.account_id?.trim();
  if (name && id) return `${name} (${id})`;
  if (name) return name;
  if (id) return id;
  return UNSPECIFIED_BILLING_ACCOUNT;
}

function displayProjectColumnName(p: ProjAcc, multiAccountForProject: boolean): string {
  if (!multiAccountForProject) return p.project_name;
  const label = p.account_label?.trim() || UNSPECIFIED_BILLING_ACCOUNT;
  return `${p.project_name} · ${label}`;
}

function stakeholderGroup(
  stakeholder: string,
  list: ProjAcc[]
): InfraBillingStakeholderGroup {
  const multiByProject = new Map<string, number>();
  for (const p of list) {
    multiByProject.set(p.project_id, (multiByProject.get(p.project_id) ?? 0) + 1);
  }
  const sorted = [...list].sort((a, b) => {
    const byName = a.project_name.localeCompare(b.project_name);
    if (byName !== 0) return byName;
    return (a.account_label ?? "").localeCompare(b.account_label ?? "");
  });
  const gMonths: Record<string, number> = {};
  let gTotal = 0;
  const cols: InfraBillingProjectCol[] = sorted.map((p) => {
    gTotal += p.total;
    for (const [m, v] of Object.entries(p.months)) {
      gMonths[m] = (gMonths[m] ?? 0) + v;
    }
    const multi = (multiByProject.get(p.project_id) ?? 0) > 1;
    return {
      project_id: p.project_id,
      project_name: displayProjectColumnName(p, multi),
      account_id: p.account_id,
      account_label: p.account_label,
      tool: p.tool,
      months: Object.fromEntries(
        Object.entries(p.months).map(([k, v]) => [k, round1(Number(v))])
      ),
      total: round1(p.total),
    };
  });
  return {
    stakeholder,
    projects: cols,
    months: Object.fromEntries(
      Object.entries(gMonths).map(([k, v]) => [k, round1(Number(v))])
    ),
    total: round1(gTotal),
  };
}

function buildToolBlock(atoms: InfraBillingInvoiceAtom[], tool: string): InfraBillingToolBlock {
  // One column per project × billing account (not summed across accounts).
  const byCol = new Map<string, ProjAcc>();

  for (const a of atoms) {
    const stakeholder = normalizeStakeholder(a.stakeholder);
    const accountKey = billingAccountBucket(a.account_id);
    const colKey = `${a.project_id}|${accountKey}`;
    let proj = byCol.get(colKey);
    if (!proj) {
      proj = {
        project_id: a.project_id,
        project_name: a.project_name,
        account_id: accountKey === UNSPECIFIED_BILLING_ACCOUNT ? null : accountKey,
        account_label: accountColumnLabel(a),
        stakeholder,
        tool,
        currency: a.currency?.trim() || "—",
        months: {},
        total: 0,
      };
      byCol.set(colKey, proj);
    } else {
      if (proj.currency === "—" && a.currency) proj.currency = a.currency.trim();
      if (a.project_name) proj.project_name = a.project_name;
      if (a.stakeholder?.trim()) proj.stakeholder = normalizeStakeholder(a.stakeholder);
      if (a.account_name?.trim() || a.account_id?.trim()) {
        proj.account_label = accountColumnLabel(a);
      }
    }

    // Missing USD (null currency/FX/total) must not become a silent $0.
    if (a.amount_total == null) continue;
    const amt = Number(a.amount_total);
    if (!Number.isFinite(amt)) continue;
    proj.total += amt;
    const mk = billingMonthBucket(a.billing_period_start, a.billing_period_end);
    proj.months[mk] = (proj.months[mk] ?? 0) + amt;
  }

  const projects = Array.from(byCol.values());
  const distinctProjectIds = new Set(projects.map((p) => p.project_id));
  const showOwnershipHeaders = distinctProjectIds.size > 1;

  const byStake = new Map<string, ProjAcc[]>();
  for (const p of projects) {
    const list = byStake.get(p.stakeholder) ?? [];
    list.push(p);
    byStake.set(p.stakeholder, list);
  }

  const stakeKeys = Array.from(byStake.keys()).sort((a, b) => {
    const d = stakeholderSortKey(a) - stakeholderSortKey(b);
    return d !== 0 ? d : a.localeCompare(b);
  });

  // Single-project tool: one flat group (no External/Internal header).
  const groups: InfraBillingStakeholderGroup[] = showOwnershipHeaders
    ? stakeKeys.map((stakeholder) => {
        const list = (byStake.get(stakeholder) ?? []).sort((a, b) => {
          const byName = a.project_name.localeCompare(b.project_name);
          if (byName !== 0) return byName;
          return (a.account_label ?? "").localeCompare(b.account_label ?? "");
        });
        return stakeholderGroup(stakeholder, list);
      })
    : [stakeholderGroup(projects[0]?.stakeholder ?? "External", projects)];

  const tMonths: Record<string, number> = {};
  let tTotal = 0;
  for (const g of groups) {
    tTotal += g.total;
    for (const [m, v] of Object.entries(g.months)) {
      tMonths[m] = (tMonths[m] ?? 0) + v;
    }
  }

  return {
    tool,
    groups,
    showOwnershipHeaders,
    months: Object.fromEntries(
      Object.entries(tMonths).map(([k, v]) => [k, round1(Number(v))])
    ),
    total: round1(tTotal),
  };
}

/**
 * One sheet: columns grouped by tool/vendor.
 * Under each tool, External | Internal only when that tool has 2+ projects.
 * Invoices with no Source/vendor/provider land under {@link UNSPECIFIED_TOOL}.
 */
export function buildInfraBillingSheets(
  atoms: InfraBillingInvoiceAtom[]
): InfraBillingToolSheet[] {
  const deduped = dedupeInfraBillingAtoms(atoms);
  if (deduped.length === 0) return [];

  const excludedFromUsdCount = deduped.filter((a) => a.amount_total == null).length;

  const byTool = new Map<string, InfraBillingInvoiceAtom[]>();
  for (const a of deduped) {
    // Prefer normalized label; fall back to raw provider_label; else Unspecified.
    const tool = toolFromAtom(a) || a.provider_label?.trim() || UNSPECIFIED_TOOL;
    const list = byTool.get(tool) ?? [];
    list.push(a);
    byTool.set(tool, list);
  }

  if (byTool.size === 0) return [];

  const toolKeys = Array.from(byTool.keys()).sort((a, b) => {
    if (a === UNSPECIFIED_TOOL) return 1;
    if (b === UNSPECIFIED_TOOL) return -1;
    return a.localeCompare(b);
  });
  const toolBlocks = toolKeys.map((tool) => buildToolBlock(byTool.get(tool) ?? [], tool));

  const monthSet = new Set<string>();
  for (const block of toolBlocks) {
    for (const g of block.groups) {
      for (const p of g.projects) {
        for (const m of Object.keys(p.months)) monthSet.add(m);
      }
    }
  }
  // Include Unspecified month when an excluded invoice has a period but no USD.
  for (const a of deduped) {
    if (a.amount_total != null) continue;
    monthSet.add(billingMonthBucket(a.billing_period_start, a.billing_period_end));
  }
  const months = sortBillingMonths(Array.from(monthSet));

  const currency =
    deduped.find((a) => a.amount_total != null && a.currency?.trim())?.currency?.trim() ||
    "USD";

  return [
    {
      title: toolKeys.join(" · "),
      tools: toolKeys,
      currency,
      months,
      toolBlocks,
      groups: toolBlocks.flatMap((b) => b.groups),
      showOwnershipHeaders: toolBlocks.some((b) => b.showOwnershipHeaders),
      excludedFromUsdCount,
    },
  ];
}

export function buildInfraBillingRows(atoms: InfraBillingInvoiceAtom[]): InfraBillingRow[] {
  const sheets = buildInfraBillingSheets(atoms);
  const rows: InfraBillingRow[] = [];
  for (const sheet of sheets) {
    for (const block of sheet.toolBlocks) {
      for (const g of block.groups) {
        for (const p of g.projects) {
          rows.push({
            project_id: p.project_id,
            project_name: p.project_name,
            ownership_label: block.showOwnershipHeaders ? g.stakeholder : normalizeStakeholder(null),
            provider_label: block.tool,
            currency: sheet.currency,
            total: p.total,
            months: p.months,
          });
        }
      }
    }
  }
  return rows;
}

export function groupInfraBillingTotals(rows: InfraBillingRow[]): {
  ownership_label: string;
  total: number;
  months: Record<string, number>;
}[] {
  const map = new Map<string, { ownership_label: string; total: number; months: Record<string, number> }>();
  for (const r of rows) {
    let g = map.get(r.ownership_label);
    if (!g) {
      g = { ownership_label: r.ownership_label, total: 0, months: {} };
      map.set(r.ownership_label, g);
    }
    g.total += r.total;
    for (const [m, v] of Object.entries(r.months)) {
      g.months[m] = (g.months[m] ?? 0) + v;
    }
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      total: round1(g.total),
      months: Object.fromEntries(
        Object.entries(g.months).map(([k, v]) => [k, round1(Number(v))])
      ),
    }))
    .sort((a, b) => a.ownership_label.localeCompare(b.ownership_label));
}

export function sheetProjectColumns(sheet: InfraBillingToolSheet): InfraBillingProjectCol[] {
  return sheet.toolBlocks.flatMap((b) => b.groups.flatMap((g) => g.projects));
}

export function sheetGrandTotal(sheet: InfraBillingToolSheet): number {
  return round1(sheet.toolBlocks.reduce((acc, b) => acc + b.total, 0));
}

export function sheetMonthTotal(sheet: InfraBillingToolSheet, month: string): number {
  return round1(sheet.toolBlocks.reduce((acc, b) => acc + (b.months[month] ?? 0), 0));
}

export function groupLabel(g: InfraBillingStakeholderGroup): string {
  return g.stakeholder;
}

export function excelSafeSheetName(title: string, used: Set<string>): string {
  let base = title.replace(/[\\/*?:\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
  if (!base) base = "InfraBilling";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n++;
  }
  used.add(name.toLowerCase());
  return name;
}

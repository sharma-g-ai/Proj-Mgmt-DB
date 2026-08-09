import type { SupabaseClient } from "@supabase/supabase-js";
import { addWeeks, mondayOf, round1 } from "@/lib/format";
import type { ProjectMetrics } from "@/lib/types";
import type {
  ReportData,
  ReportTeamRow,
  ReportHoursRow,
  ReportProjectRow,
  FinancePerson,
  FinanceHours,
} from "@/lib/report/types";
import {
  normalizeToolLabel,
  type InfraBillingInvoiceAtom,
} from "@/lib/report/infraBilling";
import { amountToUsd, loadUsdRatesForCurrencies, REPORT_CURRENCY } from "@/lib/infra/fx";
import { effectiveInvoiceAmount, resolveInvoiceCurrency } from "@/lib/infra/money";

/** First non-empty tool label, preferring normalized known vendors. */
function pickToolLabel(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    const normalized = normalizeToolLabel(c);
    if (normalized) return normalized;
    const raw = typeof c === "string" ? c.trim() : "";
    if (raw) return raw;
  }
  return null;
}

// Recent-weeks default for the Team Allocation sheet (Spec 08 §3.2).
const RECENT_WEEKS = 12;

// Gathers all report data using the CALLER'S session client, so RLS scopes it to
// exactly what the user may see (Spec 08 §1/§4 — no separate report-layer auth).
export async function gatherReportData(
  supabase: SupabaseClient,
  opts: {
    generatedBy: string;
    isAdmin: boolean;
    isInfraOps?: boolean;
    canViewInfraBilling: boolean;
    projectId?: string | null; // present => single-project scope
    includeArchived: boolean;
    fullHistory: boolean;
  }
): Promise<ReportData> {
  let pq = supabase.from("project_metrics").select("*");
  if (opts.projectId) pq = pq.eq("project_id", opts.projectId);
  if (!opts.includeArchived) pq = pq.eq("is_archived", false);
  const { data: projData } = await pq.order("planned_end_date", { ascending: true, nullsFirst: false });
  const projects = (projData ?? []) as ProjectMetrics[];
  const nameById = new Map(projects.map((p) => [p.project_id, p.project_name]));
  const ids = projects.map((p) => p.project_id);

  let team: ReportTeamRow[] = [];
  let hours: ReportHoursRow[] = [];
  // Per-logged-entry atoms the client pivots per month (admin Finance view).
  const financeHours: FinanceHours[] = [];

  // InfraOps only needs project names for InfraBilling — skip PM hours/team gathers.
  if (ids.length > 0 && !opts.isInfraOps) {
    let tq = supabase
      .from("project_team_member")
      .select("project_id, user_id, allocated_hours, start_date, end_date, users(full_name)")
      .in("project_id", ids)
      .order("start_date", { ascending: false });
    if (!opts.fullHistory) {
      // Allocations still active within the recent window (range overlaps cutoff).
      tq = tq.gte("end_date", addWeeks(mondayOf(new Date()), -RECENT_WEEKS));
    }
    const { data: tRows } = await tq;
    const tList = (tRows ?? []) as unknown as {
      project_id: string;
      user_id: string;
      allocated_hours: number;
      start_date: string;
      end_date: string;
      users: { full_name: string } | null;
    }[];
    team = tList.map((r) => ({
      project_name: nameById.get(r.project_id) ?? "—",
      person: r.users?.full_name ?? "Unknown",
      start_date: r.start_date,
      end_date: r.end_date,
      allocated_hours: round1(r.allocated_hours),
    }));

    const { data: hRows } = await supabase
      .from("hours_log_entry")
      .select("project_id, user_id, hours_logged, start_date, end_date, source, category, users(full_name)")
      .in("project_id", ids)
      .order("start_date", { ascending: false });
    const hList = (hRows ?? []) as unknown as {
      project_id: string;
      user_id: string;
      hours_logged: number;
      start_date: string;
      end_date: string;
      source: string;
      category: string;
      users: { full_name: string } | null;
    }[];
    hours = hList.map((r) => ({
      project_name: nameById.get(r.project_id) ?? "—",
      person: r.users?.full_name ?? "Unknown",
      start_date: r.start_date,
      end_date: r.end_date,
      hours_logged: r.hours_logged,
      category: r.category,
      source: r.source,
    }));
    // Finance atoms (admin only): the client pivots logged hours per month.
    if (opts.isAdmin) {
      for (const r of hList) {
        financeHours.push({
          user_id: r.user_id,
          project_name: nameById.get(r.project_id) ?? "—",
          hours_logged: r.hours_logged,
          start_date: r.start_date,
          end_date: r.end_date,
        });
      }
    }
  }

  // Expand to one row per (project × team member); project columns repeat. A
  // project with no members appears once with a placeholder resource so it still
  // shows in the Portfolio view. Grouped by project (projects are already ordered).
  const teamByProject = new Map<string, ReportTeamRow[]>();
  for (const t of team) {
    const list = teamByProject.get(t.project_name);
    if (list) list.push(t);
    else teamByProject.set(t.project_name, [t]);
  }
  const projectRows: ReportProjectRow[] = [];
  if (!opts.isInfraOps) {
    for (const p of projects) {
      const members = teamByProject.get(p.project_name) ?? [];
      if (members.length === 0) {
        projectRows.push({ ...p, person: "—", allocated_hours: null });
      } else {
        for (const m of members) {
          projectRows.push({ ...p, person: m.person, allocated_hours: m.allocated_hours });
        }
      }
    }
  }

  // Finance pivot (admin only): the client pivots financeHours (logged entries) per
  // month. We send the directory (all users, incl. bench) so zero rows appear, plus
  // the project-name columns. Role label = the user's designation.
  const financeProjects = opts.isInfraOps ? [] : projects.map((p) => p.project_name);
  let financePeople: FinancePerson[] = [];
  if (opts.isAdmin) {
    const { data: uRows } = await supabase
      .from("users")
      .select("user_id, full_name, employee_id, designation:designation_option(label)")
      .order("full_name");
    financePeople = ((uRows ?? []) as unknown as {
      user_id: string;
      full_name: string;
      employee_id: string | null;
      designation: { label: string } | null;
    }[]).map((u) => ({
      user_id: u.user_id,
      employee_id: u.employee_id,
      name: u.full_name,
      role_label: u.designation?.label ?? "—",
    }));
  }

  const scopeLabel = opts.projectId
    ? `Project: ${projects[0]?.project_name ?? "—"}`
    : opts.isAdmin
      ? "All Projects — Admin View"
      : opts.isInfraOps
        ? "All Projects — InfraOps View"
        : "My Projects — Manager-Lead View";

  // InfraBilling atoms — RLS on infra_invoice + project already scopes visibility.
  let infraBillingAtoms: InfraBillingInvoiceAtom[] = [];
  if (opts.canViewInfraBilling && ids.length > 0) {
    const { data: invRows } = await supabase
      .from("infra_invoice")
      .select(
        "invoice_id, invoice_number, project_id, amount_total, currency, billing_period_start, billing_period_end, extracted_payload, provider:infra_provider(label)"
      )
      .in("project_id", ids);
    const invList = (invRows ?? []) as unknown as {
      invoice_id: string;
      invoice_number: string | null;
      project_id: string;
      amount_total: number | null;
      currency: string | null;
      billing_period_start: string | null;
      billing_period_end: string | null;
      extracted_payload: Record<string, unknown> | null;
      provider: { label: string } | null;
    }[];
    const invIds = invList.map((i) => i.invoice_id);
    const { data: lineRows } = invIds.length
      ? await supabase
          .from("infra_invoice_line")
          .select("invoice_id, amount")
          .in("invoice_id", invIds)
      : { data: [] as { invoice_id: string; amount: number | null }[] };
    const linesByInv = new Map<string, Array<{ amount?: unknown }>>();
    for (const l of lineRows ?? []) {
      const list = linesByInv.get(l.invoice_id) ?? [];
      list.push({ amount: l.amount });
      linesByInv.set(l.invoice_id, list);
    }

    const projectIds = Array.from(new Set(invList.map((i) => i.project_id)));
    const { data: billingAccountRows } = projectIds.length
      ? await supabase
          .from("project_billing_account")
          .select("project_id, account_id, account_name")
          .in("project_id", projectIds)
      : { data: [] as { project_id: string; account_id: string; account_name: string | null }[] };
    const accountNameByProject = new Map<string, Map<string, string>>();
    for (const row of billingAccountRows ?? []) {
      const key = row.account_id.trim().toLowerCase();
      if (!key) continue;
      let m = accountNameByProject.get(row.project_id);
      if (!m) {
        m = new Map();
        accountNameByProject.set(row.project_id, m);
      }
      const label = row.account_name?.trim();
      if (label) m.set(key, label);
    }

    const rawAtoms = invList.map((inv) => {
      const p = projects.find((x) => x.project_id === inv.project_id);
      const vendor =
        typeof inv.extracted_payload?.vendor_name === "string"
          ? inv.extracted_payload.vendor_name.trim()
          : "";
      const currency = resolveInvoiceCurrency(inv);
      const amount_total = effectiveInvoiceAmount(inv, linesByInv.get(inv.invoice_id) ?? []);
      const account_id =
        typeof inv.extracted_payload?.account_id === "string"
          ? inv.extracted_payload.account_id.trim() || null
          : null;
      const account_name = account_id
        ? accountNameByProject.get(inv.project_id)?.get(account_id.toLowerCase()) ?? null
        : null;
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        project_id: inv.project_id,
        project_name: p?.project_name ?? nameById.get(inv.project_id) ?? "—",
        stakeholder: p?.stakeholder ?? null,
        ownership_label: p?.ownership_label ?? null,
        // Invoice Source first (required on upload), then extracted vendor, then project tool.
        // Keep unknown tool names as typed (E2E, Datadog, …); only shorten known vendors.
        provider_label: pickToolLabel(inv.provider?.label, vendor, p?.provider_label),
        account_id,
        account_name,
        billing_period_start: inv.billing_period_start,
        billing_period_end: inv.billing_period_end,
        amount_total,
        currency,
      };
    });

    // Reports are USD-only — convert with live rates (Google Finance, ECB fallback).
    // Failed conversion keeps amount_total null (excluded from sums — never silent $0).
    const rates = await loadUsdRatesForCurrencies(rawAtoms.map((a) => a.currency));
    infraBillingAtoms = rawAtoms.map((a) => {
      const usd = amountToUsd(a.amount_total, a.currency, rates);
      if (usd == null) {
        return { ...a, amount_total: null, currency: a.currency };
      }
      return { ...a, amount_total: usd, currency: REPORT_CURRENCY };
    });
  }

  return {
    generatedBy: opts.generatedBy,
    generatedAt: new Date(),
    scopeLabel,
    projects: opts.isInfraOps ? [] : projects,
    projectRows,
    team,
    hours,
    finance: [], // computed client-side per month; carried on the export POST
    financePeople,
    financeHours,
    financeProjects,
    infraBillingAtoms,
    infraBilling: [],
    infraBillingSheets: [],
    infraBillingMonths: [],
  };
}

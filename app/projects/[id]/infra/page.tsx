import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser, canManageInfra, isInfraOpsRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { InfraResourcesSection } from "@/components/infra/InfraResourcesSection";
import { InfraInvoicesSection } from "@/components/infra/InfraInvoicesSection";
import {
  ProjectBillingSetupModal,
  ProjectBillingSummary,
} from "@/components/infra/ProjectBillingSetupModal";
import type {
  InfraDiscrepancyRow,
  InfraInvoiceLineRow,
  InfraInvoiceRow,
  InfraResourceRow,
  InfraResourceType,
  ProjectBillingAccount,
  ProjectMetrics,
  ProviderOption,
} from "@/lib/types";
import { loadUsdRatesForCurrencies } from "@/lib/infra/fx";
import { REPORT_CURRENCY } from "@/lib/infra/fxConstants";
import { resolveInvoiceCurrency } from "@/lib/infra/money";

export default async function ProjectInfraPage({ params }: { params: { id: string } }) {
  const { userId, profile } = await requireActiveUser();
  const manage = canManageInfra(profile);
  const infraOpsOnly = isInfraOpsRole(profile);
  const supabase = createClient();

  const { data: m } = await supabase
    .from("project_metrics")
    .select("*")
    .eq("project_id", params.id)
    .maybeSingle();
  if (!m) notFound();
  const project = m as ProjectMetrics;

  const canView = manage || project.manager_lead_id === userId;
  if (!canView) notFound();

  const [
    { data: resources },
    { data: resourceTypes },
    { data: invoices },
    { data: providers },
    { data: billingAccounts },
    { data: projectRow },
  ] = await Promise.all([
      supabase
        .from("infra_resource")
        .select("*, resource_type:infra_resource_type(label)")
        .eq("project_id", params.id)
        .order("name"),
      supabase
        .from("infra_resource_type")
        .select("resource_type_id, label, is_active")
        .eq("is_active", true)
        .order("label"),
      supabase
        .from("infra_invoice")
        .select("*, provider:infra_provider(label)")
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("infra_provider")
        .select("provider_id, label, is_active")
        .eq("is_active", true)
        .order("label"),
      supabase
        .from("project_billing_account")
        .select("account_row_id, project_id, account_id, account_name, created_at")
        .eq("project_id", params.id)
        .order("account_id"),
      supabase
        .from("project")
        .select("provider_id, enforce_billing_accounts, provider:infra_provider(label)")
        .eq("project_id", params.id)
        .maybeSingle(),
    ]);

  const accountRows = (billingAccounts ?? []) as ProjectBillingAccount[];
  const providerRel = projectRow?.provider as
    | { label?: string }
    | { label?: string }[]
    | null
    | undefined;
  const projectProviderLabel = Array.isArray(providerRel)
    ? providerRel[0]?.label ?? null
    : providerRel?.label ?? null;
  const projectProviderId = (projectRow?.provider_id as string | null) ?? null;
  const enforceBillingAccounts = projectRow?.enforce_billing_accounts === true;
  // Tool is always required; account allow-list is optional (toggle).
  const billingSetupComplete = !!projectProviderId;

  const invoiceIds = (invoices ?? []).map((i) => i.invoice_id as string);
  const [{ data: lines }, { data: discrepancies }] = await Promise.all([
    invoiceIds.length
      ? supabase.from("infra_invoice_line").select("*").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] as InfraInvoiceLineRow[] }),
    invoiceIds.length
      ? supabase.from("infra_billing_discrepancy").select("*").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] as InfraDiscrepancyRow[] }),
  ]);

  const linesByInvoice: Record<string, InfraInvoiceLineRow[]> = {};
  for (const l of (lines ?? []) as InfraInvoiceLineRow[]) {
    (linesByInvoice[l.invoice_id] ??= []).push(l);
  }
  const discrepanciesByInvoice: Record<string, InfraDiscrepancyRow[]> = {};
  for (const d of (discrepancies ?? []) as InfraDiscrepancyRow[]) {
    (discrepanciesByInvoice[d.invoice_id] ??= []).push(d);
  }

  const openOutOfScopeCount = ((discrepancies ?? []) as InfraDiscrepancyRow[]).filter(
    (d) => d.status === "open" && d.discrepancy_type === "out_of_scope_service"
  ).length;

  const invoiceList = (invoices ?? []) as unknown as InfraInvoiceRow[];
  // Rates keyed by ISO code → multiplier to USD (live from Google Finance / ECB).
  const invoiceCurrencies = invoiceList.map((i) => resolveInvoiceCurrency(i));
  const rateMap = await loadUsdRatesForCurrencies(invoiceCurrencies);
  const usdRates: Record<string, number> = {};
  for (const [code, fx] of Array.from(rateMap.entries())) {
    usdRates[code] = fx.rate;
  }
  if (usdRates[REPORT_CURRENCY] == null) usdRates[REPORT_CURRENCY] = 1;

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-gray-500">
              <Link href="/projects" className="hover:text-gray-700">
                Projects
              </Link>
              <span>/</span>
              {!infraOpsOnly && (
                <>
                  <Link href={`/projects/${project.project_id}`} className="hover:text-gray-700">
                    {project.project_name}
                  </Link>
                  <span>/</span>
                </>
              )}
              {infraOpsOnly && (
                <>
                  <span className="text-gray-700">{project.project_name}</span>
                  <span>/</span>
                </>
              )}
              <span className="text-gray-700">InfraSpecs</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">InfraSpecs</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {manage
                ? "Resources from any provider (cloud, SaaS, licenses…) plus month-wise billing."
                : "View-only — resources and billing for this project."}
            </p>
          </div>
          <Link
            href={infraOpsOnly ? "/projects" : `/projects/${project.project_id}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            {infraOpsOnly ? "Back to projects" : "Back to project"}
          </Link>
        </div>

        {!billingSetupComplete && manage && (
          <ProjectBillingSetupModal
            projectId={project.project_id}
            providers={(providers ?? []) as ProviderOption[]}
            initialProviderLabel={projectProviderLabel ?? ""}
            initialEnforce={enforceBillingAccounts}
          />
        )}

        {!billingSetupComplete && !manage && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Billing setup incomplete — an Admin or InfraOps user must set the billing tool before
            invoices can be uploaded. Account restriction is optional.
          </div>
        )}

        {billingSetupComplete && projectProviderLabel && (
          <ProjectBillingSummary
            projectId={project.project_id}
            providerLabel={projectProviderLabel}
            accounts={accountRows}
            providers={(providers ?? []) as ProviderOption[]}
            canEdit={manage}
            invoiceCount={invoiceList.length}
            enforceBillingAccounts={enforceBillingAccounts}
          />
        )}

        <InfraResourcesSection
          projectId={project.project_id}
          resources={(resources ?? []) as unknown as InfraResourceRow[]}
          resourceTypes={(resourceTypes ?? []) as InfraResourceType[]}
          canEdit={manage && billingSetupComplete}
          openOutOfScopeCount={openOutOfScopeCount}
        />

        <InfraInvoicesSection
          projectId={project.project_id}
          invoices={invoiceList}
          linesByInvoice={linesByInvoice}
          discrepanciesByInvoice={discrepanciesByInvoice}
          resources={(resources ?? []) as unknown as InfraResourceRow[]}
          providers={(providers ?? []) as ProviderOption[]}
          projectProviderLabel={projectProviderLabel}
          billingSetupComplete={billingSetupComplete}
          usdRates={usdRates}
          canEdit={manage && billingSetupComplete}
          billingAccounts={accountRows}
        />
      </main>
    </div>
  );
}

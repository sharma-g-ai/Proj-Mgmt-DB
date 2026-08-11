import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser, canManageInfra, isInfraOpsRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { InvoiceDetailView } from "@/components/infra/InvoiceDetailView";
import { createInvoiceSignedUrl } from "@/lib/infra/storage";
import { loadUsdRatesForCurrencies } from "@/lib/infra/fx";
import { REPORT_CURRENCY } from "@/lib/infra/fxConstants";
import { resolveInvoiceCurrency } from "@/lib/infra/money";
import type {
  InfraDiscrepancyRow,
  InfraInvoiceLineRow,
  InfraInvoiceRow,
  InfraResourceRow,
  ProjectMetrics,
  ProviderOption,
} from "@/lib/types";

export default async function InvoiceDetailPage({
  params,
}: {
  params: { id: string; invoiceId: string };
}) {
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

  const [{ data: inv }, { data: lines }, { data: resources }, { data: providers }, { data: discrepancies }] =
    await Promise.all([
      supabase
        .from("infra_invoice")
        .select("*, provider:infra_provider(label)")
        .eq("project_id", params.id)
        .eq("invoice_id", params.invoiceId)
        .maybeSingle(),
      supabase
        .from("infra_invoice_line")
        .select("*")
        .eq("invoice_id", params.invoiceId)
        .order("created_at"),
      supabase
        .from("infra_resource")
        .select("resource_id, name, external_id, resource_type:infra_resource_type(label)")
        .eq("project_id", params.id),
      supabase
        .from("infra_provider")
        .select("provider_id, label, is_active")
        .eq("is_active", true)
        .order("label"),
      supabase
        .from("infra_billing_discrepancy")
        .select("*")
        .eq("invoice_id", params.invoiceId),
    ]);

  if (!inv) notFound();
  const invoice = inv as unknown as InfraInvoiceRow;
  const lineRows = (lines ?? []) as InfraInvoiceLineRow[];

  const signed = await createInvoiceSignedUrl(invoice.storage_path, 3600);
  const fileUrl = signed.url;
  const fileError = signed.error;

  const rateMap = await loadUsdRatesForCurrencies([resolveInvoiceCurrency(invoice)]);
  const usdRates: Record<string, number> = {};
  for (const [code, fx] of Array.from(rateMap.entries())) {
    usdRates[code] = fx.rate;
  }
  if (usdRates[REPORT_CURRENCY] == null) usdRates[REPORT_CURRENCY] = 1;

  const scopedResources = ((resources ?? []) as unknown as InfraResourceRow[]).map((r) => ({
    resource_id: r.resource_id,
    name: r.name,
    external_id: r.external_id,
    resource_type_label: r.resource_type?.label ?? null,
  }));

  const backHref = `/projects/${project.project_id}/infra`;
  const title =
    invoice.invoice_number ||
    invoice.original_filename ||
    invoice.invoice_id.slice(0, 8);

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
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
              <Link href={backHref} className="hover:text-gray-700">
                InfraSpecs
              </Link>
              <span>/</span>
              <span className="text-gray-700">Invoice</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Compare the uploaded file with extracted billing data
              {manage ? " — edit if extraction missed something." : "."}
            </p>
          </div>
          <Link
            href={backHref}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Back to InfraSpecs
          </Link>
        </div>

        <InvoiceDetailView
          projectId={project.project_id}
          invoice={invoice}
          lines={lineRows}
          providers={(providers ?? []) as ProviderOption[]}
          scopedResources={scopedResources}
          discrepancies={(discrepancies ?? []) as InfraDiscrepancyRow[]}
          usdRates={usdRates}
          fileUrl={fileUrl}
          fileError={fileError ?? null}
          canEdit={manage}
          backHref={backHref}
        />
      </main>
    </div>
  );
}

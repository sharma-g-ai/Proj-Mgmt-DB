/**
 * Deterministic billing discrepancy detection (Phase-1 BRD).
 * Compares invoice totals/lines and flags charges not in project InfraSpecs scope.
 * Does not invent values — only compares supplied data.
 */

export type ScopeResource = {
  resource_id: string;
  name: string;
  external_id: string | null;
  resource_type_label: string | null;
};

export type InvoiceLineForCheck = {
  amount: number | null;
  line_label?: string | null;
  resource_type_label?: string | null;
  attributes?: Record<string, unknown>;
};

export type DiscrepancyInput = {
  invoiceId: string;
  amountTotal: number | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  invoiceNumber: string | null;
  lines: InvoiceLineForCheck[];
  /** Project InfraSpecs — services/instances in scope. */
  scopedResources?: ScopeResource[];
  /** Other invoices on the same project (for duplicate detection). */
  siblingInvoices?: Array<{
    invoice_id: string;
    invoice_number: string | null;
    billing_period_start: string | null;
    billing_period_end: string | null;
    amount_total: number | null;
  }>;
};

export type DetectedDiscrepancy = {
  discrepancy_type: string;
  severity: "info" | "warning" | "error";
  message: string;
  expected_value: string | null;
  actual_value: string | null;
  metadata: Record<string, unknown>;
};

const EPS = 0.01;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * AWS (and similar) bills often name the *service*, not the instance.
 * Map common line labels → InfraSpecs type labels so inventory by service clears OOS.
 */
const SERVICE_LINE_TYPE_ALIASES: Array<{ match: RegExp; types: string[] }> = [
  { match: /elastic compute cloud|\bec2\b/, types: ["ec2 — virtual server"] },
  { match: /simple storage service|\bs3\b/, types: ["s3 — object storage"] },
  { match: /relational database service|\brds\b/, types: ["rds — relational database", "aurora — managed sql"] },
  { match: /virtual private cloud|\bvpc\b/, types: ["vpc — virtual private cloud", "vpc"] },
  {
    match: /elastic load balancing|\belb\b|application load balancer|network load balancer/,
    types: ["alb — application load balancer", "nlb — network load balancer", "load balancer"],
  },
  { match: /route\s*53/, types: ["route 53 — dns"] },
  { match: /lightsail/, types: ["lightsail — simple vps"] },
  { match: /\blambda\b/, types: ["lambda — serverless functions"] },
  { match: /cloudfront/, types: ["cloudfront — cdn"] },
  { match: /elasticache|elastic cache/, types: ["elasticache — redis / memcached"] },
  { match: /dynamodb/, types: ["dynamodb — nosql database"] },
  { match: /eks|elastic kubernetes service/, types: ["eks — kubernetes"] },
  { match: /\becs\b|elastic container service/, types: ["ecs — container service"] },
  { match: /fargate/, types: ["fargate", "ecs — container service"] },
  { match: /elastic container registry|\becr\b/, types: ["ecr — container registry"] },
  { match: /secrets manager/, types: ["secrets manager / ssm"] },
  { match: /key management service|\bkms\b/, types: ["kms / encryption", "secrets manager / ssm"] },
  { match: /cloudwatch/, types: ["cloudwatch"] },
  { match: /cloudtrail/, types: ["cloudtrail"] },
  { match: /\bwaf\b/, types: ["waf"] },
  { match: /api gateway/, types: ["api gateway"] },
  { match: /\bsqs\b|simple queue/, types: ["sqs — queue"] },
  { match: /\bsns\b|simple notification/, types: ["sns — topic"] },
  { match: /eventbridge/, types: ["eventbridge"] },
  { match: /step functions/, types: ["step functions"] },
  { match: /sagemaker/, types: ["sagemaker"] },
  { match: /bedrock/, types: ["bedrock"] },
  { match: /opensearch|elasticsearch service/, types: ["opensearch service"] },
  { match: /\bkinesis\b/, types: ["kinesis data streams", "kinesis data firehose"] },
  { match: /\bglue\b/, types: ["glue"] },
  { match: /\bathena\b/, types: ["athena"] },
  { match: /redshift/, types: ["redshift — data warehouse"] },
  { match: /nat gateway/, types: ["nat gateway"] },
  { match: /transit gateway/, types: ["transit gateway"] },
  { match: /elastic block store|\bebs\b/, types: ["ebs — block volume"] },
  { match: /elastic file system|\befs\b/, types: ["efs — file system"] },
];

function typesInferredFromLineLabel(label: string): string[] {
  if (!label) return [];
  const out: string[] = [];
  for (const row of SERVICE_LINE_TYPE_ALIASES) {
    if (row.match.test(label)) out.push(...row.types);
  }
  return out;
}

/** True if an invoice line appears to refer to a scoped project resource. */
export function lineMatchesScope(
  line: InvoiceLineForCheck,
  resources: ScopeResource[]
): boolean {
  // Empty inventory = nothing authorized → no line is in scope.
  if (resources.length === 0) return false;
  const label = norm(line.line_label);
  const typeLabel = norm(line.resource_type_label);
  const attrId = norm(
    line.attributes && typeof line.attributes.resource_id === "string"
      ? line.attributes.resource_id
      : line.attributes && typeof line.attributes.instance_id === "string"
        ? String(line.attributes.instance_id)
        : null
  );

  const scopedTypes = new Set(
    resources.map((r) => norm(r.resource_type_label)).filter(Boolean)
  );

  for (const r of resources) {
    const name = norm(r.name);
    const ext = norm(r.external_id);
    if (ext && (label.includes(ext) || attrId === ext)) return true;
    if (name && (label === name || label.includes(name))) return true;
  }

  // Service / type match — cloud bills are usually one row per service, not per instance.
  if (typeLabel && scopedTypes.has(typeLabel)) return true;

  for (const inferred of typesInferredFromLineLabel(label)) {
    if (scopedTypes.has(inferred)) return true;
  }

  return false;
}

export function detectBillingDiscrepancies(input: DiscrepancyInput): DetectedDiscrepancy[] {
  const out: DetectedDiscrepancy[] = [];

  const lineSum = input.lines.reduce((acc, l) => {
    if (l.amount == null || Number.isNaN(Number(l.amount))) return acc;
    return acc + Number(l.amount);
  }, 0);
  const hasLineAmounts = input.lines.some((l) => l.amount != null);

  if (input.amountTotal == null) {
    out.push({
      discrepancy_type: "missing_invoice_total",
      severity: "warning",
      message: "Invoice total amount is missing.",
      expected_value: null,
      actual_value: null,
      metadata: {},
    });
  } else if (hasLineAmounts && Math.abs(lineSum - Number(input.amountTotal)) > EPS) {
    out.push({
      discrepancy_type: "line_sum_mismatch",
      severity: "error",
      message: "Sum of line amounts does not match invoice total.",
      expected_value: String(input.amountTotal),
      actual_value: String(Math.round(lineSum * 100) / 100),
      metadata: { line_count: input.lines.length },
    });
  }

  if (!input.billingPeriodStart && !input.billingPeriodEnd) {
    out.push({
      discrepancy_type: "missing_billing_period",
      severity: "warning",
      message: "Billing period start and end are missing.",
      expected_value: null,
      actual_value: null,
      metadata: {},
    });
  } else if (
    input.billingPeriodStart &&
    input.billingPeriodEnd &&
    input.billingPeriodEnd < input.billingPeriodStart
  ) {
    out.push({
      discrepancy_type: "billing_period_order",
      severity: "error",
      message: "Billing period end is before start.",
      expected_value: `end >= ${input.billingPeriodStart}`,
      actual_value: input.billingPeriodEnd,
      metadata: {},
    });
  }

  if (input.lines.length === 0) {
    out.push({
      discrepancy_type: "missing_line_items",
      severity: "info",
      message: "No line items were extracted from the invoice.",
      expected_value: null,
      actual_value: "0",
      metadata: {},
    });
  }

  const scope = input.scopedResources ?? [];
  for (const line of input.lines) {
    // Zero-amount lines stay visible but are not treated as out-of-scope charges.
    const amt = line.amount == null || Number.isNaN(Number(line.amount)) ? 0 : Number(line.amount);
    if (Math.abs(amt) <= EPS) continue;

    const identity =
      line.line_label ||
      line.resource_type_label ||
      (line.attributes?.resource_id as string | undefined) ||
      "unnamed line";
    if (!lineMatchesScope(line, scope)) {
      out.push({
        discrepancy_type: "out_of_scope_service",
        severity: "error",
        message:
          scope.length === 0
            ? "No InfraSpecs resources on this project — charged line is out of scope until matching resources are added."
            : "Invoice line is not in this project's InfraSpecs scope (unauthorized / unrecorded usage).",
        expected_value: "listed in project InfraSpecs",
        actual_value: String(identity),
        metadata: {
          line_label: line.line_label,
          resource_type_label: line.resource_type_label,
          amount: line.amount,
          empty_scope: scope.length === 0,
        },
      });
    }
  }

  const siblings = input.siblingInvoices ?? [];
  if (input.invoiceNumber) {
    const dupNum = siblings.find(
      (s) =>
        s.invoice_id !== input.invoiceId &&
        s.invoice_number &&
        s.invoice_number.toLowerCase() === input.invoiceNumber!.toLowerCase()
    );
    if (dupNum) {
      out.push({
        discrepancy_type: "duplicate_invoice_number",
        severity: "error",
        message: "Another invoice on this project shares the same invoice number.",
        expected_value: "unique invoice_number per project",
        actual_value: input.invoiceNumber,
        metadata: { other_invoice_id: dupNum.invoice_id },
      });
    }
  }

  if (input.billingPeriodStart && input.billingPeriodEnd) {
    const dupPeriod = siblings.find(
      (s) =>
        s.invoice_id !== input.invoiceId &&
        s.billing_period_start === input.billingPeriodStart &&
        s.billing_period_end === input.billingPeriodEnd &&
        (input.amountTotal == null ||
          s.amount_total == null ||
          Math.abs(Number(s.amount_total) - Number(input.amountTotal)) <= EPS)
    );
    if (dupPeriod) {
      out.push({
        discrepancy_type: "duplicate_billing_period",
        severity: "warning",
        message: "Another invoice covers the same billing period on this project.",
        expected_value: null,
        actual_value: `${input.billingPeriodStart}…${input.billingPeriodEnd}`,
        metadata: { other_invoice_id: dupPeriod.invoice_id },
      });
    }
  }

  return out;
}

export function validationStatusFromDiscrepancies(
  discrepancies: DetectedDiscrepancy[]
): "valid" | "invalid" | "partial" | "unchecked" {
  if (discrepancies.length === 0) return "valid";
  if (discrepancies.some((d) => d.severity === "error")) return "invalid";
  if (discrepancies.some((d) => d.severity === "warning")) return "partial";
  return "partial";
}

/** Aggregate line amounts by instance / type for at-a-glance billing. */
export type InstanceBillingRow = {
  key: string;
  instance_label: string;
  resource_type_label: string;
  in_scope: boolean | null;
  amount: number;
  line_count: number;
};

export function buildInstanceBillingRows(
  lines: InvoiceLineForCheck[],
  scopedResources: ScopeResource[] = []
): InstanceBillingRow[] {
  const map = new Map<string, InstanceBillingRow>();

  for (const line of lines) {
    const instance =
      (typeof line.attributes?.resource_id === "string" && line.attributes.resource_id) ||
      (typeof line.attributes?.instance_id === "string" && line.attributes.instance_id) ||
      line.line_label ||
      "Unspecified";
    const typeLabel = line.resource_type_label || "Unspecified";
    const key = `${norm(typeLabel)}::${norm(String(instance))}`;
    const amt = line.amount == null || Number.isNaN(Number(line.amount)) ? 0 : Number(line.amount);
    const existing = map.get(key);
    // Zero-amount lines are never flagged out of scope in the UI.
    const inScope =
      Math.abs(amt) <= EPS ? null : lineMatchesScope(line, scopedResources);
    if (existing) {
      existing.amount += amt;
      existing.line_count += 1;
      if (inScope === false) existing.in_scope = false;
    } else {
      map.set(key, {
        key,
        instance_label: String(instance),
        resource_type_label: typeLabel,
        in_scope: inScope,
        amount: amt,
        line_count: 1,
      });
    }
  }

  return Array.from(map.values())
    .map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
    .sort((a, b) => {
      if (a.in_scope === false && b.in_scope !== false) return -1;
      if (b.in_scope === false && a.in_scope !== false) return 1;
      return a.resource_type_label.localeCompare(b.resource_type_label);
    });
}

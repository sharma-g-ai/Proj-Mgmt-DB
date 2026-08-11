/**
 * Recheck discrepancies for a project (REST + updated scope match).
 * Usage: node scripts/recheck-project-discrepancies.mjs [projectName]
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function makeApi(url, key) {
  const base = url.replace(/\/$/, "");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  return {
    async get(path) {
      const res = await fetch(`${base}/rest/v1/${path}`, { headers });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${text}`);
      return data;
    },
    async del(path) {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DELETE ${path}: ${res.status} ${text}`);
      }
    },
    async post(path, body) {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST ${path}: ${res.status} ${text}`);
      }
    },
    async patch(path, body) {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH ${path}: ${res.status} ${text}`);
      }
    },
  };
}

const EPS = 0.01;
const norm = (s) => (s ?? "").trim().toLowerCase();

const SERVICE_LINE_TYPE_ALIASES = [
  { match: /elastic compute cloud|\bec2\b/, types: ["ec2 — virtual server"] },
  { match: /simple storage service|\bs3\b/, types: ["s3 — object storage"] },
  {
    match: /relational database service|\brds\b/,
    types: ["rds — relational database", "aurora — managed sql"],
  },
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
  { match: /secrets manager/, types: ["secrets manager / ssm"] },
  { match: /key management service|\bkms\b/, types: ["kms / encryption", "secrets manager / ssm"] },
];

function typesInferredFromLineLabel(label) {
  if (!label) return [];
  const out = [];
  for (const row of SERVICE_LINE_TYPE_ALIASES) {
    if (row.match.test(label)) out.push(...row.types);
  }
  return out;
}

function lineMatchesScope(line, resources) {
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
  if (typeLabel && scopedTypes.has(typeLabel)) return true;
  for (const inferred of typesInferredFromLineLabel(label)) {
    if (scopedTypes.has(inferred)) return true;
  }
  return false;
}

function detectBillingDiscrepancies(input) {
  const out = [];
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
    const amt =
      line.amount == null || Number.isNaN(Number(line.amount)) ? 0 : Number(line.amount);
    if (Math.abs(amt) <= EPS) continue;
    const identity =
      line.line_label ||
      line.resource_type_label ||
      (line.attributes?.resource_id) ||
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
        s.invoice_number.toLowerCase() === input.invoiceNumber.toLowerCase()
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

  return out;
}

function validationStatusFromDiscrepancies(discrepancies) {
  if (discrepancies.length === 0) return "valid";
  if (discrepancies.some((d) => d.severity === "error")) return "invalid";
  if (discrepancies.some((d) => d.severity === "warning")) return "partial";
  return "partial";
}

async function recheckProject(api, project) {
  console.log(`\nRechecking ${project.project_name} (${project.project_id})`);

  const scopeRows = await api.get(
    `infra_resource?select=resource_id,name,external_id,resource_type:infra_resource_type(label)&project_id=eq.${project.project_id}`
  );
  const scopedResources = (scopeRows || []).map((r) => ({
    resource_id: r.resource_id,
    name: r.name,
    external_id: r.external_id,
    resource_type_label: r.resource_type?.label ?? null,
  }));

  const invoices = await api.get(
    `infra_invoice?select=invoice_id,invoice_number,amount_total,billing_period_start,billing_period_end&project_id=eq.${project.project_id}`
  );
  if (!invoices?.length) {
    console.log(`  (no invoices)`);
    return { invoices: 0, oos: 0 };
  }

  const siblings = invoices.map((s) => ({
    invoice_id: s.invoice_id,
    invoice_number: s.invoice_number,
    billing_period_start: s.billing_period_start,
    billing_period_end: s.billing_period_end,
    amount_total: s.amount_total != null ? Number(s.amount_total) : null,
  }));

  let totalOos = 0;
  for (const inv of invoices) {
    const lines = await api.get(
      `infra_invoice_line?select=amount,line_label,resource_type_label,attributes&invoice_id=eq.${inv.invoice_id}`
    );
    const detected = detectBillingDiscrepancies({
      invoiceId: inv.invoice_id,
      amountTotal: inv.amount_total != null ? Number(inv.amount_total) : null,
      billingPeriodStart: inv.billing_period_start,
      billingPeriodEnd: inv.billing_period_end,
      invoiceNumber: inv.invoice_number,
      lines: (lines || []).map((l) => ({
        amount: l.amount != null ? Number(l.amount) : null,
        line_label: l.line_label,
        resource_type_label: l.resource_type_label,
        attributes: l.attributes ?? {},
      })),
      scopedResources,
      siblingInvoices: siblings,
    });

    await api.del(`infra_billing_discrepancy?invoice_id=eq.${inv.invoice_id}`);
    if (detected.length) {
      await api.post(
        "infra_billing_discrepancy",
        detected.map((d) => ({
          invoice_id: inv.invoice_id,
          discrepancy_type: d.discrepancy_type,
          severity: d.severity,
          message: d.message,
          expected_value: d.expected_value,
          actual_value: d.actual_value,
          status: "open",
          metadata: d.metadata,
        }))
      );
    }

    const validation_status = validationStatusFromDiscrepancies(detected);
    await api.patch(`infra_invoice?invoice_id=eq.${inv.invoice_id}`, { validation_status });

    const oos = detected.filter((d) => d.discrepancy_type === "out_of_scope_service").length;
    totalOos += oos;
    console.log(
      `  ${inv.invoice_number || inv.invoice_id}: OOS=${oos}, resources=${scopedResources.length}, status=${validation_status}`
    );
  }
  return { invoices: invoices.length, oos: totalOos };
}

async function main() {
  const nameFilter = process.argv[2]; // omit = all projects with invoices
  const env = loadEnvLocal();
  const api = makeApi(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let projects;
  if (nameFilter) {
    projects = await api.get(
      `project?select=project_id,project_name&project_name=ilike.${encodeURIComponent(nameFilter)}&is_archived=eq.false`
    );
    if (!projects?.length) throw new Error(`No project matching "${nameFilter}"`);
  } else {
    // All non-archived projects that have at least one invoice
    const invProjects = await api.get(
      `infra_invoice?select=project_id`
    );
    const ids = [...new Set((invProjects || []).map((r) => r.project_id))];
    if (!ids.length) {
      console.log("No invoices found.");
      return;
    }
    projects = await api.get(
      `project?select=project_id,project_name&project_id=in.(${ids.join(",")})&is_archived=eq.false&order=project_name`
    );
  }

  console.log(`Projects to recheck: ${projects.length}`);
  let invCount = 0;
  let oosCount = 0;
  for (const project of projects) {
    const r = await recheckProject(api, project);
    invCount += r.invoices;
    oosCount += r.oos;
  }
  console.log(`\nDone. ${projects.length} project(s), ${invCount} invoice(s), ${oosCount} open OOS line(s).`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

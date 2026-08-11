/**
 * Diagnose OOS for Amzur: compare invoice lines vs resources.
 * Usage: node scripts/diagnose-amzur-oos.mjs
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
  };
  return {
    async get(path) {
      const res = await fetch(`${base}/rest/v1/${path}`, { headers });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`${res.status} ${text}`);
      return data;
    },
  };
}

function norm(s) {
  return (s ?? "").trim().toLowerCase();
}

function matches(line, resources) {
  if (!resources.length) return false;
  const label = norm(line.line_label);
  const typeLabel = norm(line.resource_type_label);
  for (const r of resources) {
    const name = norm(r.name);
    const ext = norm(r.external_id);
    const rType = norm(r.resource_type?.label);
    if (ext && label.includes(ext)) return true;
    if (name && (label === name || label.includes(name))) return true;
    if (rType && typeLabel && rType === typeLabel && name && label.includes(name)) return true;
  }
  return false;
}

async function main() {
  const env = loadEnvLocal();
  const api = makeApi(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const projects = await api.get(
    `project?select=project_id,project_name&project_name=ilike.*Amzur*&is_archived=eq.false`
  );
  console.log(
    "Projects:",
    projects.map((p) => `${p.project_name} (${p.project_id})`).join("; ")
  );

  for (const project of projects) {
    const resources = await api.get(
      `infra_resource?select=name,external_id,resource_type:infra_resource_type(label)&project_id=eq.${project.project_id}`
    );
    const invoices = await api.get(
      `infra_invoice?select=invoice_id,invoice_number,validation_status&project_id=eq.${project.project_id}`
    );
    console.log(`\n=== ${project.project_name} ===`);
    console.log(`Resources: ${resources.length}, Invoices: ${invoices.length}`);
    console.log(
      "Resource names sample:",
      resources.slice(0, 5).map((r) => r.name).join(", ")
    );

    for (const inv of invoices) {
      const lines = await api.get(
        `infra_invoice_line?select=line_label,resource_type_label,amount&invoice_id=eq.${inv.invoice_id}`
      );
      const discs = await api.get(
        `infra_billing_discrepancy?select=discrepancy_type,message,status,actual_value&invoice_id=eq.${inv.invoice_id}&discrepancy_type=eq.out_of_scope_service&status=eq.open`
      );
      console.log(
        `\nInvoice ${inv.invoice_number || inv.invoice_id} status=${inv.validation_status} lines=${lines.length} openOOS=${discs.length}`
      );
      for (const l of lines.slice(0, 15)) {
        const ok = matches(l, resources);
        console.log(
          `  [${ok ? "IN" : "OOS"}] amt=${l.amount} type=${JSON.stringify(l.resource_type_label)} label=${JSON.stringify(l.line_label)}`
        );
      }
      if (lines.length > 15) console.log(`  ... +${lines.length - 15} more lines`);
      if (discs[0]) console.log(`  OOS msg sample: ${discs[0].message}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

/**
 * One-off: seed Amzur project InfraSpecs resources (EC2 + S3).
 * Usage: node scripts/seed-amzur-resources.mjs
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

function inferEnv(name) {
  const n = name.toLowerCase();
  if (/(^|[-_\s])preprod([-_\s]|$)|pre-prod|preqa/.test(n)) return "Staging";
  if (/(^|[-_\s])prod([-_\s]|$)|production/.test(n) && !/preprod|pre-prod/.test(n))
    return "Production";
  if (/(^|[-_\s])uat([-_\s]|$)/.test(n)) return "UAT";
  if (/(^|[-_\s])qa([-_\s]|$)|dev|poc|test/.test(n)) return "Development";
  return "Shared";
}

function inferRegion(name) {
  const n = name.toLowerCase();
  if (n.includes("us-east-2")) return "us-east-2";
  if (n.includes("us-west-1")) return "us-west-1";
  if (n.includes("us-west-2")) return "us-west-2";
  if (n.includes("us-east-1")) return "us-east-1";
  return "us-east-1";
}

const EC2 = [
  ["Lead-Tracker-App", "t2.medium", 2, 4, 60],
  ["ALP Server", "t2.medium", 2, 4, 100],
  ["ashlly", "t3a.medium", 2, 4, 60],
  ["exam-center-2", "t3.large", 2, 8, 30],
  ["ai-poc-backendserver", "t3.small", 2, 2, 8],
  ["ai-poc-webapi", "t3.small", 2, 2, 8],
  ["humhub-preprod", "t3.small", 2, 2, 20],
  ["humhub-prod", "t3.medium", 2, 4, 30],
  ["docuxgurd-qa", "t3.medium", 2, 4, 100],
  ["humhub-qa", "t3.small", 2, 2, 20],
  ["docxguard-preqa", "t3.medium", 2, 4, 100],
  ["docxguard-sonartype-nexus", "t3.medium", 2, 4, 100],
  ["Amzur-Help-Desk-System", "t3.xlarge", 4, 16, 30],
  ["Amzur Projects Server", "t2.small", 1, 2, 12],
  ["Marketing-Proxy Server", "t3.small", 2, 2, 8],
  ["netsuite website server", "t3.small", 2, 2, 20],
  ["amzur-uat-website", "t3.medium", 2, 4, 50],
  ["Amzur-techisourpassion", "t3.medium", 2, 4, 20],
  ["amzur-uat-website-old", "t3.medium", 2, 4, 40],
  ["Bizintex CMS Server", "t3.small", 2, 2, 8],
];

const S3 = [
  "acms-redmine-db-backup",
  "ai-poc-webapp",
  "amz-qb-backups",
  "amzur-ats",
  "amzur-awareness-app",
  "amzur-backups",
  "amzur-helpdesk",
  "amzur-hrms",
  "amzur-leadtracker-app",
  "bizintex-cms",
  "cf-templates-g7uti1copqbg-us-east-2",
  "customersms",
  "data-dictionary",
  "der-web",
  "diabetiesexample",
  "elasticbeanstalk-us-east-1-617321634820",
  "elasticbeanstalk-us-east-2-617321634820",
  "elasticbeanstalk-us-west-1-617321634820",
  "elasticbeanstalk-us-west-2-617321634820",
  "iconf-documents",
  "iconf-profile",
  "iconf-profile-upload",
  "iconference-docs",
  "mcafee-mvision-dlp",
  "mia-ai",
  "polishsms",
  "redmine-s3-test",
  "s3-migration-source",
  "sprints.amzur",
  "stackyon-builds",
  "stackyon-dev-api-1",
  "www.gooseled.com",
  "www.sportsman-safe.com",
];

const EC2_LABEL = "EC2 — Virtual Server";
const S3_LABEL = "S3 — Object Storage";

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
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        throw new Error(`GET ${path}: ${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
      }
      return data;
    },
    async post(path, body, prefer) {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: "POST",
        headers: { ...headers, Prefer: prefer || "return=representation" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        throw new Error(`POST ${path}: ${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
      }
      return data;
    },
  };
}

async function ensureType(api, label) {
  const q = `infra_resource_type?select=resource_type_id&label=ilike.${encodeURIComponent(label)}`;
  const existing = await api.get(q);
  if (existing?.[0]?.resource_type_id) return existing[0].resource_type_id;
  const created = await api.post("infra_resource_type", { label });
  return created[0].resource_type_id;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const api = makeApi(url, key);

  const projects = await api.get(
    `project?select=project_id,project_name&project_name=ilike.Amzur&is_archived=eq.false`
  );
  if (!projects?.length) throw new Error('No project named "Amzur" found.');
  if (projects.length > 1) {
    console.log("Multiple Amzur matches:", projects.map((p) => p.project_name).join(", "));
  }
  const project = projects[0];
  console.log(`Using project: ${project.project_name} (${project.project_id})`);

  const ec2TypeId = await ensureType(api, EC2_LABEL);
  const s3TypeId = await ensureType(api, S3_LABEL);

  const existing = await api.get(
    `infra_resource?select=name&project_id=eq.${project.project_id}`
  );
  const existingNames = new Set((existing || []).map((r) => r.name.toLowerCase()));

  const rows = [];
  for (const [name, instance_type, vcpu, memory_gb, storage_gb] of EC2) {
    if (existingNames.has(name.toLowerCase())) continue;
    rows.push({
      project_id: project.project_id,
      resource_type_id: ec2TypeId,
      name,
      attributes: {
        provider: "AWS",
        source_kind: "cloud",
        instance_type,
        vcpu,
        memory_gb,
        storage_gb,
        environment: inferEnv(name),
        region: inferRegion(name),
      },
    });
  }
  for (const name of S3) {
    if (existingNames.has(name.toLowerCase())) continue;
    rows.push({
      project_id: project.project_id,
      resource_type_id: s3TypeId,
      name,
      attributes: {
        provider: "AWS",
        source_kind: "cloud",
        storage_class: "STANDARD",
        environment: inferEnv(name),
        region: inferRegion(name),
      },
    });
  }

  if (!rows.length) {
    console.log("Nothing to insert — all resources already exist.");
    return;
  }

  await api.post("infra_resource", rows, "return=minimal");
  const ec2Count = rows.filter((r) => r.resource_type_id === ec2TypeId).length;
  const s3Count = rows.filter((r) => r.resource_type_id === s3TypeId).length;
  const skipped = EC2.length + S3.length - rows.length;
  console.log(`Inserted ${rows.length} resources (${ec2Count} EC2, ${s3Count} S3). Skipped ${skipped} existing.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

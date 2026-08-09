"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireActiveUser, canManageInfra } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteInvoiceObject, uploadInvoiceBytes } from "@/lib/infra/storage";
import {
  parseInvoiceFromBytes,
  parseInvoiceFromStorage,
  parseInvoiceFromText,
  runAndStoreDiscrepancies,
} from "@/lib/infra/parseInvoice";
import {
  BILLING_CONFIRM_FLAG,
  BILLING_CONFIRM_REASON_KEY,
  matchProjectBillingBinding,
} from "@/lib/infra/billingBinding";
import { fieldsForService, isCloudProvider, requiredAttributeKeys } from "@/lib/infra/resourceSchemas";
import { normalizeCurrencyCode } from "@/lib/infra/currency";
import type { ActionState } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Soft cap before buffering into memory / LLM (storage bucket may allow more). */
const MAX_INVOICE_BYTES = 15 * 1024 * 1024;
const ALLOWED_INVOICE_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/octet-stream",
]);

function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function requireUuid(id: string, label: string): string | null {
  if (!UUID_RE.test(id)) return `Invalid ${label}.`;
  return null;
}

async function assertCanManage(): Promise<{ userId: string } | { error: string }> {
  const { userId, profile } = await requireActiveUser();
  if (!canManageInfra(profile)) return { error: "You do not have permission to manage infrastructure." };
  return { userId };
}

async function resolveProviderIdByLabel(
  supabase: ReturnType<typeof createClient>,
  providerLabel: string
): Promise<{ provider_id: string } | { error: string }> {
  const label = providerLabel.trim().slice(0, 120);
  if (!label) return { error: "Billing tool is required." };
  const { data: existingProvider } = await supabase
    .from("infra_provider")
    .select("provider_id")
    .ilike("label", label)
    .maybeSingle();
  if (existingProvider?.provider_id) return { provider_id: existingProvider.provider_id };
  const { data: created, error: providerErr } = await supabase
    .from("infra_provider")
    .insert({ label })
    .select("provider_id")
    .single();
  if (providerErr) return { error: providerErr.message };
  return { provider_id: created.provider_id };
}

async function loadProjectBillingBinding(projectId: string): Promise<
  | {
      provider_id: string | null;
      provider_label: string | null;
      accounts: string[];
      enforce_billing_accounts: boolean;
    }
  | { error: string }
> {
  const supabase = createClient();
  const [{ data: project, error: pErr }, { data: accounts, error: aErr }] = await Promise.all([
    supabase
      .from("project")
      .select("provider_id, enforce_billing_accounts, provider:infra_provider(label)")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("project_billing_account")
      .select("account_id")
      .eq("project_id", projectId)
      .order("account_id"),
  ]);
  if (pErr) return { error: pErr.message };
  if (aErr) return { error: aErr.message };
  if (!project) return { error: "Project not found." };
  const providerRel = project.provider as { label?: string } | { label?: string }[] | null;
  const provider_label = Array.isArray(providerRel)
    ? providerRel[0]?.label ?? null
    : providerRel?.label ?? null;
  return {
    provider_id: (project.provider_id as string | null) ?? null,
    provider_label,
    accounts: (accounts ?? []).map((a) => String(a.account_id)),
    enforce_billing_accounts: project.enforce_billing_accounts === true,
  };
}

/** First-time / edit InfraSpecs billing setup: tool + optional account restriction. */
export async function saveProjectBillingSetup(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };

  const providerLabel = str(form, "provider_label").slice(0, 120);
  if (!providerLabel) return { error: "Choose a billing tool (e.g. AWS, E2E)." };

  const enforce =
    form.get("enforce_billing_accounts") === "on" ||
    form.get("enforce_billing_accounts") === "true" ||
    form.get("enforce_billing_accounts") === "1";

  // Pair by index (forms submit account_id / account_name in parallel).
  const rows: { account_id: string; account_name: string | null }[] = [];
  const seen = new Set<string>();
  const idFields = form.getAll("account_id");
  const nameFields = form.getAll("account_name");
  for (let i = 0; i < idFields.length; i++) {
    const rawId = idFields[i];
    const account_id = typeof rawId === "string" ? rawId.trim() : "";
    if (!account_id) continue;
    const key = account_id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawName = nameFields[i];
    const account_name =
      typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 120) : null;
    rows.push({ account_id, account_name });
  }

  if (enforce) {
    if (rows.length === 0) {
      return { error: "Account restriction is on — add at least one account number and name." };
    }
    const missingName = rows.find((r) => !r.account_name);
    if (missingName) {
      return { error: "Account restriction is on — each account needs a number and a name." };
    }
  }

  const supabase = createClient();
  const resolved = await resolveProviderIdByLabel(supabase, providerLabel);
  if ("error" in resolved) return { error: resolved.error };

  const { error: setErr } = await supabase.rpc("set_project_infra_provider", {
    p_project: projectId,
    p_provider: resolved.provider_id,
  });
  if (setErr) {
    const msg = setErr.message ?? "";
    if (/set_project_infra_provider|schema cache|could not find the function/i.test(msg)) {
      return {
        error:
          "Database migration not applied yet. In Supabase → SQL Editor, run migrations 20260730000029 and 20260803000031, then try again.",
      };
    }
    return { error: setErr.message };
  }

  const { error: flagErr } = await supabase
    .from("project")
    .update({ enforce_billing_accounts: enforce })
    .eq("project_id", projectId);
  if (flagErr) {
    const msg = flagErr.message ?? "";
    if (/enforce_billing_accounts|schema cache|column/i.test(msg)) {
      return {
        error:
          "Database migration not applied yet. In Supabase → SQL Editor, run migration 20260803000031_enforce_billing_accounts.sql, then try again.",
      };
    }
    return { error: flagErr.message };
  }

  // Replace accounts only when restriction is on (or form submitted account rows).
  // When restriction is off and no account fields were submitted, keep existing rows
  // so turning the toggle back on does not lose the allow-list.
  if (enforce || rows.length > 0) {
    const { error: delErr } = await supabase
      .from("project_billing_account")
      .delete()
      .eq("project_id", projectId);
    if (delErr) {
      const msg = delErr.message ?? "";
      if (/project_billing_account|does not exist|schema cache/i.test(msg)) {
        return {
          error:
            "Database migration not applied yet. In Supabase → SQL Editor, run migration 20260730000029_project_billing_accounts.sql, then try again.",
        };
      }
      return { error: delErr.message };
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("project_billing_account").insert(
        rows.map((r) => ({
          project_id: projectId,
          account_id: r.account_id,
          account_name: r.account_name,
        }))
      );
      if (insErr) return { error: insErr.message };
    }
  }

  revalidatePath(`/projects/${projectId}/infra`);
  return {
    ok: true,
    message: enforce
      ? "Billing setup saved — account restriction is on."
      : "Billing setup saved — invoices are not restricted by account.",
  };
}

export async function addProjectBillingAccount(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };
  const account_id = str(form, "account_id");
  if (!account_id) return { error: "Account number is required." };
  const account_name = str(form, "account_name").slice(0, 120) || null;

  const binding = await loadProjectBillingBinding(projectId);
  if ("error" in binding) return { error: binding.error };
  if (binding.enforce_billing_accounts && !account_name) {
    return { error: "Account restriction is on — account name is required." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("project_billing_account").insert({
    project_id: projectId,
    account_id,
    account_name,
  });
  if (error) {
    if (error.code === "23505") return { error: "That account number is already on this project." };
    return { error: error.message };
  }
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true, message: "Account added." };
}

export async function removeProjectBillingAccount(
  projectId: string,
  accountRowId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(accountRowId, "account");
  if (bad) return { error: bad };

  const binding = await loadProjectBillingBinding(projectId);
  if ("error" in binding) return { error: binding.error };

  const supabase = createClient();
  const { count } = await supabase
    .from("project_billing_account")
    .select("account_row_id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (binding.enforce_billing_accounts && (count ?? 0) <= 1) {
    return { error: "Account restriction is on — keep at least one account, or turn the toggle off." };
  }

  const { error } = await supabase
    .from("project_billing_account")
    .delete()
    .eq("project_id", projectId)
    .eq("account_row_id", accountRowId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true, message: "Account removed." };
}

async function clearInvoiceBillingConfirm(invoiceId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("extracted_payload")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  const prev =
    inv?.extracted_payload && typeof inv.extracted_payload === "object"
      ? { ...(inv.extracted_payload as Record<string, unknown>) }
      : {};
  delete prev[BILLING_CONFIRM_FLAG];
  delete prev[BILLING_CONFIRM_REASON_KEY];
  const { error } = await supabase
    .from("infra_invoice")
    .update({ extracted_payload: prev })
    .eq("invoice_id", invoiceId);
  return error?.message ?? null;
}

/**
 * After extract/upload: when account restriction is on, mismatch/missing fails.
 * `deleteOnFail` (default true) removes the invoice; set false for edit/save paths.
 * When restriction is off, skip account checks.
 */
async function gateInvoiceBillingBinding(
  projectId: string,
  invoiceId: string,
  opts?: { deleteOnFail?: boolean }
): Promise<
  | { ok: true }
  | { ok: false; rejected: true; reason: string; filename?: string | null }
  | { error: string }
> {
  const deleteOnFail = opts?.deleteOnFail !== false;
  const binding = await loadProjectBillingBinding(projectId);
  if ("error" in binding) return { error: binding.error };

  const supabase = createClient();
  const { data: inv, error } = await supabase
    .from("infra_invoice")
    .select("original_filename, provider_id, extracted_payload, provider:infra_provider(label)")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!inv) return { error: "Invoice not found." };

  // Restriction off → clear any legacy confirm flags and accept.
  if (!binding.enforce_billing_accounts) {
    const clearErr = await clearInvoiceBillingConfirm(invoiceId);
    if (clearErr) return { error: clearErr };
    return { ok: true };
  }

  const providerRel = inv.provider as { label?: string } | { label?: string }[] | null;
  const invoiceToolLabel = Array.isArray(providerRel)
    ? providerRel[0]?.label ?? null
    : providerRel?.label ?? null;
  const payload =
    inv.extracted_payload && typeof inv.extracted_payload === "object"
      ? (inv.extracted_payload as Record<string, unknown>)
      : {};
  const extractedAccount =
    typeof payload.account_id === "string" ? payload.account_id : null;

  const match = matchProjectBillingBinding({
    enforceAccounts: true,
    projectToolLabel: binding.provider_label,
    projectToolId: binding.provider_id,
    allowedAccounts: binding.accounts,
    invoiceToolLabel,
    invoiceToolId: (inv.provider_id as string | null) ?? null,
    extractedAccountId: extractedAccount,
  });

  if (match.ok) {
    const clearErr = await clearInvoiceBillingConfirm(invoiceId);
    if (clearErr) return { error: clearErr };
    return { ok: true };
  }

  const filename = (inv.original_filename as string | null) ?? null;
  if (deleteOnFail) {
    const del = await deleteInfraInvoice(projectId, invoiceId);
    if (del?.error) return { error: del.error };
  }
  return {
    ok: false,
    rejected: true,
    reason: match.reason,
    filename,
  };
}

export async function confirmInfraInvoiceBilling(
  projectId: string,
  invoiceIds: string[]
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };
  const ids = invoiceIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return { error: "No invoices to confirm." };

  // Re-check allow-list when restriction is on — never keep a mismatched invoice via Proceed.
  for (const invoiceId of ids) {
    const check = await gateInvoiceBillingBinding(projectId, invoiceId, {
      deleteOnFail: true,
    });
    if ("error" in check) return { error: check.error };
    if (!check.ok) {
      return { error: `Invoice rejected — ${check.reason}` };
    }
    const result = await runAndStoreDiscrepancies(invoiceId, projectId);
    if (result.error) return { error: result.error };
  }
  revalidatePath(`/projects/${projectId}/infra`);
  for (const invoiceId of ids) {
    revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
  }
  revalidatePath("/reports");
  return {
    ok: true,
    message:
      ids.length === 1
        ? "Invoice kept on this project."
        : `${ids.length} invoices kept on this project.`,
  };
}

export async function rejectInfraInvoiceBilling(
  projectId: string,
  invoiceIds: string[]
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };
  const ids = invoiceIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return { error: "No invoices to reject." };

  for (const invoiceId of ids) {
    const result = await deleteInfraInvoice(projectId, invoiceId);
    if (result?.error) return { error: result.error };
  }
  return {
    ok: true,
    message:
      ids.length === 1
        ? "Invoice rejected and removed."
        : `${ids.length} invoices rejected and removed.`,
  };
}

export async function createInfraResource(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };
  const supabase = createClient();

  const name = str(form, "name");
  const typeLabel = str(form, "type_label"); // Service / Resource Type
  const provider = str(form, "attr_provider");
  const external_id = str(form, "external_id") || null;
  if (!name) return { error: "Resource name is required." };
  if (!provider) return { error: "Cloud / Tool is required." };
  if (!typeLabel) return { error: "Service / Resource Type is required." };

  // Resolve or create type by service label (e.g. "EC2 — Virtual Server").
  let resource_type_id = "";
  const { data: existingType } = await supabase
    .from("infra_resource_type")
    .select("resource_type_id")
    .ilike("label", typeLabel)
    .maybeSingle();
  if (existingType?.resource_type_id) {
    resource_type_id = existingType.resource_type_id;
  } else {
    const { data: created, error: typeErr } = await supabase
      .from("infra_resource_type")
      .insert({ label: typeLabel })
      .select("resource_type_id")
      .single();
    if (typeErr) return { error: typeErr.message };
    resource_type_id = created.resource_type_id;
  }

  const schemaFields = fieldsForService(provider, typeLabel);
  if (schemaFields.length) {
    await supabase.from("infra_resource_type_attribute").upsert(
      [
        {
          resource_type_id,
          attr_key: "provider",
          label: "Cloud / Tool",
          data_type: "text",
          is_required: true,
          sort_order: -2,
        },
        {
          resource_type_id,
          attr_key: "source_kind",
          label: "Source kind",
          data_type: "text",
          is_required: true,
          sort_order: -1,
        },
        ...schemaFields.map((f, i) => ({
          resource_type_id,
          attr_key: f.key,
          label: f.label,
          data_type: f.dataType,
          is_required: !!f.required,
          sort_order: i,
        })),
      ],
      { onConflict: "resource_type_id,attr_key", ignoreDuplicates: true }
    );
  }

  const attributes: Record<string, unknown> = {
    provider,
    source_kind: isCloudProvider(provider) ? "cloud" : "tool",
  };
  for (const [key, value] of Array.from(form.entries())) {
    if (!key.startsWith("attr_")) continue;
    const attrKey = key.slice(5);
    if (attrKey === "provider") continue; // already set
    if (typeof value !== "string") continue;
    const raw = value.trim();
    if (raw === "") continue;
    const field = schemaFields.find((f) => f.key === attrKey || f.unitKey === attrKey);
    if (field?.dataType === "number" && field.key === attrKey) {
      const n = Number(raw);
      attributes[attrKey] = Number.isNaN(n) ? raw : n;
    } else if (field?.dataType === "boolean" && field.key === attrKey) {
      attributes[attrKey] = raw === "true" || raw === "on" || raw === "1";
    } else {
      attributes[attrKey] = raw;
    }
  }

  const missing = requiredAttributeKeys(provider, typeLabel).filter((k) => {
    const v = attributes[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length) {
    const labels = schemaFields.filter((f) => missing.includes(f.key)).map((f) => f.label);
    return { error: `Required: ${labels.join(", ")}.` };
  }

  const { error } = await supabase.from("infra_resource").insert({
    project_id: projectId,
    resource_type_id,
    name,
    external_id,
    attributes,
  });
  if (error) return { error: error.message };
  await recheckAllProjectInvoiceDiscrepancies(projectId);
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true };
}

export async function updateInfraResource(
  projectId: string,
  resourceId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(resourceId, "resource");
  if (bad) return { error: bad };
  const supabase = createClient();

  const name = str(form, "name");
  const typeLabel = str(form, "type_label");
  const provider = str(form, "attr_provider");
  const external_id = str(form, "external_id") || null;
  if (!name) return { error: "Resource name is required." };
  if (!provider) return { error: "Cloud / Tool is required." };
  if (!typeLabel) return { error: "Service / Resource Type is required." };

  let resource_type_id = "";
  const { data: existingType } = await supabase
    .from("infra_resource_type")
    .select("resource_type_id")
    .ilike("label", typeLabel)
    .maybeSingle();
  if (existingType?.resource_type_id) {
    resource_type_id = existingType.resource_type_id;
  } else {
    const { data: created, error: typeErr } = await supabase
      .from("infra_resource_type")
      .insert({ label: typeLabel })
      .select("resource_type_id")
      .single();
    if (typeErr) return { error: typeErr.message };
    resource_type_id = created.resource_type_id;
  }

  const schemaFields = fieldsForService(provider, typeLabel);
  const attributes: Record<string, unknown> = {
    provider,
    source_kind: isCloudProvider(provider) ? "cloud" : "tool",
  };
  for (const [key, value] of Array.from(form.entries())) {
    if (!key.startsWith("attr_")) continue;
    const attrKey = key.slice(5);
    if (attrKey === "provider") continue;
    if (typeof value !== "string") continue;
    const raw = value.trim();
    if (raw === "") continue;
    const field = schemaFields.find((f) => f.key === attrKey || f.unitKey === attrKey);
    if (field?.dataType === "number" && field.key === attrKey) {
      const n = Number(raw);
      attributes[attrKey] = Number.isNaN(n) ? raw : n;
    } else if (field?.dataType === "boolean" && field.key === attrKey) {
      attributes[attrKey] = raw === "true" || raw === "on" || raw === "1";
    } else {
      attributes[attrKey] = raw;
    }
  }

  const missing = requiredAttributeKeys(provider, typeLabel).filter((k) => {
    const v = attributes[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length) {
    const labels = schemaFields.filter((f) => missing.includes(f.key)).map((f) => f.label);
    return { error: `Required: ${labels.join(", ")}.` };
  }

  const { error } = await supabase
    .from("infra_resource")
    .update({ name, external_id, resource_type_id, attributes })
    .eq("resource_id", resourceId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };
  await recheckAllProjectInvoiceDiscrepancies(projectId);
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true };
}

export async function deleteInfraResource(
  projectId: string,
  resourceId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(resourceId, "resource");
  if (bad) return { error: bad };
  const supabase = createClient();
  const { error } = await supabase
    .from("infra_resource")
    .delete()
    .eq("resource_id", resourceId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };
  await recheckAllProjectInvoiceDiscrepancies(projectId);
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true };
}

/**
 * Refresh scope / duplicate flags for every invoice on this project.
 * Called after resource add/edit/delete so out-of-scope updates for any project.
 */
async function recheckAllProjectInvoiceDiscrepancies(projectId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("project_id", projectId);
  if (error) {
    console.error("recheckAllProjectInvoiceDiscrepancies: list invoices", error.message);
    return;
  }
  for (const row of data ?? []) {
    const result = await runAndStoreDiscrepancies(String(row.invoice_id), projectId);
    if (result.error) {
      console.error(
        `recheckAllProjectInvoiceDiscrepancies: invoice ${row.invoice_id}`,
        result.error
      );
    }
  }
}

/** Manual / UI: re-run discrepancy detection for all invoices on this project. */
export async function recheckAllInvoiceDiscrepancies(
  projectId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };
  await recheckAllProjectInvoiceDiscrepancies(projectId);
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");
  return { ok: true, message: "Invoice scope rechecked against InfraSpecs." };
}

export async function createInfraProviderLookup(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const label = str(form, "label");
  if (!label) return { error: "Label is required." };
  const supabase = createClient();
  const { error } = await supabase.from("infra_provider").insert({ label });
  if (error) return { error: error.message };
  revalidatePath("/projects", "layout");
  revalidatePath("/reports");
  return { ok: true, message: "Provider added." };
}

export async function createOwnershipLookup(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const { profile } = await requireActiveUser();
  if (profile.role !== "Admin") return { error: "Admins only." };
  const label = str(form, "label");
  if (!label) return { error: "Label is required." };
  const supabase = createClient();
  const { error } = await supabase.from("billing_ownership_option").insert({ label });
  if (error) return { error: error.message };
  revalidatePath("/projects", "layout");
  revalidatePath("/reports");
  return { ok: true, message: "Ownership option added." };
}

export async function createResourceTypeLookup(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const label = str(form, "label");
  if (!label) return { error: "Label is required." };
  const supabase = createClient();
  const { error } = await supabase.from("infra_resource_type").insert({ label });
  if (error) return { error: error.message };
  revalidatePath("/projects", "layout");
  return { ok: true, message: "Resource type added." };
}

const MAX_INVOICE_FILES_PER_UPLOAD = 20;
const ALLOWED_INVOICE_EXT = new Set(["pdf", "txt", "csv", "png", "jpg", "jpeg", "webp"]);

function validateInvoiceFile(file: File): string | null {
  if (!(file instanceof File) || file.size === 0) return "Empty file.";
  if (file.size > MAX_INVOICE_BYTES) return "File is too large (max 15 MB).";
  const mime = (file.type || "application/octet-stream").toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_INVOICE_MIME.has(mime) && !ALLOWED_INVOICE_EXT.has(ext)) {
    return "Unsupported type (use PDF, CSV, TXT, or image).";
  }
  return null;
}

export async function uploadInfraInvoice(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const { userId } = gate;

  const badProject = requireUuid(projectId, "project");
  if (badProject) return { error: badProject };

  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { error: "Choose one or more invoice files to upload." };
  }
  if (files.length > MAX_INVOICE_FILES_PER_UPLOAD) {
    return { error: `Upload at most ${MAX_INVOICE_FILES_PER_UPLOAD} files at a time.` };
  }

  const binding = await loadProjectBillingBinding(projectId);
  if ("error" in binding) return { error: binding.error };
  if (!binding.provider_id || !binding.provider_label) {
    return {
      error: "Complete InfraSpecs billing setup first (choose a billing tool).",
    };
  }
  if (binding.enforce_billing_accounts && binding.accounts.length === 0) {
    return {
      error:
        "Account restriction is on — add at least one account number under Billing binding before uploading.",
    };
  }

  // Lock uploads to the project’s billing tool (ignore free-picked labels).
  const provider_id = binding.provider_id;
  const supabase = createClient();

  let uploadedOk = 0;
  let extractedOk = 0;
  let duplicateRejected = 0;
  let accountRejected = 0;
  let outOfScopeTotal = 0;
  const failNotes: string[] = [];
  const warnFiles: string[] = [];
  let singleWarning: string | undefined;

  for (const file of files) {
    const invalid = validateInvoiceFile(file);
    if (invalid) {
      failNotes.push(`${file.name}: ${invalid}`);
      continue;
    }

    const mime = (file.type || "application/octet-stream").toLowerCase();
    const invoiceId = randomUUID();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadInvoiceBytes({
      projectId,
      invoiceId,
      filename: file.name,
      bytes: fileBytes,
      contentType: mime,
    });
    if (uploaded.error) {
      failNotes.push(`${file.name}: ${uploaded.error}`);
      continue;
    }

    const { error } = await supabase.from("infra_invoice").insert({
      invoice_id: invoiceId,
      project_id: projectId,
      provider_id,
      storage_path: uploaded.path,
      original_filename: file.name,
      mime_type: mime,
      processing_status: "pending",
      validation_status: "unchecked",
      uploaded_by: userId,
    });
    if (error) {
      await deleteInvoiceObject(uploaded.path);
      failNotes.push(`${file.name}: ${error.message}`);
      continue;
    }

    const parsed = await parseInvoiceFromBytes({
      invoiceId,
      projectId,
      bytes: fileBytes,
      filename: file.name,
      mimeType: file.type || null,
      rejectDuplicates: true,
    });
    if (parsed.duplicate) {
      duplicateRejected += 1;
      failNotes.push(`${file.name}: ${parsed.error ?? "Duplicate — not added."}`);
      continue;
    }
    if (parsed.error) {
      // Kept on the project for retry extract.
      uploadedOk += 1;
      failNotes.push(`${file.name}: uploaded, but extraction failed (${parsed.error})`);
      continue;
    }
    const accountGate = await gateInvoiceBillingBinding(projectId, invoiceId);
    if ("error" in accountGate) {
      failNotes.push(`${file.name}: ${accountGate.error}`);
      continue;
    }
    if (!accountGate.ok) {
      accountRejected += 1;
      failNotes.push(`${file.name}: rejected — ${accountGate.reason}`);
      continue;
    }

    uploadedOk += 1;
    extractedOk += 1;
    if (parsed.outOfScopeCount) outOfScopeTotal += parsed.outOfScopeCount;

    if (parsed.warning) {
      warnFiles.push(file.name);
      if (!singleWarning) singleWarning = parsed.warning;
    }
  }

  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");

  if (uploadedOk === 0) {
    if (duplicateRejected > 0 && duplicateRejected === failNotes.length) {
      return {
        error:
          duplicateRejected === 1
            ? failNotes[0] ?? "Duplicate — not added."
            : `${duplicateRejected} duplicates — not added.\n\n${failNotes.slice(0, 8).join("\n")}`,
      };
    }
    if (accountRejected > 0) {
      return {
        error:
          accountRejected === 1
            ? failNotes.find((n) => /rejected —/i.test(n)) ??
              "Invoice rejected — account does not match this project."
            : `${accountRejected} invoice(s) rejected — account does not match this project.\n\n${failNotes.slice(0, 8).join("\n")}`,
      };
    }
    return {
      error:
        failNotes.length > 0
          ? `No files uploaded.\n\n${failNotes.slice(0, 8).join("\n")}`
          : "No files uploaded.",
    };
  }

  const parts: string[] = [];
  if (files.length === 1) {
    parts.push(
      extractedOk === 1
        ? "Uploaded and extracted into the month-wise billing sheet."
        : "Uploaded, but extraction failed. Re-open InfraSpecs to auto-retry, or upload again."
    );
  } else {
    parts.push(
      `Uploaded ${uploadedOk} of ${files.length}; extracted ${extractedOk}` +
        (duplicateRejected ? `; ${duplicateRejected} duplicate(s) rejected` : "") +
        (accountRejected ? `; ${accountRejected} account mismatch rejected` : "") +
        "."
    );
  }
  if (failNotes.length) {
    parts.push(failNotes.slice(0, 8).join("\n"));
    if (failNotes.length > 8) parts.push(`…and ${failNotes.length - 8} more issue(s).`);
  }

  let warning: string | undefined;
  if (outOfScopeTotal > 0) {
    warning = `${outOfScopeTotal} out-of-scope line(s) in the uploaded invoice(s) — check pills on invoices.`;
  } else if (warnFiles.length === 1 && singleWarning) {
    warning = singleWarning;
  } else if (warnFiles.length > 1) {
    warning = `${warnFiles.length} invoices need review. Check the pills on each invoice.`;
  }

  const rejectBits: string[] = [];
  if (duplicateRejected > 0) {
    rejectBits.push(
      `${duplicateRejected} duplicate(s) not added — same invoice # or billing period already exists.`
    );
  }
  if (accountRejected > 0) {
    rejectBits.push(
      `${accountRejected} invoice(s) rejected — account number does not match this project’s allow-list.`
    );
  }
  if (rejectBits.length > 0) {
    return {
      ok: true,
      message: parts.join("\n\n"),
      warning,
      outOfScopeCount: outOfScopeTotal > 0 ? outOfScopeTotal : undefined,
      error: rejectBits.join("\n"),
    };
  }

  return {
    ok: true,
    message: parts.join("\n\n"),
    warning,
    outOfScopeCount: outOfScopeTotal > 0 ? outOfScopeTotal : undefined,
  };
}

export async function extractInfraInvoice(
  projectId: string,
  invoiceId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const result = await parseInvoiceFromStorage(invoiceId, projectId);
  if (result.error) return { error: result.error };

  const billing = await gateInvoiceBillingBinding(projectId, invoiceId);
  if ("error" in billing) return { error: billing.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
  revalidatePath("/reports");
  if (!billing.ok) {
    return {
      error: `Invoice rejected — ${billing.reason}`,
    };
  }
  return {
    ok: true,
    message: "Extracted into month-wise billing.",
    warning:
      result.outOfScopeCount && result.outOfScopeCount > 0
        ? `${result.outOfScopeCount} out-of-scope line(s) in this invoice — check pills on the invoice.`
        : result.warning,
    outOfScopeCount: result.outOfScopeCount,
  };
}

export async function parseInfraInvoiceText(
  projectId: string,
  invoiceId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const text = str(form, "invoice_text").slice(0, 500_000);
  if (!text) return { error: "Paste invoice text to parse." };
  const result = await parseInvoiceFromText(invoiceId, projectId, text);
  if (result.error) return { error: result.error };

  const billing = await gateInvoiceBillingBinding(projectId, invoiceId);
  if ("error" in billing) return { error: billing.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
  revalidatePath("/reports");
  if (!billing.ok) {
    return {
      error: `Invoice rejected — ${billing.reason}`,
    };
  }
  return {
    ok: true,
    message: "Extracted into month-wise billing.",
    warning:
      result.outOfScopeCount && result.outOfScopeCount > 0
        ? `${result.outOfScopeCount} out-of-scope line(s) in this invoice — check pills on the invoice.`
        : result.warning,
    outOfScopeCount: result.outOfScopeCount,
  };
}

export async function deleteInfraInvoice(
  projectId: string,
  invoiceId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const supabase = createClient();
  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("storage_path")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const { error } = await supabase
    .from("infra_invoice")
    .delete()
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };
  await deleteInvoiceObject(inv.storage_path);
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");
  return { ok: true };
}

function optionalDate(form: FormData, key: string): string | null | undefined {
  const raw = str(form, key);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined; // invalid
  return raw;
}

function optionalNumber(form: FormData, key: string): number | null | undefined {
  const raw = str(form, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/** Manual correction of extracted invoice header fields (Admin / InfraOps). */
export async function updateInfraInvoiceDetails(
  projectId: string,
  invoiceId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const supabase = createClient();

  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("extracted_payload, provider_id")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const invoice_number = str(form, "invoice_number") || null;
  const currencyRaw = str(form, "currency");
  const currency = currencyRaw
    ? normalizeCurrencyCode(currencyRaw) || currencyRaw.toUpperCase().slice(0, 3)
    : null;

  const amount_total = optionalNumber(form, "amount_total");
  if (amount_total === undefined) return { error: "Amount must be a number." };
  if (amount_total != null && amount_total < 0) return { error: "Amount cannot be negative." };

  const billing_period_start = optionalDate(form, "billing_period_start");
  const billing_period_end = optionalDate(form, "billing_period_end");
  if (billing_period_start === undefined || billing_period_end === undefined) {
    return { error: "Billing period dates must be YYYY-MM-DD." };
  }
  if (
    billing_period_start &&
    billing_period_end &&
    billing_period_end < billing_period_start
  ) {
    return { error: "Billing period end must be on or after start." };
  }

  const provider_id = str(form, "provider_id") || null;
  if (provider_id && !UUID_RE.test(provider_id)) return { error: "Invalid provider." };

  const vendor_name = str(form, "vendor_name") || null;
  const account_id = str(form, "account_id") || null;
  const invoice_date = optionalDate(form, "invoice_date");
  if (invoice_date === undefined) return { error: "Invoice date must be YYYY-MM-DD." };

  const prevPayload =
    inv.extracted_payload && typeof inv.extracted_payload === "object"
      ? (inv.extracted_payload as Record<string, unknown>)
      : {};
  const extracted_payload = {
    ...prevPayload,
    vendor_name,
    account_id,
    invoice_date,
    invoice_number,
    currency,
    amount_total,
    billing_period_start,
    billing_period_end,
  };

  const { error } = await supabase
    .from("infra_invoice")
    .update({
      invoice_number,
      currency,
      amount_total,
      billing_period_start,
      billing_period_end,
      provider_id,
      extracted_payload,
      processing_status: "parsed",
      error_message: null,
    })
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  const billing = await gateInvoiceBillingBinding(projectId, invoiceId, {
    deleteOnFail: false,
  });
  if ("error" in billing) return { error: billing.error };
  if (!billing.ok) {
    revalidatePath(`/projects/${projectId}/infra`);
    revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
    return {
      error: `Cannot save — ${billing.reason}`,
    };
  }

  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
  revalidatePath("/reports");
  return { ok: true, message: "Invoice details saved.", warning: result.warning };
}

/** Save invoice header + all line items in one submit. */
export async function saveInfraInvoiceEdit(
  projectId: string,
  invoiceId: string,
  prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const details = await updateInfraInvoiceDetails(projectId, invoiceId, prev, form);
  if (details?.error) return details;
  const lines = await saveInfraInvoiceLines(projectId, invoiceId, prev, form);
  if (lines?.error) return lines;
  const warnings = [details?.warning, lines?.warning].filter(Boolean);
  return {
    ok: true,
    message: "Saved.",
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}

/** Replace invoice lines in one save (updates + creates + deletes). */
export async function saveInfraInvoiceLines(
  projectId: string,
  invoiceId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const supabase = createClient();

  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  let payload: unknown;
  try {
    payload = JSON.parse(str(form, "lines_json") || "null");
  } catch {
    return { error: "Invalid line data." };
  }
  if (!payload || typeof payload !== "object") return { error: "Invalid line data." };

  const raw = payload as {
    lines?: unknown;
    deleted_ids?: unknown;
  };
  const deletedIds = Array.isArray(raw.deleted_ids)
    ? raw.deleted_ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];
  if (!Array.isArray(raw.lines)) return { error: "Invalid line data." };

  type ParsedLine = {
    line_id: string | null;
    line_label: string | null;
    resource_type_label: string | null;
    quantity: number | null;
    unit: string | null;
    unit_cost: number | null;
    amount: number | null;
  };

  const parsed: ParsedLine[] = [];
  for (let i = 0; i < raw.lines.length; i++) {
    const row = raw.lines[i];
    if (!row || typeof row !== "object") {
      return { error: `Line ${i + 1} is invalid.` };
    }
    const r = row as Record<string, unknown>;
    const line_id =
      typeof r.line_id === "string" && UUID_RE.test(r.line_id) ? r.line_id : null;
    const line_label =
      typeof r.line_label === "string" ? r.line_label.trim() || null : null;
    if (!line_label) return { error: `Line ${i + 1}: description is required.` };
    const resource_type_label =
      typeof r.resource_type_label === "string"
        ? r.resource_type_label.trim() || null
        : null;
    const unit = typeof r.unit === "string" ? r.unit.trim() || null : null;

    const parseOptNum = (v: unknown, label: string): number | null | undefined => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return n;
    };
    const quantity = parseOptNum(r.quantity, "quantity");
    const unit_cost = parseOptNum(r.unit_cost, "unit cost");
    const amount = parseOptNum(r.amount, "amount");
    if (quantity === undefined || unit_cost === undefined || amount === undefined) {
      return { error: `Line ${i + 1}: invalid number.` };
    }
    if (amount === null) return { error: `Line ${i + 1}: amount is required.` };

    parsed.push({
      line_id,
      line_label,
      resource_type_label,
      quantity,
      unit,
      unit_cost,
      amount,
    });
  }

  if (deletedIds.length) {
    const { error } = await supabase
      .from("infra_invoice_line")
      .delete()
      .eq("invoice_id", invoiceId)
      .in("line_id", deletedIds);
    if (error) return { error: error.message };
  }

  for (const line of parsed) {
    if (line.line_id) {
      const { error } = await supabase
        .from("infra_invoice_line")
        .update({
          line_label: line.line_label,
          resource_type_label: line.resource_type_label,
          quantity: line.quantity,
          unit: line.unit,
          unit_cost: line.unit_cost,
          amount: line.amount,
        })
        .eq("line_id", line.line_id)
        .eq("invoice_id", invoiceId);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("infra_invoice_line").insert({
        invoice_id: invoiceId,
        line_label: line.line_label,
        resource_type_label: line.resource_type_label,
        quantity: line.quantity,
        unit: line.unit,
        unit_cost: line.unit_cost,
        amount: line.amount,
        attributes: {},
      });
      if (error) return { error: error.message };
    }
  }

  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath(`/projects/${projectId}/infra/invoices/${invoiceId}`);
  revalidatePath("/reports");
  return { ok: true, message: "Line items saved.", warning: result.warning };
}

/** Manual correction of a single invoice line (Admin / InfraOps). */
export async function updateInfraInvoiceLine(
  projectId: string,
  invoiceId: string,
  lineId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") ||
    requireUuid(invoiceId, "invoice") ||
    requireUuid(lineId, "line");
  if (bad) return { error: bad };
  const supabase = createClient();

  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const line_label = str(form, "line_label") || null;
  const resource_type_label = str(form, "resource_type_label") || null;
  const unit = str(form, "unit") || null;
  const quantity = optionalNumber(form, "quantity");
  const unit_cost = optionalNumber(form, "unit_cost");
  const amount = optionalNumber(form, "amount");
  if (quantity === undefined || unit_cost === undefined || amount === undefined) {
    return { error: "Quantity, unit cost, and amount must be valid numbers when provided." };
  }
  if (amount === null) return { error: "Amount is required." };

  const { error } = await supabase
    .from("infra_invoice_line")
    .update({
      line_label,
      resource_type_label,
      quantity,
      unit,
      unit_cost,
      amount,
    })
    .eq("line_id", lineId)
    .eq("invoice_id", invoiceId);
  if (error) return { error: error.message };

  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");
  return { ok: true, message: "Line saved.", warning: result.warning };
}

export async function createInfraInvoiceLine(
  projectId: string,
  invoiceId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const supabase = createClient();

  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const line_label = str(form, "line_label") || null;
  if (!line_label) return { error: "Description is required." };
  const resource_type_label = str(form, "resource_type_label") || null;
  const unit = str(form, "unit") || null;
  const quantity = optionalNumber(form, "quantity");
  const unit_cost = optionalNumber(form, "unit_cost");
  const amount = optionalNumber(form, "amount");
  if (quantity === undefined || unit_cost === undefined || amount === undefined) {
    return { error: "Quantity, unit cost, and amount must be valid numbers when provided." };
  }
  if (amount === null) return { error: "Amount is required." };

  const { error } = await supabase.from("infra_invoice_line").insert({
    invoice_id: invoiceId,
    line_label,
    resource_type_label,
    quantity,
    unit,
    unit_cost,
    amount,
    attributes: {},
  });
  if (error) return { error: error.message };

  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");
  return { ok: true, message: "Line added.", warning: result.warning };
}

export async function deleteInfraInvoiceLine(
  projectId: string,
  invoiceId: string,
  lineId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") ||
    requireUuid(invoiceId, "invoice") ||
    requireUuid(lineId, "line");
  if (bad) return { error: bad };
  const supabase = createClient();

  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("invoice_id", invoiceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const { error } = await supabase
    .from("infra_invoice_line")
    .delete()
    .eq("line_id", lineId)
    .eq("invoice_id", invoiceId);
  if (error) return { error: error.message };

  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  revalidatePath("/reports");
  return { ok: true, message: "Line deleted." };
}

export async function recheckInvoiceDiscrepancies(
  projectId: string,
  invoiceId: string
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") || requireUuid(invoiceId, "invoice");
  if (bad) return { error: bad };
  const result = await runAndStoreDiscrepancies(invoiceId, projectId);
  if (result.error) return { error: result.error };
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true };
}

export async function updateDiscrepancyStatus(
  projectId: string,
  discrepancyId: string,
  status: "open" | "acknowledged" | "resolved"
): Promise<ActionState> {
  const gate = await assertCanManage();
  if ("error" in gate) return { error: gate.error };
  const bad =
    requireUuid(projectId, "project") ||
    requireUuid(discrepancyId, "discrepancy");
  if (bad) return { error: bad };
  if (!["open", "acknowledged", "resolved"].includes(status)) {
    return { error: "Invalid status." };
  }
  const supabase = createClient();
  // Scope update to discrepancies that belong to an invoice in this project.
  const { data: disc } = await supabase
    .from("infra_billing_discrepancy")
    .select("discrepancy_id, invoice_id")
    .eq("discrepancy_id", discrepancyId)
    .maybeSingle();
  if (!disc) return { error: "Discrepancy not found." };
  const { data: inv } = await supabase
    .from("infra_invoice")
    .select("invoice_id")
    .eq("invoice_id", disc.invoice_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!inv) return { error: "Discrepancy not found for this project." };

  const { error } = await supabase
    .from("infra_billing_discrepancy")
    .update({ status })
    .eq("discrepancy_id", discrepancyId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/infra`);
  return { ok: true };
}

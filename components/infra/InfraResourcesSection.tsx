"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { ConfirmButton } from "@/components/ConfirmButton";
import { HelpTip } from "@/components/HelpTip";
import {
  createInfraResource,
  deleteInfraResource,
  updateInfraResource,
} from "@/app/projects/[id]/infra/actions";
import {
  CLOUD_OR_TOOL_OPTIONS,
  ENV_OPTIONS,
  UNSPECIFIED_ENVIRONMENT,
  fieldsForService,
  resourceCloudLabel,
  resourceEnvironmentLabel,
  servicesForProvider,
  servicesGroupedForProvider,
  summarizeAttributes,
  type ResourceFieldDef,
} from "@/lib/infra/resourceSchemas";
import type { ActionState, InfraResourceRow } from "@/lib/types";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function attrDefault(attrs: Record<string, unknown> | undefined, key: string): string {
  if (!attrs) return "";
  const v = attrs[key];
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "";
  return String(v);
}

function DynamicField({
  field,
  defaults,
}: {
  field: ResourceFieldDef;
  defaults?: Record<string, unknown>;
}) {
  const name = `attr_${field.key}`;
  const listId = field.suggestions?.length ? `suggest-${field.key}` : undefined;
  const defaultVal = attrDefault(defaults, field.key);
  const labelEl = (
    <span className="mb-1 block text-sm font-medium text-gray-700">
      {field.label}
      {field.required ? <span className="text-red-500"> *</span> : null}
      {!field.required && field.key === "ip_address" ? (
        <span className="font-normal text-gray-400"> (Optional)</span>
      ) : null}
    </span>
  );

  if (field.dataType === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={name}
          value="true"
          defaultChecked={defaultVal === "true"}
          className="rounded border-gray-300"
        />
        <span className="font-medium text-gray-700">{field.label}</span>
      </label>
    );
  }

  if (field.unitOptions?.length && field.unitKey) {
    const unitDefault = attrDefault(defaults, field.unitKey) || field.unitOptions[0];
    return (
      <div className={field.fullWidth !== false ? "sm:col-span-2" : ""}>
        {labelEl}
        <div className="flex gap-2">
          <input
            name={name}
            type="number"
            required={field.required}
            step="any"
            className="input flex-1"
            placeholder={field.placeholder}
            defaultValue={defaultVal}
          />
          <select
            name={`attr_${field.unitKey}`}
            className="input w-36"
            defaultValue={unitDefault}
          >
            {field.unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (field.options?.length) {
    return (
      <label className="block text-sm">
        {labelEl}
        <select
          name={name}
          required={field.required}
          className="input"
          defaultValue={defaultVal || ""}
        >
          <option value="" disabled>
            Select…
          </option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={`block text-sm ${field.fullWidth ? "sm:col-span-2" : ""}`}>
      {labelEl}
      <input
        name={name}
        type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text"}
        required={field.required}
        step={field.dataType === "number" ? "any" : undefined}
        className="input"
        placeholder={field.placeholder}
        list={listId}
        defaultValue={defaultVal}
      />
      {listId && field.suggestions && (
        <datalist id={listId}>
          {field.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </label>
  );
}

export function InfraResourcesSection({
  projectId,
  resources,
  canEdit,
  openOutOfScopeCount = 0,
}: {
  projectId: string;
  resources: InfraResourceRow[];
  resourceTypes?: unknown;
  canEdit: boolean;
  /** Open out-of-scope invoice lines — highlight near Resources (not a popup). */
  openOutOfScopeCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InfraResourceRow | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const [provider, setProvider] = useState<string>("AWS");
  const [service, setService] = useState<string>("EC2 — Virtual Server");
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [envFilter, setEnvFilter] = useState<string>("all");

  editingIdRef.current = editing?.resource_id ?? null;

  const createAction = createInfraResource.bind(null, projectId);
  const [createState, createFormAction] = useFormState(createAction, undefined as ActionState);

  const runUpdate = useCallback(
    async (_prev: ActionState, form: FormData): Promise<ActionState> => {
      const id = editingIdRef.current;
      if (!id) return { error: "No resource selected." };
      return updateInfraResource(projectId, id, _prev, form);
    },
    [projectId]
  );
  const [editState, editFormAction] = useFormState(runUpdate, undefined as ActionState);

  const serviceGroups = useMemo(() => servicesGroupedForProvider(provider), [provider]);
  const dynamicFields = useMemo(() => fieldsForService(provider, service), [provider, service]);
  const knownProviders = useMemo(() => new Set<string>(CLOUD_OR_TOOL_OPTIONS), []);

  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) {
      const label = r.resource_type?.label;
      if (label) set.add(label);
    }
    return Array.from(set).sort();
  }, [resources]);

  /** Env tabs: known order first, then any custom values, then Unspecified if used. */
  const envTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of resources) {
      const env = resourceEnvironmentLabel(r.attributes);
      counts.set(env, (counts.get(env) ?? 0) + 1);
    }
    const tabs: { key: string; label: string; count: number }[] = [
      { key: "all", label: "All", count: resources.length },
    ];
    for (const env of ENV_OPTIONS) {
      const n = counts.get(env) ?? 0;
      if (n > 0) tabs.push({ key: env, label: env, count: n });
    }
    for (const [env, n] of Array.from(counts.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      if ((ENV_OPTIONS as readonly string[]).includes(env)) continue;
      if (env === UNSPECIFIED_ENVIRONMENT) continue;
      tabs.push({ key: env, label: env, count: n });
    }
    const unspecified = counts.get(UNSPECIFIED_ENVIRONMENT) ?? 0;
    if (unspecified > 0) {
      tabs.push({
        key: UNSPECIFIED_ENVIRONMENT,
        label: UNSPECIFIED_ENVIRONMENT,
        count: unspecified,
      });
    }
    return tabs;
  }, [resources]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      const cloud = resourceCloudLabel(r.attributes) ?? "";
      const typeLabel = r.resource_type?.label ?? "";
      const env = resourceEnvironmentLabel(r.attributes);
      if (envFilter !== "all" && env !== envFilter) return false;
      if (serviceFilter !== "all" && typeLabel !== serviceFilter) return false;
      if (!q) return true;
      const hay = [
        r.name,
        cloud,
        typeLabel,
        env,
        r.external_id ?? "",
        summarizeAttributes(typeLabel, r.attributes, { skipType: true }),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [resources, query, serviceFilter, envFilter]);

  const filtersActive =
    query.trim() !== "" || serviceFilter !== "all" || envFilter !== "all";

  useEffect(() => {
    if (createState?.ok) {
      setOpen(false);
      setProvider("AWS");
      setService("EC2 — Virtual Server");
      router.refresh();
    }
  }, [createState, router]);

  useEffect(() => {
    if (editState?.ok) {
      setEditing(null);
      router.refresh();
    }
  }, [editState, router]);

  function onProviderChange(next: string) {
    setProvider(next);
    const first = servicesForProvider(next)[0];
    setService(first?.value ?? "Custom resource");
  }

  function openEditModal(r: InfraResourceRow) {
    const cloud = resourceCloudLabel(r.attributes) || "AWS";
    const typeLabel = r.resource_type?.label || "EC2 — Virtual Server";
    setOpen(false);
    setProvider(cloud);
    setService(typeLabel);
    setEditing(r);
  }

  function closeModals() {
    setOpen(false);
    setEditing(null);
  }

  function clearFilters() {
    setQuery("");
    setServiceFilter("all");
    setEnvFilter("all");
  }

  function openAddModalForEnv(env?: string) {
    setEditing(null);
    setProvider("AWS");
    setService("EC2 — Virtual Server");
    if (env && env !== "all" && env !== UNSPECIFIED_ENVIRONMENT) {
      setEnvFilter(env);
    }
    setOpen(true);
  }

  const modalOpen = canEdit && (open || !!editing);
  const isEdit = !!editing;
  const formError = isEdit ? editState?.error : createState?.error;
  const formAction = isEdit ? editFormAction : createFormAction;
  const formKey = isEdit ? `edit-${editing.resource_id}` : "add";
  const formAttrDefaults = useMemo(() => {
    if (editing?.attributes) return editing.attributes;
    if (
      envFilter !== "all" &&
      envFilter !== UNSPECIFIED_ENVIRONMENT &&
      (ENV_OPTIONS as readonly string[]).includes(envFilter)
    ) {
      return { environment: envFilter };
    }
    return undefined;
  }, [editing, envFilter]);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Resources
            <HelpTip text="Authorized inventory for this project. Invoice lines that do not match these resources are flagged out of scope." />
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Project inventory by environment (Production, Staging, …) and service
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => openAddModalForEnv(envFilter)}
            className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add Resource
          </button>
        )}
      </div>

      {openOutOfScopeCount > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-950">
          <span className="font-medium">
            {openOutOfScopeCount} out-of-scope line{openOutOfScopeCount === 1 ? "" : "s"}
          </span>
          {" — "}
          charged on invoices but not matching Resources. Add matching inventory or check pills on
          invoices.
        </div>
      )}

      <div className="space-y-4 p-5">
        {resources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
            <p className="text-sm font-medium text-gray-800">No resources yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Add EC2, RDS, VPC, Jira, Copilot, and other inventory for this project.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => openAddModalForEnv()}
                className="mt-4 text-sm font-medium text-brand-700 hover:underline"
              >
                Add your first resource
              </button>
            )}
          </div>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1.5 border-b border-gray-100 pb-3"
              role="tablist"
              aria-label="Filter by environment"
            >
              {envTabs.map((tab) => {
                const active = envFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setEnvFilter(tab.key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      active
                        ? "bg-gray-900 text-white ring-gray-900"
                        : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`ml-1.5 tabular-nums ${
                        active ? "text-gray-300" : "text-gray-400"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1 text-sm">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Search
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, ID, region, cloud…"
                  className="input w-full"
                />
              </label>
              <label className="w-full text-sm sm:w-56">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Service
                </span>
                <select
                  className="input w-full"
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  {serviceOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="pb-2 text-xs font-medium text-brand-700 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
                <p className="text-sm font-medium text-gray-800">No matching resources</p>
                <p className="mt-1 text-sm text-gray-500">Try a different search or clear filters.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 text-sm font-medium text-brand-700 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <div className="max-h-[28rem] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 shadow-sm">
                      <tr>
                        <th className="bg-gray-50 px-4 py-2.5 font-medium">Name</th>
                        <th className="bg-gray-50 px-4 py-2.5 font-medium">Service</th>
                        {envFilter === "all" && (
                          <th className="bg-gray-50 px-4 py-2.5 font-medium">Environment</th>
                        )}
                        <th className="bg-gray-50 px-4 py-2.5 font-medium">ID / Ref</th>
                        <th className="bg-gray-50 px-4 py-2.5 font-medium">Details</th>
                        {canEdit && (
                          <th className="bg-gray-50 px-4 py-2.5 font-medium text-right"> </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const typeLabel = r.resource_type?.label ?? null;
                        const env = resourceEnvironmentLabel(r.attributes);
                        return (
                          <tr
                            key={r.resource_id}
                            className="border-b border-gray-50 last:border-0 hover:bg-gray-50/80"
                          >
                            <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                            <td className="px-4 py-2.5 text-gray-700">{typeLabel ?? "—"}</td>
                            {envFilter === "all" && (
                              <td className="px-4 py-2.5">
                                <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                                  {env}
                                </span>
                              </td>
                            )}
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-600">
                              {r.external_id ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-gray-600">
                              {summarizeAttributes(typeLabel, r.attributes, {
                                skipType: true,
                              })}
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(r)}
                                    className="text-xs font-medium text-brand-700 hover:underline"
                                  >
                                    Edit
                                  </button>
                                  <ConfirmButton
                                    action={deleteInfraResource.bind(
                                      null,
                                      projectId,
                                      r.resource_id
                                    )}
                                    message={`Delete resource "${r.name}"?`}
                                    className="text-xs text-red-600 hover:underline"
                                  >
                                    Delete
                                  </ConfirmButton>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
                  {filtersActive
                    ? `Showing ${filtered.length} of ${resources.length}`
                    : `${resources.length} resource${resources.length === 1 ? "" : "s"}`}
                  {filtered.length > 8 ? " · scroll for more" : null}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                {isEdit ? "Edit Resource" : "Add Infrastructure Resource"}
              </h3>
              <button
                type="button"
                onClick={closeModals}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            {formError && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
            )}

            <form key={formKey} action={formAction} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Resource Name <span className="text-red-500">*</span>
                </span>
                <input
                  name="name"
                  required
                  className="input"
                  placeholder="e.g. atg-web-server"
                  defaultValue={editing?.name ?? ""}
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Cloud / Tool <span className="text-red-500">*</span>
                </span>
                <select
                  name="attr_provider"
                  required
                  className="input"
                  value={provider}
                  onChange={(e) => onProviderChange(e.target.value)}
                >
                  {CLOUD_OR_TOOL_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {!knownProviders.has(provider) && (
                    <option value={provider}>{provider}</option>
                  )}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Service / Resource Type <span className="text-red-500">*</span>
                </span>
                <select
                  name="type_label"
                  required
                  className="input"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  {serviceGroups.map((g) => (
                    <optgroup key={g.category} label={g.category}>
                      {g.services.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {!serviceGroups.some((g) => g.services.some((s) => s.value === service)) && (
                    <option value={service}>{service}</option>
                  )}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                {dynamicFields.map((f) => (
                  <DynamicField
                    key={`${formKey}-${provider}-${service}-${f.key}-${String(
                      formAttrDefaults?.environment ?? ""
                    )}`}
                    field={f}
                    defaults={formAttrDefaults}
                  />
                ))}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  External ID / ref <span className="font-normal text-gray-400">(Optional)</span>
                </span>
                <input
                  name="external_id"
                  className="input"
                  placeholder="Instance ID, ARN, workspace key…"
                  defaultValue={editing?.external_id ?? ""}
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModals}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <Submit label={isEdit ? "Save changes" : "Confirm Resource"} />
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

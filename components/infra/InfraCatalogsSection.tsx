"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createInfraProviderLookup,
  createOwnershipLookup,
  createResourceTypeLookup,
} from "@/app/projects/[id]/infra/actions";
import type { ActionState, OwnershipOption, ProviderOption, InfraResourceType } from "@/lib/types";

/**
 * Compact catalog manager on InfraSpecs — fills empty Provider / Ownership /
 * Resource type dropdowns without hardcoding any labels.
 */
export function InfraCatalogsSection({
  projectId,
  providers,
  ownershipOptions,
  resourceTypes,
  isAdmin,
}: {
  projectId: string;
  providers: ProviderOption[];
  ownershipOptions: OwnershipOption[];
  resourceTypes: InfraResourceType[];
  isAdmin: boolean;
}) {
  const router = useRouter();

  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Catalogs</h2>
        <p className="text-xs text-gray-500">Add options used by dropdowns (not hardcoded).</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CatalogColumn
          title="Providers"
          items={providers.map((p) => p.label)}
          action={createInfraProviderLookup}
          placeholder="New provider label"
          onAdded={() => {
            router.refresh();
          }}
          revalidateHint={projectId}
        />
        <CatalogColumn
          title="Ownership / category"
          items={ownershipOptions.map((o) => o.label)}
          action={createOwnershipLookup}
          placeholder="New ownership label"
          disabled={!isAdmin}
          disabledHint="Admin only"
          onAdded={() => router.refresh()}
          revalidateHint={projectId}
        />
        <CatalogColumn
          title="Resource types"
          items={resourceTypes.map((t) => t.label)}
          action={createResourceTypeLookup}
          placeholder="New resource type"
          onAdded={() => router.refresh()}
          revalidateHint={projectId}
        />
      </div>
    </section>
  );
}

function CatalogColumn({
  title,
  items,
  action,
  placeholder,
  disabled,
  disabledHint,
  onAdded,
}: {
  title: string;
  items: string[];
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  placeholder: string;
  disabled?: boolean;
  disabledHint?: string;
  onAdded?: () => void;
  revalidateHint?: string;
}) {
  const [state, formAction] = useFormState(action, undefined as ActionState);

  useEffect(() => {
    if (state?.ok) onAdded?.();
  }, [state, onAdded]);

  return (
    <div className="rounded-md border border-gray-200 bg-white p-2.5">
      <p className="text-xs font-medium text-gray-700">
        {title}{" "}
        <span className="font-normal text-gray-400">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-amber-700">No options yet — add one below.</p>
      ) : (
        <ul className="mt-1 max-h-20 overflow-y-auto text-xs text-gray-600">
          {items.map((label) => (
            <li key={label} className="truncate">
              {label}
            </li>
          ))}
        </ul>
      )}
      {disabled ? (
        <p className="mt-2 text-xs text-gray-400">{disabledHint}</p>
      ) : (
        <form action={formAction} className="mt-2 flex gap-1">
          <input
            name="label"
            required
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <AddBtn />
        </form>
      )}
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}

function AddBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-gray-900 px-2 py-1 text-xs text-white disabled:opacity-50"
    >
      {pending ? "…" : "Add"}
    </button>
  );
}

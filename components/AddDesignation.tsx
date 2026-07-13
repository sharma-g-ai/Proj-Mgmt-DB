"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createDesignation } from "@/app/users/actions";

export function AddDesignation() {
  const [state, formAction] = useFormState(createDesignation, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the input after a successful add (the list revalidates server-side).
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        New designation
        <input name="label" required placeholder="e.g. QA Engineer"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
      </label>
      <AddButton />
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending}
      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
      {pending ? "Adding…" : "+ Add"}
    </button>
  );
}

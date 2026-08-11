"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/types";

/** Compact “add a lookup label” control used under empty selects. */
export function LookupAddInline({
  action,
  placeholder,
  buttonLabel = "+ Add",
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  placeholder: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, undefined as ActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="mt-1.5 flex flex-wrap items-center gap-2">
      <input
        name="label"
        required
        placeholder={placeholder}
        className="min-w-[10rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      <AddBtn label={buttonLabel} />
      {state?.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

function AddBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

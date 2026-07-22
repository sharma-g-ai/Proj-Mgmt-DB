"use client";

import { useState } from "react";

// Small modal used wherever a staged change (Spec 10) needs a requester-side
// reason before submission — the caller runs its gated action first, gets
// `needsReason: true` back with nothing written, then opens this to collect
// the reason and resubmits.
export function ReasonModal({
  title,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  pending: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">
          This change needs Admin approval before it takes effect. Briefly explain why.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Reason for this change…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => reason.trim() && onSubmit(reason.trim())}
            disabled={pending || !reason.trim()}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

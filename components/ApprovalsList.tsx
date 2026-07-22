"use client";

import { useState, useTransition } from "react";
import { approveChangeRequest, rejectChangeRequest } from "@/app/projects/actions";
import type { ChangeRequestRow } from "@/lib/types";

export function ApprovalsList({ requests }: { requests: ChangeRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">
        No changes awaiting approval.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <ApprovalCard key={r.request_id} request={r} />
      ))}
    </div>
  );
}

function ApprovalCard({ request }: { request: ChangeRequestRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Both Approve and Reject reveal the same optional-note prompt before
  // firing — a note is meaningful either way (Spec 10: approval note parity).
  const [reviewing, setReviewing] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  function openReview(kind: "approve" | "reject") {
    setError(null);
    setNote("");
    setReviewing(kind);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res =
        reviewing === "approve"
          ? await approveChangeRequest(request.request_id, note)
          : await rejectChangeRequest(request.request_id, note);
      if (res.error) setError(res.error);
      else setReviewing(null);
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{request.project?.project_name ?? "—"}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {request.kind === "EstimatedHours" ? "Estimated Effort Hrs change" : "Allocation change"} · requested by{" "}
            {request.requester?.full_name ?? "—"}
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{request.summary}</p>
          {request.reason && (
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-medium text-gray-500">Reason: </span>
              {request.reason}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openReview("approve")}
            disabled={pending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => openReview("reject")}
            disabled={pending}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </div>
      {reviewing && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className={
              reviewing === "approve"
                ? "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                : "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            }
          >
            {reviewing === "approve" ? "Confirm Approve" : "Confirm Reject"}
          </button>
          <button
            type="button"
            onClick={() => setReviewing(null)}
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

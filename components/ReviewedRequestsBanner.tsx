"use client";

import { useState, useTransition } from "react";
import { acknowledgeChangeRequest } from "@/app/projects/actions";
import type { ChangeRequestRow } from "@/lib/types";

// Dashboard notification for a Manager-Lead whose staged change was reviewed
// (Spec 10 notification flow) — the counterpart to the pending-approval
// banner, since a Pending row otherwise just disappears once acted on.
export function ReviewedRequestsBanner({ requests }: { requests: ChangeRequestRow[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = requests.filter((r) => !dismissed.has(r.request_id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((r) => (
        <ReviewedCard key={r.request_id} request={r} onDismissed={() => setDismissed((s) => new Set(s).add(r.request_id))} />
      ))}
    </div>
  );
}

function ReviewedCard({ request, onDismissed }: { request: ChangeRequestRow; onDismissed: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const approved = request.status === "Approved";

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const res = await acknowledgeChangeRequest(request.request_id);
      if (res.error) setError(res.error);
      else onDismissed();
    });
  }

  return (
    <div className={`rounded-md px-3 py-2 text-sm ${approved ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p>
            <span className="font-medium">{request.project?.project_name ?? "—"}</span> — your{" "}
            {request.kind === "EstimatedHours" ? "Estimated Effort Hrs change" : "allocation change"} was{" "}
            <span className="font-semibold">{approved ? "approved" : "rejected"}</span>.
          </p>
          {request.review_note && (
            <p className="mt-1 italic">&ldquo;{request.review_note}&rdquo;</p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="shrink-0 rounded-md border border-current/30 bg-white/60 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

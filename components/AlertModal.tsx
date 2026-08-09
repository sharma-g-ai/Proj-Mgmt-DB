"use client";

import { useEffect } from "react";

type AlertTone = "info" | "success" | "warning" | "error";

const TONE: Record<
  AlertTone,
  { ring: string; badge: string; badgeText: string; title: string }
> = {
  info: {
    ring: "bg-sky-100 text-sky-800",
    badge: "i",
    badgeText: "Notice",
    title: "Notice",
  },
  success: {
    ring: "bg-emerald-100 text-emerald-800",
    badge: "✓",
    badgeText: "Success",
    title: "Success",
  },
  warning: {
    ring: "bg-amber-100 text-amber-800",
    badge: "!",
    badgeText: "Warning",
    title: "Warning",
  },
  error: {
    ring: "bg-red-100 text-red-800",
    badge: "!",
    badgeText: "Error",
    title: "Error",
  },
};

/** Centered alert dialog for infra / billing feedback. */
export function AlertModal({
  title,
  message,
  tone = "warning",
  onClose,
  confirmLabel = "Got it",
}: {
  title?: string;
  message: string;
  tone?: AlertTone;
  onClose: () => void;
  confirmLabel?: string;
}) {
  const t = TONE[tone];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
        aria-describedby="alert-modal-body"
        className="flex max-h-[min(85vh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-start gap-3 overflow-y-auto px-5 pt-5">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${t.ring}`}
          >
            {t.badge}
          </span>
          <div className="min-w-0 flex-1 pb-2">
            <h3 id="alert-modal-title" className="text-sm font-semibold text-gray-900">
              {title ?? t.title}
            </h3>
            <p
              id="alert-modal-body"
              className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600"
            >
              {message}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-t border-gray-100 bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

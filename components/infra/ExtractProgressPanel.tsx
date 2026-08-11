"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const EXTRACT_STAGES = [
  "Uploading files…",
  "Reading documents…",
  "Extracting totals & line items…",
  "Checking billing accounts…",
] as const;

/** Animated progress UI for invoice extract (upload form or list auto-extract). */
export function ExtractProgressPanel({
  fileCount = 1,
  fileNames = [],
  label,
  percent,
  stage,
}: {
  fileCount?: number;
  fileNames?: string[];
  /** Override status line (e.g. "Extracting 2 of 5"). */
  label?: string;
  /** Controlled percent 0–100; if omitted, eases toward ~92% while mounted. */
  percent?: number;
  stage?: string;
}) {
  const [autoPct, setAutoPct] = useState(6);
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    if (percent != null) return;
    setAutoPct(6);
    setStageIdx(0);
    const stageMs = fileCount > 1 ? 3500 : 2800;
    const stageTimer = window.setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, EXTRACT_STAGES.length - 1));
    }, stageMs);
    const pctTimer = window.setInterval(() => {
      setAutoPct((p) => {
        if (p >= 92) return 92;
        return Math.min(92, p + Math.max(0.35, (92 - p) * 0.045));
      });
    }, 220);
    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(pctTimer);
    };
  }, [fileCount, percent]);

  const pct = Math.round(percent ?? autoPct);
  const status =
    label ??
    stage ??
    EXTRACT_STAGES[Math.min(stageIdx, EXTRACT_STAGES.length - 1)];
  const shownNames = fileNames.slice(0, 4);

  return (
    <div
      className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 py-5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex gap-1" aria-hidden>
          <span className="extract-pulse-dot h-2 w-2 rounded-full bg-brand-500" />
          <span
            className="extract-pulse-dot h-2 w-2 rounded-full bg-brand-500"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="extract-pulse-dot h-2 w-2 rounded-full bg-brand-500"
            style={{ animationDelay: "0.4s" }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {fileCount > 1
              ? `Extracting ${fileCount} invoices`
              : "Extracting invoice"}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{status}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">
          {pct}%
        </span>
      </div>

      <div className="extract-progress-track mt-4">
        <div className="extract-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {shownNames.length > 0 && (
        <ul className="mt-3 space-y-1">
          {shownNames.map((name) => (
            <li key={name} className="truncate text-xs text-gray-500">
              {name}
            </li>
          ))}
          {fileNames.length > shownNames.length && (
            <li className="text-xs text-gray-400">
              +{fileNames.length - shownNames.length} more
            </li>
          )}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-gray-400">
        Large PDFs can take a minute — keep this tab open.
      </p>
    </div>
  );
}

/** Renders only while the parent form action is pending (must live under &lt;form&gt;). */
export function FormExtractProgress({
  fileCount,
  fileNames,
}: {
  fileCount: number;
  fileNames: string[];
}) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-sm">
        <ExtractProgressPanel fileCount={Math.max(1, fileCount)} fileNames={fileNames} />
      </div>
    </div>
  );
}

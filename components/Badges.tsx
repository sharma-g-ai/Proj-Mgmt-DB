import { isOverrun } from "@/lib/format";
import type { Priority } from "@/lib/types";

const priorityStyles: Record<Priority, string> = {
  High: "bg-red-50 text-red-700 ring-red-600/20",
  Medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Low: "bg-gray-100 text-gray-600 ring-gray-500/20",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${priorityStyles[priority]}`}
    >
      {priority}
    </span>
  );
}

// Spec 02 §8.3 — distinct "OVER" badge for >100% completion.
export function OverBadge({ pctCompletion }: { pctCompletion: number | null }) {
  if (!isOverrun(pctCompletion)) return null;
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
      Over
    </span>
  );
}

export function StatusBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      {label}
    </span>
  );
}

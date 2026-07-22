"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// Small, self-contained transient success notification — no global
// provider/context, just local state at the call site. Auto-dismisses.
// Rendered via a portal to <body> so it's safe to use from call sites with
// restrictive DOM contexts (e.g. inside a <table>'s <tbody>/<tr>).
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-50 rounded-md bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
      {message}
    </div>,
    document.body
  );
}

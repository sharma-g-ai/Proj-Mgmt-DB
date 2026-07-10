// Static loading placeholders (no data fetch) for route-level loading.tsx files.

export function HeaderSkeleton() {
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <div className="h-5 w-32 rounded bg-gray-200" />
          <div className="hidden gap-4 sm:flex">
            <div className="h-4 w-16 rounded bg-gray-100" />
            <div className="h-4 w-16 rounded bg-gray-100" />
            <div className="h-4 w-16 rounded bg-gray-100" />
          </div>
        </div>
        <div className="h-8 w-40 rounded bg-gray-100" />
      </div>
    </div>
  );
}

export function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-gray-200 ${className}`} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <Bar className="h-3 w-40" />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Bar key={c} className={`h-4 ${c === 0 ? "w-40" : "w-20"}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <Bar className="mb-3 h-3 w-20" />
          <Bar className="h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

// Wraps skeleton content with the header placeholder and the standard page frame.
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen animate-pulse">
      <HeaderSkeleton />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">{children}</main>
    </div>
  );
}

import { PageSkeleton, Bar } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <Bar className="h-6 w-48" />
      <div className="grid grid-cols-1 gap-6 rounded-xl border border-gray-200 bg-white p-5 md:grid-cols-2">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
      <Bar className="h-40 w-full rounded-xl" />
    </PageSkeleton>
  );
}

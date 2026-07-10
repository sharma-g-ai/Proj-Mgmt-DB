import { PageSkeleton, Bar, CardsSkeleton, TableSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <Bar className="h-6 w-32" />
      <CardsSkeleton count={4} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <TableSkeleton rows={6} cols={6} />
    </PageSkeleton>
  );
}

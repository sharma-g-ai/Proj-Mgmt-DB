import { PageSkeleton, Bar, TableSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="flex items-center justify-between">
        <Bar className="h-6 w-32" />
        <Bar className="h-9 w-32" />
      </div>
      <TableSkeleton rows={8} cols={6} />
    </PageSkeleton>
  );
}

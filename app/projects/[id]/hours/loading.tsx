import { PageSkeleton, Bar, TableSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <Bar className="h-6 w-56" />
      <TableSkeleton rows={5} cols={5} />
    </PageSkeleton>
  );
}

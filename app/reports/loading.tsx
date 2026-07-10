import { PageSkeleton, Bar } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <Bar className="h-6 w-28" />
      <Bar className="h-64 w-full max-w-xl rounded-xl" />
    </PageSkeleton>
  );
}

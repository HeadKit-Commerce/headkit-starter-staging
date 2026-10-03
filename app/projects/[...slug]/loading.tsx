import { PageNavigationSkeletonBody } from "@/components/headkit-ui/skeletons/navigation-skeleton";

/** Instant navigation fallback for a project card. Shown only when that page is not ready. */
export default function ProjectLoading(): React.JSX.Element {
  return (
    <div className="px-5 py-8 md:px-10">
      <PageNavigationSkeletonBody />
    </div>
  );
}

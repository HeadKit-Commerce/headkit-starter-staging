import { PostNavigationSkeletonBody } from "@/components/headkit-ui/skeletons/navigation-skeleton";

/** Instant navigation fallback for a post card. Shown only when that page is not ready. */
export default function NewsLoading(): React.JSX.Element {
  return (
    <div className="px-5 py-8 md:px-10">
      <PostNavigationSkeletonBody />
    </div>
  );
}

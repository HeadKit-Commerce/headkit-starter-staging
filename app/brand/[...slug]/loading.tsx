import { CollectionPageSkeleton } from "@/components/headkit-ui/skeletons/collection-page-skeleton";

/** Instant navigation fallback for a brand card. Shown only when that page is not ready. */
export default function BrandLoading(): React.JSX.Element {
  return <CollectionPageSkeleton />;
}

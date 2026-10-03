import { CollectionPageSkeleton } from "@/components/headkit-ui/skeletons/collection-page-skeleton";

/**
 * Instant navigation fallback for `/collections/…`, including facet URLs.
 *
 * Shown only when that page is not already ready.
 */
export default function CollectionLoading(): React.JSX.Element {
  return <CollectionPageSkeleton />;
}

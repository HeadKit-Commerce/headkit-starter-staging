import { Skeleton } from "@/components/ui/skeleton";
import { CATALOG_ROW_QUANTUM } from "@/components/headkit-ui/catalog-grid";
import { ProductGridSkeleton } from "@/components/headkit-ui/skeletons/product-card-skeleton";

interface CollectionPageSkeletonProps {
  /** "collection" = h1 + description (+ optional featured image); "brand" = h1 */
  variant?: "collection" | "brand";
  /**
   * Pulse the placeholders. Off by default, and every server caller leaves it
   * that way — see the note below on why the RSC shells stay static.
   *
   * Client callers that want a pulse (e.g. in-grid pending rows) turn it ON.
   */
  animated?: boolean;
}

/**
 * Layout-matched App Shell fallback for Instant Navigation / Partial Prefetching.
 *
 * Mirrors CollectionHeader + optional subcategory strip + filter bar + product
 * grid proportions so first paint / IN transitions don't jump when content
 * streams in. Kept static (no `animate-pulse`) by default so CDN-sealed RSC HTML
 * stays lean; pass `animated` when a client pending cue should pulse.
 *
 * @see https://nextjs.org/docs/app/guides/adopting-partial-prefetching
 */
export function CollectionPageSkeleton({
  variant = "collection",
  animated = false,
}: CollectionPageSkeletonProps) {
  return (
    <div>
      <div className="mb-5 grid grid-cols-1 gap-6 px-5 md:grid-cols-12 md:gap-8 md:px-10 md:pt-8">
        <div className="pt-5 md:col-span-4 md:pt-0">
          {variant === "brand" ? (
            <Skeleton
              animated={animated}
              className="mb-3 h-16 w-32 rounded-brand"
            />
          ) : null}
          <Skeleton
            animated={animated}
            className="mb-[10px] h-9 w-56 max-w-full"
          />
          <div className="space-y-2">
            <Skeleton animated={animated} className="h-4 w-full max-w-md" />
            <Skeleton animated={animated} className="h-4 w-full max-w-sm" />
          </div>
        </div>
        {variant === "collection" ? (
          <Skeleton
            animated={animated}
            className="aspect-[915/458] w-full md:col-span-8 md:aspect-auto md:min-h-[320px]"
          />
        ) : null}
      </div>

      {/* Subcategory / child carousel strip (common on parent categories) */}
      {variant === "collection" ? (
        <div className="mb-5 flex gap-[30px] overflow-hidden px-5 md:px-10">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton
              key={i}
              animated={animated}
              className="h-24 w-36 shrink-0 rounded-brand md:h-28 md:w-44"
            />
          ))}
        </div>
      ) : null}

      <CollectionProductsSkeleton animated={animated} />
    </div>
  );
}

/** Filter bar + lean product grid — Suspense island / loading.tsx shell. */
export function CollectionProductsSkeleton({
  animated = false,
}: {
  animated?: boolean;
} = {}) {
  return (
    <div>
      <div className="flex w-full items-center justify-between bg-brand-bg/80 px-5 py-5 md:px-10">
        <Skeleton animated={animated} className="h-10 w-24 rounded-brand" />
        <Skeleton animated={animated} className="h-10 w-28 rounded-brand" />
      </div>
      <div className="px-5 md:px-10">
        {/* Full-row quantum (LCM of 2/3/4 cols) — matches ProductGrid load skeletons */}
        <ProductGridSkeleton count={CATALOG_ROW_QUANTUM} shell={!animated} />
      </div>
    </div>
  );
}

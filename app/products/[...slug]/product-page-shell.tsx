import { Skeleton } from "@/components/ui/skeleton";
import { ProductCardSkeleton } from "@/components/headkit-ui/skeletons/product-card-skeleton";

/**
 * The `<Suspense>` fallback for the flat PDP's REQUEST-TIME branch only.
 *
 * A product the public catalogue can see is composed by `ProductPageBody`
 * outside any boundary on both PDP routes, so this skeleton is never shown for
 * it. `/products/[...slug]` renders it only around `ProductPageContent`, the
 * branch that runs when the public read returned null — a Shopify draft under
 * Admin preview, a missing product, or a failed read — because that branch
 * awaits `searchParams` and must sit below a boundary. The nested
 * `/shop/[...slug]` route no longer uses it at all; see the altitude note on
 * `ProductPage` in `./page.tsx`.
 */
export function ProductPageShell(): React.JSX.Element {
  return (
    // Opaque on purpose. A fade restarts whenever this shell
    // mounts again, which flashes as the product replaces it.
    <div>
      <div className="px-5 pt-6 md:px-10">
        <Skeleton className="h-4 w-48 max-w-full sm:w-64" />
      </div>

      <div className="px-5 py-8 md:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="hidden gap-5 md:grid md:grid-cols-2">
            <Skeleton className="col-span-2 aspect-square w-full rounded-brand" />
            <Skeleton className="aspect-square w-full rounded-brand" />
            <Skeleton className="aspect-square w-full rounded-brand" />
          </div>
          <div className="block md:hidden">
            <Skeleton className="aspect-square w-full rounded-brand" />
          </div>

          <div className="flex flex-col">
            <Skeleton className="mb-3 h-8 w-3/4 md:h-9" />
            <Skeleton className="mb-5 h-5 w-full" />
            <Skeleton className="mb-5 h-5 w-2/3" />
            <div className="mb-5 flex flex-col gap-4">
              <Skeleton className="h-5 w-20" />
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="size-10 rounded-full" />
                ))}
              </div>
            </div>
            <Skeleton className="mb-4 h-5 w-24" />
            <Skeleton className="mb-6 h-8 w-32" />
            <div className="mb-6 flex items-center gap-3">
              <Skeleton className="h-12 w-24 rounded-brand-button" />
              <Skeleton className="h-12 flex-1 rounded-brand-button" />
            </div>
          </div>
        </div>
      </div>

      <section className="overflow-hidden py-10">
        <div className="px-5 md:px-10">
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-2 py-5 md:grid-cols-3">
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

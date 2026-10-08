import type {
  ProductSummaryFieldsFragment,
  ProductFilters,
} from "@headkit/sdk";
import { SwatchImageProvider } from "@/components/headkit-ui/swatch-image-provider";
import { experimentalSwatchImagesEnabled } from "@/lib/experimental-swatch-images";
import { loadSwatchImageMap } from "@/lib/swatch-visual";
import { CollectionProvider } from "./collection-context";
import { Filter } from "./filter";
import { ProductGrid } from "./product-grid";
import { LoadPrevious, LoadMore, ProductCount } from "./pagination";

interface CollectionPageProps {
  initialProducts: ProductSummaryFieldsFragment[];
  initialTotal: number;
  productFilter: ProductFilters;
  initialPage?: number;
  itemsPerPage?: number;
  onSale?: boolean;
  isNew?: boolean;
  search?: string;
  brandSlug?: string;
  categorySlug?: string;
  categoryBasePath?: string;
  initialFilterValues?: Record<string, string[]>;
  initialBrands?: string[];
  /** Leaf category featured image already owns LCP — do not priority grid cards. */
  preferHeaderLcp?: boolean;
}

/** The identity-bearing half of `CollectionPageProps` — everything that decides
 *  WHICH product set the server rendered, and nothing that is merely its content. */
type CollectionIdentityProps = {
  [K in
    | "initialPage"
    | "onSale"
    | "isNew"
    | "search"
    | "brandSlug"
    | "categorySlug"
    | "categoryBasePath"
    | "initialFilterValues"
    | "initialBrands"]: CollectionPageProps[K] | undefined;
};

/**
 * The React `key` for one mounted `CollectionProvider`: a stable string naming
 * the product set the server just rendered.
 *
 * `CollectionProvider` seeds `products` / `totalProducts` / `currentPage` with
 * `useState(initial…)`, which React keeps for the life of the component
 * INSTANCE — a later render with different props does not touch it. That is the
 * right behaviour while the shopper stays on one listing (Load More has appended
 * pages that no re-render may wipe) and the wrong behaviour the moment the route
 * underneath the provider changes.
 *
 * Most listing routes get away with it because Next keys each dynamic-segment
 * VALUE as its own subtree, so `/collections/a` → `/collections/b` remounts the
 * provider on its own. `/search` has no dynamic segment: `?q=helmet` → `?q=gloves`
 * re-renders the SAME instance, and the grid kept serving the first query's
 * products under the second query's heading. Changing this key is what turns
 * that re-render into a remount, and any future listing route that varies by
 * query rather than by segment inherits the same defect without it.
 *
 * Deliberately EXCLUDED: `initialProducts`, `initialTotal`, `productFilter`,
 * `itemsPerPage` and `preferHeaderLcp`. Those are the set's CONTENT, not its
 * identity — keying on them would make a background revalidation of the same URL
 * throw away the pages the shopper had already loaded.
 */
export function collectionInstanceKey(props: CollectionIdentityProps): string {
  return JSON.stringify([
    props.categoryBasePath ?? null,
    props.categorySlug ?? null,
    props.brandSlug ?? null,
    props.search ?? null,
    props.onSale ?? null,
    props.isNew ?? null,
    props.initialPage ?? null,
    props.initialBrands ?? null,
    // Object key order comes from the filter slug's own decode order, which is
    // deterministic for a given URL — the same URL always stringifies the same.
    props.initialFilterValues ?? null,
  ]);
}

export function CollectionPage({
  initialProducts,
  initialTotal,
  productFilter,
  initialPage = 1,
  itemsPerPage = 24,
  onSale,
  isNew,
  search,
  brandSlug,
  categorySlug,
  categoryBasePath,
  initialFilterValues,
  initialBrands,
  preferHeaderLcp = false,
}: CollectionPageProps) {
  const swatchImagesEnabled = experimentalSwatchImagesEnabled();
  return (
    <SwatchImageProvider
      enabled={swatchImagesEnabled}
      {...(swatchImagesEnabled
        ? { promise: loadSwatchImageMap(initialProducts) }
        : {})}
    >
      <CollectionProvider
        // See `collectionInstanceKey`: without it a same-route navigation keeps
        // the previous route's products, total and pagination cursor.
        key={collectionInstanceKey({
          initialPage,
          onSale,
          isNew,
          search,
          brandSlug,
          categorySlug,
          categoryBasePath,
          initialFilterValues,
          initialBrands,
        })}
        initialProducts={initialProducts}
        initialTotal={initialTotal}
        productFilter={productFilter}
        initialPage={initialPage}
        itemsPerPage={itemsPerPage}
        onSale={onSale}
        isNew={isNew}
        search={search}
        brandSlug={brandSlug}
        categorySlug={categorySlug}
        categoryBasePath={categoryBasePath}
        initialFilterValues={initialFilterValues}
        initialBrands={initialBrands}
      >
        <div className="headkit-collection flex flex-col gap-4">
          <Filter />
          <LoadPrevious />
          <ProductGrid preferHeaderLcp={preferHeaderLcp} />
          <div className="flex flex-col items-center gap-5 pb-10">
            <LoadMore />
            <ProductCount />
          </div>
        </div>
      </CollectionProvider>
    </SwatchImageProvider>
  );
}

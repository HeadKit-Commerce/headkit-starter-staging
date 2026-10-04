"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useCollection } from "./collection-context";
import { ProductCard } from "@/components/headkit-ui/product-card";
import { ProductCardSkeleton } from "@/components/headkit-ui/skeletons/product-card-skeleton";
import {
  CATALOG_GRID_CLASS,
  CATALOG_ROW_QUANTUM,
} from "@/components/headkit-ui/catalog-grid";
import { useCatalogDisplay } from "@/components/headkit-ui/catalog-display-provider";
import {
  expandCatalogProducts,
  partitionFullRows,
} from "@/lib/catalog-display";
import {
  buildViewItemList,
  productToGa4Item,
  pushGa4Ecommerce,
} from "@/lib/ga4-ecommerce";

function LoadingSkeleton({
  count = CATALOG_ROW_QUANTUM,
  showSwatches = false,
}: {
  count?: number;
  showSwatches?: boolean;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton
          key={`skeleton-${i}`}
          showSwatches={showSwatches}
        />
      ))}
    </>
  );
}

export function ProductGrid({
  /**
   * When a parent collection's subcategory carousel owns LCP, skip grid
   * `priority` so those cards do not steal bandwidth from it. A leaf's first
   * product card is the LCP and keeps `priority`.
   */
  preferHeaderLcp = false,
}: {
  preferHeaderLcp?: boolean;
} = {}) {
  const { products, isLoading, isLoadingBefore, isLoadingAfter, hasMore } =
    useCollection();
  const { showVariants, showSwatches } = useCatalogDisplay();
  const catalogProducts = expandCatalogProducts(products, showVariants);
  // Hold incomplete trailing rows while more parent products can still load —
  // otherwise empty CSS-grid cells look like blank cards above Load More.
  const { visible: visibleProducts } = partitionFullRows(catalogProducts, {
    includeRemainder: !hasMore,
  });

  // GA4 `view_item_list`. `item_list_name` is the collection PATH — the one
  // list identity available on every surface this grid serves (category, brand,
  // /new, /sale, /search) without plumbing a title through four components, and
  // stable enough for a GA4 report to group on.
  //
  // Only products NOT yet reported for this path are sent. Load More appends to
  // the same grid, so re-sending the whole visible list would report the first
  // page's impressions a second time; the `index` stays the product's real
  // position in the grid, which is what the list report is ordered on. The
  // ledger resets when the path changes.
  const pathname = usePathname();
  const reported = useRef<{ path: string; ids: Set<string> }>({
    path: "",
    ids: new Set(),
  });
  const listKey = visibleProducts.map((product) => product.id).join(",");
  useEffect(() => {
    if (visibleProducts.length === 0) return;
    if (reported.current.path !== pathname) {
      reported.current = { path: pathname, ids: new Set() };
    }
    const seen = reported.current.ids;
    const fresh = visibleProducts
      .map((product, index) => ({ product, index }))
      .filter(({ product }) => !seen.has(product.id));
    if (fresh.length === 0) return;
    for (const { product } of fresh) seen.add(product.id);
    pushGa4Ecommerce(
      buildViewItemList(
        pathname,
        fresh.map(({ product, index }) =>
          productToGa4Item(product, { index, itemListName: pathname }),
        ),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, listKey]);

  const isEmpty =
    !isLoading &&
    !isLoadingBefore &&
    !isLoadingAfter &&
    catalogProducts.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-20 text-center md:px-10">
        <p className="text-lg font-medium text-gray-900">No products found</p>
        <p className="mt-2 text-sm text-gray-500">
          Try adjusting your filters or browse other categories.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 md:px-10 z-5">
      {/* Section heading so card titles can be h3 (same depth as carousels)
          without skipping a level after the collection h1. */}
      <h2 className="sr-only">Products</h2>
      <div className={CATALOG_GRID_CLASS}>
        {isLoadingBefore && (
          <LoadingSkeleton
            count={CATALOG_ROW_QUANTUM}
            showSwatches={showSwatches}
          />
        )}
        {visibleProducts.map((product, index) => (
          // Only the first above-the-fold card may compete for LCP. Prefetching
          // two+ images on a phone wastes bandwidth when filters push the grid
          // down; when the leaf header image owns LCP, skip priority entirely.
          // Off-screen rows defer layout/paint via content-visibility.
          <ProductCard
            key={product.id}
            product={product}
            isNew={product.isNew}
            titleAs="h3"
            listName={pathname}
            listIndex={index}
            priority={!preferHeaderLcp && index === 0}
            {...(index >= 4
              ? {
                  className:
                    "[content-visibility:auto] [contain-intrinsic-size:auto_360px]",
                }
              : {})}
          />
        ))}
        {(isLoading || isLoadingAfter) && (
          <LoadingSkeleton
            count={CATALOG_ROW_QUANTUM}
            showSwatches={showSwatches}
          />
        )}
      </div>
    </div>
  );
}

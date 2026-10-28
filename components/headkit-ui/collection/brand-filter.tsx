"use client";

import type { ProductFilterOption, ProductFilters } from "@headkit/sdk";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { useCollection } from "./collection-context";
import { FACET_DRAWER_GRID_CLASS } from "./facet-panel";

interface BrandFilterProps {
  /** See `CategoryFilterProps.gridClassName`. */
  gridClassName?: string;
}

/**
 * The Brand options for a listing route — ONE derivation, read by the facet
 * itself and by the trigger guard in `filter.tsx`.
 *
 * Two copies of this rule is how the defect below could come back halfway: a
 * guard that hides the trigger on an empty list, over a panel still reading a
 * different list, puts the two back out of agreement.
 */
export function brandFacetOptions(
  productFilter: Pick<ProductFilters, "brands">,
): ProductFilterOption[] {
  return (productFilter.brands ?? []).filter(
    (brand): brand is ProductFilterOption => !!brand?.slug && !!brand?.name,
  );
}

/**
 * Brand facet (multi-select, URL-synced via collection-context `brands[]`).
 *
 * THE OPTIONS ARE THE ROUTE'S OWN SCOPED LIST, and used to be the whole store's.
 * This component fetched `listFilterBrands()` from an effect on mount — a
 * store-wide `headkit.brands.list({ perPage: 100 })` with no category scope
 * anywhere in the chain — so every listing page offered a byte-identical panel,
 * and ticking a brand the category does not stock navigated to
 * `/collections/<cat>/f/brand.<slug>` and rendered "No products found".
 *
 * `productFilter.brands` is already in the payload every listing route awaits
 * (`getFilters(mainCategory)` / `getCatalogFilters()`): scoped to the category,
 * counted, and the same list `app/sitemap.ts` trusts for its brand-facet URLs.
 * On a search with scoped facets (`facetStatus === "ready"`) the provider swaps
 * that payload for the one counted over the matched products, so the same read
 * serves both. This is a read of data the page already had, not a new request:
 * the client round-trip is gone.
 *
 * Routes whose `productFilter` is the store-wide payload (`/shop`, `/sale`,
 * `/new`, `/featured`, `/brand/*` and bare `/search`) still offer every brand
 * the store lists; scoping those is a platform change (commerce, the gateway
 * and the SDK expose only `mainCategory`).
 *
 * Counts arrive with every option and stay unrendered, as they were.
 *
 * The UI/URL carry a multi-select array (D-02); per Open Q1 = single-ok, only
 * the first selected brand maps to the backend `ProductListFilter.brand` (see
 * utils.ts).
 */
export function BrandFilter({
  gridClassName = FACET_DRAWER_GRID_CLASS,
}: BrandFilterProps = {}) {
  const { filterValues, setFilterValues, productFilter } = useCollection();
  const brands = brandFacetOptions(productFilter);

  // `filter.tsx` guards the trigger on the same list, so this is not a
  // reachable UI state there — it is the contract for any other mount site.
  if (brands.length === 0) return null;

  return (
    <div className={gridClassName}>
      {brands.map((brand) => {
        const isSelected = filterValues.brands.includes(brand.slug);
        return (
          <label
            key={brand.slug}
            // `relative` is load-bearing, not decoration: the checkbox is `sr-only`,
            // which is `position: absolute`, so without a positioned ancestor its
            // containing block is the Radix menu viewport OUTSIDE the panel's scroll
            // container. Focusing it then scrolls the PAGE instead of the list
            // (measured: tabbing to the last category moved window.scrollY 1200 to
            // 1511 and took the panel off screen, while the container's scrollTop
            // stayed 0). Making the label the containing block puts the focus target
            // inside the scroller.
            className="relative flex min-h-10 items-center space-x-2 cursor-pointer"
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={isSelected}
              onChange={(e) => {
                const newBrands = e.target.checked
                  ? [...filterValues.brands, brand.slug]
                  : filterValues.brands.filter((s) => s !== brand.slug);
                setFilterValues({
                  ...filterValues,
                  brands: newBrands,
                  page: 1,
                });
              }}
            />
            <span className={cn("text-sm", isSelected && "font-bold")}>
              {decodeHtmlEntities(brand.name)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

"use server";

import type {
  ProductListFilter,
  ProductSummaryFieldsFragment,
} from "@headkit/sdk";
import { getCachedCatalogPage, scopeFromFilter } from "@/lib/catalog-cache";

export type CollectionPageResult = {
  products: ProductSummaryFieldsFragment[];
  total: number;
  totalPages: number;
  page: number;
};

/**
 * Same-origin catalog page fetch for PLP infinite scroll / filter refresh.
 *
 * Must run on the server: browser → GraphQL is blocked when the gateway CORS
 * allowlist does not include the tenant storefront origin. Server Actions avoid
 * that entirely. Catalog reads go through the shared remote cache so load-more
 * is not a permanent cache miss (ENG-853).
 */
export async function listCollectionProducts(
  filter: ProductListFilter | undefined,
  page: number,
  perPage: number,
): Promise<CollectionPageResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePerPage =
    Number.isFinite(perPage) && perPage > 0
      ? Math.min(Math.floor(perPage), 100)
      : 24;

  const result = await getCachedCatalogPage(
    filter,
    safePage,
    safePerPage,
    scopeFromFilter(filter),
  );

  return {
    products: result.products as ProductSummaryFieldsFragment[],
    total: result.total,
    totalPages: result.totalPages,
    page: result.page,
  };
}

export type SearchPageResult = CollectionPageResult & {
  /**
   * The search term's matched product IDs (at most 500, before any facet
   * filter), for `/api/search-filters`. `null` when the list was not an Atlas
   * search, so no ID scope exists; `[]` when the term matched nothing.
   */
  matchedProductIds: number[] | null;
};

/**
 * {@link listCollectionProducts} for the search page's FIRST fetch of a term,
 * which also needs the term's matched IDs to scope the filter options. Reads
 * the same page through the SDK's `listWithMatchedIds` document.
 *
 * Falls back to the plain read on any error, reporting `null` IDs: the field
 * is newer than the grid, and a gateway that predates it rejects the whole
 * document, which must cost the shopper their scoped filters, never their
 * results.
 */
export async function listSearchProducts(
  filter: ProductListFilter | undefined,
  page: number,
  perPage: number,
): Promise<SearchPageResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePerPage =
    Number.isFinite(perPage) && perPage > 0
      ? Math.min(Math.floor(perPage), 100)
      : 24;
  try {
    const result = await getCachedCatalogPage(
      filter,
      safePage,
      safePerPage,
      scopeFromFilter(filter),
      { withMatchedIds: true },
    );
    return {
      products: result.products as ProductSummaryFieldsFragment[],
      total: result.total,
      totalPages: result.totalPages,
      page: result.page,
      matchedProductIds: result.matchedProductIds ?? null,
    };
  } catch {
    const plain = await listCollectionProducts(filter, page, perPage);
    return { ...plain, matchedProductIds: null };
  }
}

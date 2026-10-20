import type { ProductFilters } from "@headkit/sdk";

/**
 * Where the filter bar's options come from, and whether it shows them.
 *
 * - `static`  — the options the route rendered with (`productFilter` prop).
 *               Every listing route, bare `/search`, and a search Atlas did not
 *               serve (no `matchedProductIds`, so no ID scope exists — the
 *               store-wide options are then the only answer there is, and
 *               they are the FIRST and only thing shown, never replaced).
 * - `loading` — a search whose scoped options are on their way. The bar shows
 *               skeleton pills the size of the real buttons; Sort stays live.
 * - `ready`   — the options counted over the search's matched products.
 * - `hidden`  — no facet buttons: the scoped read failed or ran past
 *               {@link SEARCH_FACETS_TIMEOUT_MS}, or the term matched nothing.
 *               Products and Sort are untouched.
 *
 * A search goes `loading` → `ready` | `hidden` once per term and never back:
 * the store-wide options are never shown first and then swapped.
 */
export type SearchFacetsState =
  | { status: "static" }
  | { status: "loading" }
  | { status: "ready"; filters: ProductFilters }
  | { status: "hidden" };

export type FacetStatus = SearchFacetsState["status"];

/**
 * Longest the page waits for scoped options before hiding the filter buttons.
 * A cold WordPress aggregation over a search's matches measured 2-5 s, so this
 * lets most cold reads land while keeping a slow one from leaving skeletons up.
 */
export const SEARCH_FACETS_TIMEOUT_MS = 5000;

/**
 * Read the scoped options for one search from `/api/search-filters`. Rejects
 * on a non-2xx, a network error, or `signal` aborting (the timeout).
 */
export async function fetchSearchFacets(
  productIds: number[],
  signal: AbortSignal,
): Promise<ProductFilters> {
  const response = await fetch("/api/search-filters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productIds }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`search filters: HTTP ${response.status}`);
  }
  return (await response.json()) as ProductFilters;
}

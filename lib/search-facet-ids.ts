/**
 * Most product IDs one search-facet read may carry. Commerce caps a search's
 * `matchedProductIds` at the same number, and both commerce and the theme
 * refuse more, so a list this long only ever arrives from a client that did
 * not come from the grid.
 */
export const MAX_SEARCH_FACET_IDS = 500;

/**
 * The `productIds` of one `/api/search-filters` request, de-duplicated and
 * sorted (so two orderings of one match set share a cache entry), or `null`
 * when the value is not 1-500 positive integers.
 *
 * An empty list is refused here rather than forwarded: a search that matched
 * nothing has no filters to show, and the page never asks.
 */
export function parseSearchFacetIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_SEARCH_FACET_IDS) return null;
  const ids = new Set<number>();
  for (const id of value) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
      return null;
    }
    ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

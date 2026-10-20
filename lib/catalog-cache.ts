import { createHash } from "node:crypto";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import type { BrandSummary, ProductListFilter } from "@headkit/sdk";
import { TAG } from "@/lib/cache-tags";
import { headkit, headkitNoRetry } from "@/lib/sdk";
import { normalizeFilterKey } from "@/components/headkit-ui/collection/utils";

/**
 * Comma-free, order-independent cache tag for a normalized filter key.
 *
 * `normalizeFilterKey` returns `JSON.stringify` output, and Next splits
 * `cacheTag()` values on commas when it serializes them into the
 * `x-next-cache-tags` header — so `catalog:{"a":1,"b":2}` arrived at the CDN as
 * several bogus fragments instead of one tag, and the entry was keyed by none
 * of them.
 *
 * Hashed rather than joined as sorted `k=v` pairs: `attributes` is an unbounded
 * array (one entry per selected facet group/value), so a joined string has no
 * fixed upper bound and can exceed Next's 256-char tag limit
 * (`NEXT_CACHE_TAG_MAX_LENGTH`) on a heavily-faceted filter; a hash is
 * fixed-length regardless of filter shape. `normalizeFilterKey` already sorts
 * object keys, so hashing its output is automatically order-independent.
 *
 * Opaqueness in logs and headers is an accepted trade: this tag is never fired
 * by name — only `TAG.*` contract tags pass `isKnownTag` and reach a purge (see
 * `lib/cache-tags.ts`) — so the readability of the string itself has no
 * operational value.
 */
export function catalogFilterTag(filterKey: string): string {
  const hash = createHash("sha256")
    .update(filterKey)
    .digest("hex")
    .slice(0, 16);
  return `catalog:${hash}`;
}

export type CatalogScope =
  | { kind: "shop" }
  | { kind: "category"; slug: string }
  | { kind: "brand"; slug: string }
  | { kind: "route"; route: "sale" | "new" | "featured" };

/**
 * Durable remote catalog page — shared by PLP RSC pages and Server Actions so
 * load-more / filter refresh hits the same cache as the initial grid (ENG-853).
 *
 * `withMatchedIds` reads the page through `listWithMatchedIds`, which also
 * selects `matchedProductIds` (the search term's matched product IDs, for the
 * search page's scoped filter options). It is a separate SDK document because
 * an older gateway rejects the field, so only the search page's first fetch
 * for a term asks for it; the flag is an argument, so it is its own cache
 * entry and every existing caller's entry is unchanged.
 */
export async function getCachedCatalogPage(
  filter: ProductListFilter | undefined,
  page: number,
  perPage: number,
  scope: CatalogScope,
  opts?: { withMatchedIds?: boolean },
) {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");

  const filterKey = normalizeFilterKey(filter ?? {});
  const filterTag = catalogFilterTag(filterKey);
  switch (scope.kind) {
    case "shop":
      cacheTag(TAG.route("shop"), TAG.products, TAG.catalog, filterTag);
      break;
    case "category":
      cacheTag(
        TAG.catalogCat(scope.slug),
        TAG.products,
        TAG.catalog,
        filterTag,
      );
      break;
    case "brand":
      cacheTag(TAG.brand(scope.slug), TAG.products, TAG.catalog, filterTag);
      break;
    case "route":
      cacheTag(TAG.route(scope.route), TAG.products, TAG.catalog, filterTag);
      break;
  }

  return opts?.withMatchedIds
    ? headkit.collections.listWithMatchedIds(filter, page, perPage)
    : headkit.collections.list(filter, page, perPage);
}

/**
 * Scoped facet options for a search page: the aggregation over the product
 * IDs its search matched (`productFilters(productIds:)`). Callers pass the IDs
 * SORTED so two orderings of one match set share an entry.
 *
 * Same cache life and tags as the search grid it sits beside, so a catalogue
 * edit purges the grid and its options together and they cannot disagree for
 * longer than the grid itself is stale. Most search terms are seen once, so
 * most reads miss and pay the WordPress aggregation (2-5 s, scaling with the
 * list length); a repeated popular term is served from here.
 *
 * Read through `headkitNoRetry`, which never retries: the shopper's
 * page gives up after 5 s, and the SDK's default backoff (six retries, ~30 s)
 * would keep asking a failing WordPress seven times after nobody is waiting —
 * measured locally against a forced 500: 32 s to the 502, one read per retry.
 */
export async function getCachedSearchFacets(productIds: number[]) {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  cacheTag(TAG.route("shop"), TAG.products, TAG.catalog);
  return headkitNoRetry.collections.getFilters(
    undefined,
    undefined,
    undefined,
    productIds,
  );
}

/** Shared brand facet list for PLP filter drawers. */
export async function getCachedFilterBrands(): Promise<BrandSummary[]> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  cacheTag(TAG.brands, "catalog:filters");
  const result = await headkit.brands.list({
    perPage: 100,
    orderby: "name",
    order: "asc",
  });
  return result.brands;
}

/** Infer catalog scope from a list filter (used by Server Actions). */
export function scopeFromFilter(
  filter: ProductListFilter | undefined,
): CatalogScope {
  // ProductListFilter uses singular brand/category (UI may multi-select but
  // buildProductListFilter maps only the first value — see utils.ts).
  if (filter?.brand) {
    return { kind: "brand", slug: filter.brand };
  }
  if (filter?.category) {
    return { kind: "category", slug: filter.category };
  }
  if (filter?.onSale) {
    return { kind: "route", route: "sale" };
  }
  if (filter?.isNew) {
    return { kind: "route", route: "new" };
  }
  if (filter?.featured) {
    return { kind: "route", route: "featured" };
  }
  return { kind: "shop" };
}

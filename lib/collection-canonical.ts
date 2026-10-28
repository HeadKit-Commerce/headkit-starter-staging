import "server-only";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { headkit as sdk } from "@/lib/sdk";
import { collectionPathFromCategory } from "@/components/headkit-ui/collection/utils";
import { TAG } from "@/lib/cache-tags";

/**
 * The collection route's canonical decision, and the cached read it is made
 * from, in ONE module so more than one caller can make it identically.
 *
 * It lived inside `app/collections/[...slug]/page.tsx` until `proxy.ts` had to
 * make the SAME decision one layer earlier, in order to carry the incoming
 * query string through the 308 (a route's default export cannot read
 * `searchParams` — see "Setting a status code needs THREE conditions" in
 * `AGENTS.md`). Two copies of a redirect rule is the one shape that can
 * actually loop: the proxy sends A → B while the route at B sends B → A. There
 * is no second copy, by construction.
 */

/** Satisfies Cache Components: `generateStaticParams` must not return []. Never a real slug. */
export const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

/**
 * Parse the catch-all slug into category path and optional filter slug.
 * URL formats:
 *   /collections/hoodies                            → no filter
 *   /collections/hoodies/f/color.blue.red_size.l   → filtered
 *   /collections/clothing/hoodies/f/color.red       → nested category + filter
 */
export function parseCollectionSlug(slug: string[]): {
  categorySlug: string;
  filterSlug: string | undefined;
  categoryBasePath: string;
} {
  const fIndex = slug.indexOf("f");
  if (fIndex > 0 && slug[fIndex + 1]) {
    const categorySegments = slug.slice(0, fIndex);
    return {
      categorySlug: categorySegments[categorySegments.length - 1]!,
      filterSlug: slug[fIndex + 1]!,
      categoryBasePath: `/collections/${categorySegments.join("/")}`,
    };
  }
  return {
    categorySlug: slug[slug.length - 1]!,
    filterSlug: undefined,
    categoryBasePath: `/collections/${slug.join("/")}`,
  };
}

/**
 * Params-keyed category read for the Instant Navigation shell.
 * Cached (`'use cache'`) so runtime prefetch (`prefetch={true}` on category
 * links) can resolve header/breadcrumb/children before click.
 *
 * `Page` awaits it once to decide the canonical redirect, which does cost that
 * route its App Shell (see the note there). Being `'use cache'` is what keeps
 * that affordable: `CollectionRoute` awaits the same entry, so the shell and
 * the body share one read, and prerendered params resolve it at build.
 * `searchParams` is the read that must never be awaited ANYWHERE on that route
 * — it opts the whole segment dynamic, and since #517 nothing there awaits it
 * (see `CollectionProductsShell`).
 *
 * `/api/canonical-redirect` awaits this SAME function, so the proxy's redirect
 * decision and the route's read one cache entry rather than two: a flat URL
 * carrying a query costs no catalogue read the route was not already going to
 * make.
 */
export async function getCategoryData(categorySlug: string) {
  "use cache";
  // 2-week stale / 1h revalidate — safety net if webhooks fail.
  //
  // FINITE IN BOTH CACHE PROFILES, deliberately, and for the reason the move
  // out of the route file already named: this entry is a status-code source —
  // `canonicalCollectionRedirect`'s 308 target AND the route's 404 gate.
  // Serving a stale price is recoverable; pinning a wrong 404 or 308 until the
  // next deploy is not, so the aggressive profile raises only `revalidate`
  // (1h -> 24h, the `days` profile's value) and never reaches `max`. `stale`
  // and `expire` stay at 14 days in both, since naming a profile here would
  // SHORTEN them. See `lib/cache-profile.ts`.
  cacheLifeForProfile(
    {
      stale: 60 * 60 * 24 * 14,
      revalidate: 60 * 60,
      expire: 60 * 60 * 24 * 14,
    },
    {
      stale: 60 * 60 * 24 * 14,
      revalidate: 60 * 60 * 24,
      expire: 60 * 60 * 24 * 14,
    },
  );
  // headkit:collections is sent by WordPress on a product-CATEGORY term edit
  // (created_term / edited_term / delete_term on product_cat) and by nothing
  // else — measured, not assumed: no product event reaches it
  // (`lib/wp-revalidation-events.test.ts`, docs/cache-revalidation-contract.md).
  // headkit:collection:${categorySlug} is sent on category-specific changes and
  // on a listing event for any product in that category.
  cacheTag(TAG.collection(categorySlug), TAG.collections);

  const [category, productFilter] = await Promise.all([
    sdk.collections.getCategory(categorySlug),
    // The SWATCH-CAPABLE facet read, not `getFilters`: this entry is what
    // `/collections/[...slug]` and `/shop/[...slug]`'s category branch hand to
    // the filter bar, so `swatchColor` / `swatchColor2` have to be in the
    // selection here or they arrive `undefined` on every option while still
    // type-checking. Same aggregation, two more scalars per option: no extra
    // origin read and no change to this entry's cache identity. It REQUIRES a
    // gateway carrying both fields — see `lib/catalog-filters.ts`.
    sdk.collections.getFiltersWithSwatches(categorySlug),
  ]);

  return { category, productFilter };
}

/**
 * The path this collection URL must 308 to, or null when it is already
 * canonical.
 *
 * Null — never a redirect — for the build-time placeholder, an unresolvable
 * slug, and a category the API cannot supply, so an outage can never turn into
 * a redirect. Null also when the canonical equals the requested path, which is
 * what makes a root category (no ancestors, canonical `/collections/{slug}`)
 * serve rather than redirect to itself.
 *
 * The category's OWN ancestry (`collectionPathFromCategory`) is the source,
 * never the slug→path index in `lib/collection-path.ts`: the index is built
 * from the un-paginated `hide_empty=true` category list, which promotes a child
 * whose parent fell outside that page to a ROOT
 * (`260822-commerce-category-list-orphan-promotion`). An index-derived target
 * could therefore disagree with the route's own and bounce a request between
 * the two shapes.
 */
export async function canonicalCollectionRedirect(
  slug: string[],
): Promise<string | null> {
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return null;
  const { categorySlug, filterSlug, categoryBasePath } =
    parseCollectionSlug(slug);
  if (!categorySlug) return null;

  const { category } = await getCategoryData(categorySlug);
  if (!category) return null;

  const canonicalBasePath = collectionPathFromCategory(category);
  if (canonicalBasePath === categoryBasePath) return null;
  return filterSlug
    ? `${canonicalBasePath}/f/${filterSlug}`
    : canonicalBasePath;
}

/**
 * Which full-page skeleton, if any, does an in-app href want while the
 * navigation to it is still pending?
 *
 * Asked once per link by `InstantLink`, from the handler that starts the
 * navigation. The answer selects a body in
 * `components/headkit-ui/skeletons/navigation-skeleton.tsx`; `null` means the
 * link navigates with no page skeleton. The clicked link itself does not pulse.
 *
 * THIS IS THE ONE PLACE A ROUTE IS ADDED. {@link ROUTE_SKELETONS} is a table of
 * `(predicate → kind)` read in order, and {@link NO_SKELETON_PREFIXES} is the
 * set of first segments that opt out of the catch-all `"page"` reading at the
 * bottom of it. A new route family is one row or one entry, never a second
 * predicate exported next to this one.
 *
 * THE SHAPES ARE THE APP'S OWN URL BUILDERS, not a second rule.
 *  - `"product"` recognises exactly what `productPath` (`lib/canonical-path.ts`)
 *    emits: `/{SHOP_PATH_PREFIX}/{segments…}` when the permalink carries shop
 *    ancestry, and the flat `/products/{slug}` when it does not, each optionally
 *    with one more colourway segment. Written against `SHOP_PATH_PREFIX` and
 *    `shopSegmentsFromPath` (`app/shop/shop-slug.ts`).
 *  - `"collection"` recognises what `collectionPathFromCategory`
 *    (`components/headkit-ui/collection/utils.ts`) and
 *    `collectionPathFromSegments` (`lib/canonical-path.ts`) emit, through the
 *    `COLLECTION_PATH_PREFIX` (`lib/route-prefixes.ts`) both of them build from.
 *
 * WHAT IS NOT DERIVABLE FROM A URL, and is therefore threaded instead. A post
 * article lives under the store's WordPress Posts-page slug (`/news` by default,
 * anything at all on a given store — `lib/posts-path.ts`), which is per-store
 * SERVER data no client predicate can read. So `"post"` is never returned from
 * here: the two post cards pass `skeleton="post"` to `InstantLink` explicitly,
 * from where they already resolve that slug. A post link emitted from somewhere
 * else — a WordPress menu entry, an anchor inside CMS prose — falls through to
 * `"page"`, a title-and-prose skeleton over an article. Wrong in proportion, not
 * in kind, and cheap.
 *
 * WHERE ELSE IT IS IMPRECISE, and why that is the accepted trade.
 *  - `/shop/[...slug]` serves category archives as well as products and the two
 *    are NOT separable by URL shape — telling them apart needs the category
 *    tree, a server read. No storefront surface emits `/shop/{category}` today:
 *    every in-app category link is a `/collections/…` path.
 *  - The `"page"` reading at the bottom of the table is a COMPLEMENT: an in-app
 *    path that is not one of the shapes above and whose first segment is not in
 *    {@link NO_SKELETON_PREFIXES}. It is right for the CMS catch-all
 *    (`app/[...slug]`) and the prose routes built around it (`/faq`, `/contact`,
 *    `/wholesale`), and it will claim any NEW route whose first segment nobody
 *    adds to the set.
 *
 * In every one of those cases the cost is a moment of the wrong grey boxes,
 * never a wrong status code and never a wrong page: nothing here is visible to
 * the server. A direct load makes no click, so nothing requests a skeleton and
 * none of this is ever reached — which is the whole reason the feature rides a
 * client gesture rather than a `loading.tsx`. See `AGENTS.md`, "Setting a status
 * code needs THREE conditions".
 *
 * Pure, and free of `next`/SDK imports: it runs in the client bundle of every
 * link on the page.
 */

import { shopSegmentsFromPath, SHOP_PATH_PREFIX } from "@/app/shop/shop-slug";
import { COLLECTION_PATH_PREFIX } from "@/lib/route-prefixes";

/** Which skeleton body a pending navigation should raise. */
export type NavigationSkeletonKind = "product" | "collection" | "post" | "page";

/** The flat product base, the losing shape that 308s onto `/shop/…`. */
const FLAT_PRODUCT_PREFIX = "products";

/**
 * First segments that get NO skeleton at all.
 *
 * Two different reasons, deliberately in one set because the outcome is the same
 * and a caller never needs to know which applies:
 *
 *  - Routes whose page is an interactive form or an app surface rather than
 *    content — a skeleton of prose lines over them would be a lie. These are
 *    also the routes a shopper reaches warm, so the delay would swallow them
 *    anyway.
 *  - The blog base's DEFAULT segment. `/news` is the internal route; a store
 *    serving its posts under another slug redirects onto it, so a link naming it
 *    directly is a redirect nothing emits, and any other store's Posts slug is
 *    unknowable here — see the module header.
 */
const NO_SKELETON_PREFIXES: ReadonlySet<string> = new Set([
  "account",
  "api",
  "checkout",
  "draft-product",
  "news",
  "products_preview",
  "quote",
  "search",
]);

/**
 * Listing routes that render the same header + filter bar + product grid the
 * collection skeleton draws, but do not live under `/collections`.
 *
 * `/brand/{slug}` is `CollectionPageSkeleton variant="brand"`'s own subject; the
 * rest are catalogue landings — `/shop` is the index of root categories, and
 * `/sale`, `/new` and `/featured` are the platform's own. Adding them here is
 * what stops the `"page"` complement below claiming them and drawing prose lines
 * over a product grid. A deeper `/shop/…` never reaches this test: the product
 * row above it claims every one of those.
 */
const COLLECTION_LIKE_PREFIXES: ReadonlySet<string> = new Set([
  "brand",
  "featured",
  "new",
  "sale",
  SHOP_PATH_PREFIX,
]);

/**
 * Does this href land on a product-detail page?
 *
 * Exported under its own name because it is the PDP shape's authority, and a
 * caller that needs only that question should not have to compare a kind.
 */
export function isProductDetailPath(href: string): boolean {
  const path = inAppPath(href);
  if (path === null) return false;
  return matchesProduct(pathSegments(path), path);
}

/** Site-relative path with query and fragment stripped, or null if not one. */
function inAppPath(href: string): string | null {
  // `InstantLink` has already normalised CMS absolutes and refused off-origin
  // hrefs by the time it asks, so a leading `/` is the whole test.
  if (!href.startsWith("/")) return null;
  return href.split("#")[0]!.split("?")[0]!;
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function matchesProduct(segments: string[], path: string): boolean {
  // `/shop` itself is the catalogue index, and `shopSegmentsFromPath` reports it
  // as no segments — so the index is excluded without a second test.
  if (shopSegmentsFromPath(path).length > 0) return true;
  return segments[0] === FLAT_PRODUCT_PREFIX && segments.length >= 2;
}

function matchesCollection(segments: string[]): boolean {
  const [first] = segments;
  if (first === undefined) return false;
  // `/collections` alone is not a route; a category needs at least one segment
  // under the prefix. `/brand` alone is likewise the index, not a brand PLP.
  if (first === COLLECTION_PATH_PREFIX) return segments.length >= 2;
  if (!COLLECTION_LIKE_PREFIXES.has(first)) return false;
  return first === "brand" ? segments.length >= 2 : true;
}

function matchesPage(segments: string[]): boolean {
  const [first] = segments;
  // The home page is the layout plus a client navigation that never leaves it.
  if (first === undefined) return false;
  if (NO_SKELETON_PREFIXES.has(first)) return false;
  // A filename is an asset route, not a page.
  return !first.includes(".");
}

/**
 * The table. Read in order; the first predicate that matches names the body.
 *
 * `"page"` is last because it is the complement — everything the rows above did
 * not claim and the opt-out set did not refuse.
 */
const ROUTE_SKELETONS: ReadonlyArray<{
  kind: NavigationSkeletonKind;
  matches: (segments: string[], path: string) => boolean;
}> = [
  { kind: "product", matches: matchesProduct },
  { kind: "collection", matches: (segments) => matchesCollection(segments) },
  { kind: "page", matches: (segments) => matchesPage(segments) },
];

export function navigationSkeletonForHref(
  href: string,
): NavigationSkeletonKind | null {
  const path = inAppPath(href);
  if (path === null) return null;
  const segments = pathSegments(path);
  for (const route of ROUTE_SKELETONS) {
    if (route.matches(segments, path)) return route.kind;
  }
  return null;
}

/** Re-exported so a caller never needs a literal `"shop"` of its own. */
export { SHOP_PATH_PREFIX };

/**
 * Which requests `proxy.ts` resolves a canonical redirect for, and how it
 * builds the target.
 *
 * Pure and dependency-free so it can be asserted without a running app —
 * `lib/canonical-redirect-request.test.ts` is the guard. The DECISION of where
 * a path redirects to is not here; that is the routes' own, reached through
 * `/api/canonical-redirect` (see `lib/canonical-redirect.ts`).
 */

// `lib/route-prefixes.ts` is the one declaration of this segment and is itself
// dependency-free, so importing it keeps this module — and `proxy.ts`, which
// imports it — clear of anything that touches the SDK.
import { COLLECTION_PATH_PREFIX } from "@/lib/route-prefixes";

/** Route families whose flat shape 308s onto a nested canonical. */
const PRODUCT_PREFIX = "/products/";
const COLLECTION_PREFIX = `/${COLLECTION_PATH_PREFIX}/`;

/**
 * True when the proxy should resolve this request's canonical target itself
 * instead of leaving the 308 to the route.
 *
 * The gate is deliberately narrow, because each candidate costs one subrequest:
 *
 * - **GET and HEAD only.** A Server Action POSTs to the page's own URL, which
 *   on a listing route routinely carries a query string; those must never pay a
 *   lookup.
 * - **`/products/...` always qualifies, query or not**, because the canonical
 *   for a product is under `/shop/...` — so a flat product URL is non-canonical
 *   unless the product has no category ancestry at all. The route's own
 *   `permanentRedirect` cannot be relied on for the path-only case: since #622
 *   a flat URL whose product has a `/shop` permalink is not prerendered, and on
 *   a WooCommerce build the route has no request-time read left (#638 gated the
 *   Shopify preview marker), so Next serves an unbuilt slug from the route's
 *   PPR fallback shell. The redirect then throws AFTER that shell committed a
 *   200 — a client-side redirect — and the revalidated entry is cached as a 308
 *   with NO `Location` header. `ensureStatic` would make the route render
 *   blocking (it does for collections) but a Shopify build awaits
 *   `searchParams` on this route, so it cannot take that lock.
 *   `e2e/canonical-url-308.spec.ts` is what observed it.
 * - **Anywhere else, a query string is required.** With no query there is
 *   nothing to preserve, so the route's own `permanentRedirect` is already
 *   correct and the proxy stays entirely out of the way.
 * - **`/collections/...` only when the CATEGORY part is a single segment.**
 *   That is the shape that actually redirects, and it is the one the WordPress
 *   theme emits: measured on this store, 127 of 127 category menu links arrive
 *   flat. A nested `/collections/parent/child` is canonical for every category
 *   the tree agrees about, so excluding it keeps ordinary browsing
 *   (`?page=`, `?sort=`, `?q=`) free of subrequests. The cost of the exclusion
 *   is stated rather than hidden: a nested path whose parent is WRONG still
 *   308s from the route with its query dropped, exactly as it does today.
 *
 * One more class never reaches here at all, and it is the proxy's matcher
 * rather than this rule: `proxy.ts` excludes any path containing a dot, so an
 * encoded facet URL (`/collections/locks/f/colour.black?gclid=…`) keeps today's
 * behaviour. Widening the matcher would change which requests the maintenance
 * gate and the `X-Robots-Tag` header see, which is a bigger decision than this.
 */
export function isCanonicalRedirectCandidate(
  method: string,
  pathname: string,
  search: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.startsWith(PRODUCT_PREFIX)) return true;
  if (!search || search === "?") return false;
  if (!pathname.startsWith(COLLECTION_PREFIX)) return false;
  return categorySegmentCount(pathname.slice(COLLECTION_PREFIX.length)) === 1;
}

/**
 * How many segments of a `/collections/...` tail name the CATEGORY, i.e. the
 * part before the `/f/<filter>` suffix. Mirrors `parseCollectionSlug`'s split;
 * it cannot import it, because that module reaches the SDK and this one runs in
 * the proxy.
 */
function categorySegmentCount(tail: string): number {
  const segments = tail.split("/").filter(Boolean);
  const fIndex = segments.indexOf("f");
  return fIndex > 0 ? fIndex : segments.length;
}

/**
 * The redirect URL: the canonical PATH, the incoming QUERY STRING unchanged.
 *
 * Preserving the query is the entire point (issue #74) — a 308 built from the
 * path alone drops `gclid`, `utm_*` and Klaviyo's `_kx` before anything on the
 * page can read them, and the visitor still ends on a 200, so nothing reports
 * it. Nothing else about the redirect changes: same target path, same 308, same
 * set of URLs that redirect at all.
 */
export function canonicalRedirectUrl(current: URL, target: string): URL {
  const url = new URL(current.toString());
  url.pathname = target;
  return url;
}

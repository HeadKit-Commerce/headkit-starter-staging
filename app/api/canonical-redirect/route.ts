import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectForPath } from "@/lib/canonical-redirect";

/**
 * The canonical 308 target for a storefront path, for `proxy.ts`.
 *
 * WHY THE PROXY CANNOT JUST CALL THE FUNCTION. `canonicalRedirectForPath`
 * resolves through `"use cache"` reads, which middleware cannot run; the proxy
 * already reaches its other per-store value the same way
 * (`/api/posts-base-path`). This endpoint is the difference between the two:
 * that one is fetched on EVERY page request, which is why it carries two values
 * rather than having a second endpoint. This one is fetched only for a flat
 * product URL, or for a flat collection URL carrying a query string — the case
 * where a 308 would otherwise throw a campaign's `gclid`, `utm_*` or `_kx` away
 * (issue #74). Flat product URLs come with or without a query, because the
 * product route cannot set a real 308 for a slug it did not prerender (see
 * `isCanonicalRedirectCandidate`); every shopper link already names the nested
 * URL, so that traffic is legacy and crawler links that redirect anyway.
 *
 * WHAT IT COSTS WHEN IT IS HIT. Nothing at the WordPress origin that the
 * request was not already going to pay. Both decision functions resolve through
 * the SAME `"use cache"` entries the routes themselves await —
 * `getCachedProduct` (`cacheLife("max")`) and `getCategoryData` — so a warm
 * catalogue answers from cache, and a cold one pays the single read the route
 * would have paid a moment later. That matters here specifically: this store's
 * origin is rate-limited to ~1.8 req/s and a runaway read pattern has caused an
 * outage before.
 *
 * NOT AUTHENTICATED, and it does not need to be. It reveals only which path a
 * URL redirects to — something any client learns by issuing the request — and
 * the reads it can reach are exactly the two the public `/products/...` and
 * `/collections/...` routes already perform for an arbitrary slug. A path
 * outside those two families resolves to `null` without reading anything.
 *
 * Deliberately NOT cached at the HTTP layer: the caching that matters is the
 * `"use cache"` entries underneath, and a second lifetime on top would be a
 * second thing that can pin a wrong redirect.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return NextResponse.json(
      { error: "path must be a site-relative pathname" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const redirect = await canonicalRedirectForPath(path);
  return NextResponse.json(
    { redirect },
    { headers: { "Cache-Control": "no-store" } },
  );
}

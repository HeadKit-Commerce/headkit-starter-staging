import type { ClientSDK, ProductFilters } from "@headkit/sdk";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile, type CacheLifeSpec } from "@/lib/cache-profile";
import { errorFields, logger } from "@/lib/logger";
import { headkit, headkitRetry } from "@/lib/sdk";

/**
 * The lifetime the facet entry takes on the `aggressive` cache profile: 14-day
 * `stale`/`expire` with a 24-hour `revalidate` backstop, which is
 * `getCategoryData`'s lifetime (`lib/collection-canonical.ts`).
 *
 * Why it is finite where every other `aggressive` read goes to `max`: the
 * entry's only tag, `"catalog:filters"`, is not in the `headkit:` vocabulary,
 * so `isKnownTag` (`lib/cache-tags.ts`) drops it and `/api/revalidate` never
 * passes it to `revalidateTag`. Nothing can purge this entry — a `max` lifetime
 * would make it immutable until the next deploy. Nor is the enclosing route's
 * purge a refresh path: the route re-renders and reads the durable inner entry
 * again. And this payload has no content event of its own — what changes it is
 * a theme release (the same term meta, newly emitted, such as swatch colours),
 * which fires no webhook. So the lifetime is the ONLY refresh path it has.
 *
 * A change is reflected once the 24-hour window turns over, on the re-render
 * after the one that trips it (the backstop is stale-while-revalidate). The
 * cost is one un-scoped `getFilters` per day against the origin.
 *
 * The `conservative` profile keeps `"hours"`, which is already finite.
 */
export const CATALOG_FACET_CACHE_LIFE: CacheLifeSpec = {
  stale: 60 * 60 * 24 * 14,
  revalidate: 60 * 60 * 24,
  expire: 60 * 60 * 24 * 14,
};

/** Total attempts, including the first. One retry. */
const MAX_ATTEMPTS = 2;

/**
 * Pause between attempts. Small against a build, but it comes out of the same
 * cache-fill budget as both reads (see `lib/prerender-timeout.ts`), so it is
 * not raised casually.
 */
const RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The store-wide facet read with ONE bounded retry.
 *
 * `sdk.collections.getFilters()` with no `mainCategory` is a WordPress
 * aggregation over the whole catalogue — the most expensive read the storefront
 * makes — and six routes await the one cached entry it fills, so a single
 * failure fails every prerender waiting on that fill and the build with them.
 * The SDK transport already retries 429s, 5xx statuses and connection errors
 * with backoff, but a read that runs past commerce's origin response-header
 * timeout surfaces as a GraphQL error body the transport does not classify as
 * transient, so nothing between here and WordPress tries again. This is that
 * second toss. It goes through `headkitRetry`, a request of its own: Next's
 * fetch cache would otherwise replay the stored failure to an identical retry
 * (`retryGatewayUrl` in `lib/sdk.ts` has the measurement).
 *
 * One extra read on a path that has ALREADY failed is the whole cost: the
 * success path is the same single call it always was, because the retry is
 * reached only from a `catch`. Commerce serialises outbound origin reads
 * through a per-origin token bucket, so a retry cannot burst the origin.
 *
 * It must NOT degrade to empty facets once the retry is spent. The caller wraps
 * this in a `"use cache: remote"` scope, so a facet-less result would be
 * CACHED and the filter sidebar would simply be gone. Throwing after the retry
 * is the behaviour the caller had before this existed: a loud failure that
 * recovers on the next request, rather than a quiet one that sticks.
 *
 * @param options.read - seam for tests only.
 * @param options.delay - seam for tests only.
 */
export async function fetchCatalogFilters(options?: {
  read?: (client: ClientSDK) => Promise<ProductFilters>;
  delay?: (ms: number) => Promise<void>;
}): Promise<ProductFilters> {
  const read =
    options?.read ??
    ((client: ClientSDK): Promise<ProductFilters> =>
      client.collections.getFilters());
  const delay = options?.delay ?? sleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await read(attempt === 1 ? headkit : headkitRetry);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        logger.info("catalog_filters_retry", {
          attempt,
          of: MAX_ATTEMPTS,
          delayMs: RETRY_DELAY_MS,
          ...errorFields(error),
        });
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  logger.error("catalog_filters_failed", {
    attempts: MAX_ATTEMPTS,
    ...errorFields(lastError),
  });
  throw lastError;
}

/**
 * Aggregated facet options (categories/attributes/price bounds), store-wide
 * and un-scoped. `"use cache: remote"`, not plain `"use cache"`: the plain
 * directive is a per-instance in-memory LRU that does not persist across
 * requests in serverless.
 *
 * ONE shared entry for every landing route that needs it (`/shop`, `/sale`,
 * `/new`, `/featured`, `/brand/[...slug]`, `/search`) — the call takes no
 * arguments, so a route-local copy of this function is a SEPARATE cache
 * entry keyed by its own module, not a separate result. Six local copies
 * meant up to six cold fills of a 13-16s WordPress aggregation per deploy;
 * `/shop` is prerendered at build, so importing this single function lets
 * that build fill the one entry and every other route hit it warm at
 * runtime. See `data/260925-bs-enable-nav-skeleton/report.md` §5.
 *
 * The lifetime is `"hours"` by default and {@link CATALOG_FACET_CACHE_LIFE} on
 * the `aggressive` profile — never `max`, because nothing can purge this entry.
 */
export async function getCatalogFilters(): Promise<ProductFilters> {
  "use cache: remote";
  cacheLifeForProfile("hours", CATALOG_FACET_CACHE_LIFE);
  cacheTag("catalog:filters");
  return fetchCatalogFilters();
}

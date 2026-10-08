import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { headkit } from "@/lib/sdk";
import {
  BULK_PREFETCH_DEFAULT_CONCURRENCY,
  BULK_PREFETCH_DIRNAME,
  createBulkPrefetch,
} from "@/lib/bulk-product-prefetch";

export type ProductPageLoadOptions = {
  /** Shopify Admin preview_key — bypasses cache and loads draft products. */
  shopifyPreviewKey?: string | undefined;
};

/**
 * Shared PDP product read — ONE cache entry keyed by product slug, read by both
 * PDP routes, so a single `revalidateTag` invalidates every storefront PDP
 * (ENG-853).
 *
 * The redirect now runs the other way: since the 2026-08-22 canonical decision
 * the nested `/shop/{cat…}/{slug}` route is the winner and the flat `/products`
 * route 308s onto it. Sharing this entry is what keeps the two consistent while
 * both still serve — the flat route reads it to decide whether to redirect, and
 * the nested route reads it to render.
 *
 * `"use cache: remote"` so one tag purge is visible on every instance. The
 * lifetime is unchanged: finite `days` on the default profile, `max` only
 * when the store opts into the aggressive profile.
 */
export async function getCachedProduct(slug: string) {
  "use cache: remote";
  // Finite `days` backstop (was `max`): a missed product webhook self-heals in
  // ~1 day (threat T-09.5-12) instead of sticking until redeploy.
  cacheLifeForProfile("days", "max");
  cacheTag(TAG.product(slug), TAG.products);
  // Build-time only: a product the bulk prefetch already holds is returned
  // from the per-build store instead of costing its own origin request. Off
  // the build phase, or on a store whose gate is closed, `get` resolves null
  // and this is exactly the per-slug read it always was.
  const prefetched = await bulkPrefetch.get(slug);
  if (prefetched) return prefetched;
  return headkit.products.get(slug);
}

/**
 * PDP availability read, separate from `getCachedProduct`.
 *
 * `expire` is 300 seconds. That is the shortest lifetime Next.js 16.4 still
 * includes in a prerender, so this line stays in the stored document and
 * `ensureStatic = "navigation"` still passes. `stale` is the same window.
 * `revalidate` is 60 seconds: a busy product serves the stored line and
 * refreshes it in the background. A quiet product is never more than five
 * minutes behind. Anything shorter is a dynamic hole.
 *
 * `"use cache: remote"` shares that entry across serverless instances. The
 * product tags let a product purge refresh it too. During `next build` the
 * bulk prefetch answers, so the prerender does not pay a second origin
 * request per product. Off the build, this calls `products.get` itself and
 * does not read `getCachedProduct` — nesting it there would hold the number
 * for the catalogue lifetime.
 *
 * Quote checkout never calls this. `ProductStock` returns first, so a quote
 * store's product page stays on the catalogue cache.
 */
export async function getProductStock(slug: string) {
  "use cache: remote";
  cacheLife({
    stale: 300,
    revalidate: 60,
    expire: 300,
  });
  cacheTag(TAG.product(slug), TAG.products);
  const prefetched = await bulkPrefetch.get(slug);
  if (prefetched) return prefetched;
  return headkit.products.get(slug);
}

/**
 * The per-process bulk prefetch handle (see `lib/bulk-product-prefetch.ts`).
 * Inert unless `NEXT_PHASE` says this process is a `next build`, so runtime
 * and revalidation reads keep their single-product path and cache semantics.
 */
const bulkPrefetch = createBulkPrefetch({
  dir: path.join(process.cwd(), ".next", BULK_PREFETCH_DIRNAME),
  sdk: {
    bulkStatus: () => headkit.products.bulkStatus(),
    bulkPage: (page, perPage) => headkit.products.bulkPage(page, perPage),
  },
  isBuild: env.NEXT_PHASE === "phase-production-build",
  disabled: env.HEADKIT_BULK_PREFETCH === "0",
  concurrency: env.HEADKIT_BULK_PREFETCH_CONCURRENCY
    ? Number(env.HEADKIT_BULK_PREFETCH_CONCURRENCY)
    : BULK_PREFETCH_DEFAULT_CONCURRENCY,
  log: (message) => logger.info("bulk_prefetch", { message }),
});

/**
 * Product read for PDP routes. Uses the shared cache for normal traffic; Shopify
 * Admin preview passes preview_key and must not cache draft/unpublished reads.
 */
export async function getProductForPage(
  slug: string,
  options?: ProductPageLoadOptions,
) {
  if (options?.shopifyPreviewKey) {
    return headkit
      .withShopifyPreviewKey(options.shopifyPreviewKey)
      .products.get(slug);
  }
  return getCachedProduct(slug);
}

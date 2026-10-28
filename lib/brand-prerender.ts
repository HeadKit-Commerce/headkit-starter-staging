/**
 * Build-time brand header, resolved from the brand LIST.
 *
 * `BrandProvider.GetBrand` (`/brands/slug/{slug}`) sends the edge-bypass
 * cookie (`services/commerce/internal/provider/woocommerce/edge_bypass.go`), so
 * every brand prerender is a read on WordPress origin, and the origin
 * rate-limits per source IP. The SDK then retries a 429 six times before it
 * throws. On a large brand catalogue that retry tax, on top of the rest of the
 * build, passes Vercel's 45-minute ceiling and fails the export
 * (`unexpected status 429` at `getBrandShell`; measured on the Bike Society
 * fork, tigerheart-studios/bike-society-v2-staging #172).
 *
 * The list route does not send that cookie, so it stays on the CDN, and it
 * already carries every field the brand HEADER and the PDP brand logo render
 * (name, description, thumbnail, image). Yoast `seo` is detail-only: the page
 * asks for it again at runtime, when `NEXT_PHASE` is unset, and a tag
 * revalidation re-enters the same cached function and upgrades the entry.
 *
 * A missing slug in a COMPLETED walk is a genuine miss. A failed or incomplete
 * walk must propagate — never `notFound()`, which would pin a transport failure
 * as a 404 for `cacheLife("days")`.
 *
 * Two readers share the one cached walk (`lib/brand-prerender-index.ts`): the
 * brand route's `getBrandShell` and the PDP's `getCachedProductBrand` — the
 * latter is the same per-brand edge-bypassing read, once per distinct brand the
 * prerendered products carry.
 *
 * The walk itself is `collectAllBrands` (`lib/brand-list.ts`), the one that
 * `generateStaticParams`, the sitemap and the brand index already share, so the
 * terminator rules live in one place.
 */

/**
 * The fields the brand list already carries that a brand header and the PDP
 * brand logo render. `imageSrc` is `""` when the brand has no image.
 */
export interface BrandHeaderSummary {
  slug: string;
  name: string;
  description: string;
  thumbnail: string;
  imageSrc: string;
}

/** First summary with this slug, or null when the completed walk omitted it. */
export function brandHeaderFromSummaries(
  slug: string,
  summaries: readonly BrandHeaderSummary[],
): BrandHeaderSummary | null {
  for (const summary of summaries) {
    if (summary.slug === slug) return summary;
  }
  return null;
}

/**
 * True only while `next build` is prerendering. Runtime and tag revalidation
 * must keep the detail read: `seo`, and 404 authority over a brand the list has
 * since dropped.
 */
export function brandPrerenderUsesList(phase: string | undefined): boolean {
  return phase === "phase-production-build";
}

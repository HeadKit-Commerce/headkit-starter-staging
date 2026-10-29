import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SortKeyType } from "@/components/headkit-ui/collection/utils";
import { getBranding } from "@/lib/branding";
import { isQuoteMode, normalizeCheckoutMode } from "@/lib/checkout-mode";
import { env } from "@/lib/env";
import { resolveSiteUrl } from "@/lib/site-url";
import { getStoreCurrency } from "@/lib/utils";

/** What every Markdown mirror needs to know about the store it speaks for. */
export interface MirrorStore {
  /** Absolute origin with no trailing slash — the RUNTIME store domain, never only the baked env. */
  origin: string;
  name: string;
  /** The store's SEO description, or "". */
  description: string;
  /** Whether the store publishes `/sitemap.xml` — `robots.txt` advertises it only then. */
  sitemapEnabled: boolean;
  currency: string;
  /** Quote-mode stores hide prices on the HTML page; the mirror must hide them too. */
  hidePrices: boolean;
  /** The sort the HTML collection route reads page 1 with, so both share one cache entry. */
  defaultCollectionSort: SortKeyType;
}

/**
 * The store context for a mirror, or `null` when the store declares no usable
 * origin or its branding cannot be read — the caller answers 503 rather than
 * write a relative `canonical_url`.
 *
 * `getBranding()` is `"use cache: remote"` and the root layout already awaits
 * it on every request, so this is a cache hit, not an extra round trip.
 */
export async function readMirrorStore(): Promise<MirrorStore | null> {
  try {
    const { branding, storeSettings, seoSettings } = await getBranding();
    const origin = resolveSiteUrl(
      storeSettings.domain,
      env.NEXT_PUBLIC_FRONTEND_URL,
    );
    if (!origin) return null;
    return {
      origin,
      name: storeSettings.name?.trim() || "Store",
      description: seoSettings.description?.trim() ?? "",
      sitemapEnabled: seoSettings.enableSitemap,
      currency: getStoreCurrency(),
      hidePrices: isQuoteMode(
        normalizeCheckoutMode(storeSettings.checkoutType),
      ),
      defaultCollectionSort: branding.defaultCollectionSort as SortKeyType,
    };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

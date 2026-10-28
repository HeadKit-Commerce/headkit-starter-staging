import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import { errorFields, logger } from "@/lib/logger";
import { headkit } from "@/lib/sdk";
import { env } from "@/lib/env";
import {
  brandHeaderFromSummaries,
  brandPrerenderUsesList,
} from "@/lib/brand-prerender";
import { getPrerenderBrandIndex } from "@/lib/brand-prerender-index";

/** The lightweight brand term the product payload carries. */
export interface ProductBrandTerm {
  id: string;
  name: string;
  slug: string;
}

/** What the PDP renders above the title and names in JSON-LD. */
export interface ProductDisplayBrand {
  name: string;
  slug: string;
  /** Brand logo URL from the brand term's thumbnail, when the merchant set one. */
  logoUrl: string | null;
}

/**
 * Which of a product's brand terms the PDP shows.
 *
 * The classic Bike Society storefront picked the edge flagged `isPrimary`, then
 * the parent-less term (a product tagged both "Specialized" and "S-Works" showed
 * S-Works). The `headkit/v2` product payload carries neither a primary flag nor
 * a parent relation on its brand terms, so the rule here is the FIRST term in
 * payload order — WordPress returns `product_brand` terms by name, which is one
 * stable value per product. `null` when the product has no brand, and the PDP
 * then renders exactly what it renders today.
 */
export function resolveDisplayBrand(
  brands: readonly ProductBrandTerm[] | null | undefined,
): ProductBrandTerm | null {
  const first = brands?.find(
    (b) => b.slug.trim() !== "" && b.name.trim() !== "",
  );
  return first ?? null;
}

/**
 * Brand logo for the PDP — ONE cache entry per brand, shared by every product
 * that carries it.
 *
 * Tagged `TAG.brands` — the PLURAL term tag — and deliberately NOT
 * `TAG.brand(slug)`. The two name two different data domains, and this read is
 * in the second one:
 *
 *   - `headkit:brand:{slug}` means "the set of products in this brand changed".
 *     The theme fires it on EVERY save of a product in the brand, including a
 *     stock change arriving from an order (`headkit_product_brand_tags`,
 *     reached from the product builder). `/brand/{slug}`'s grid subscribes to
 *     it, correctly.
 *   - `headkit:brands` means "a brand TERM was created, edited or deleted" —
 *     exactly when a brand's name or logo can change. It is emitted only from
 *     the `brands_data` endpoint suffix, reachable only from the
 *     `product_brand` branches of `created_term` / `edited_term` /
 *     `delete_term`. No product event path reaches it
 *     (`lib/wp-revalidation-events.test.ts` asserts that against the theme).
 *
 * This read answers the brand TERM's name and logo, so the term tag is the one
 * whose events actually change its output. Carrying the product-SET tag instead
 * meant one stock movement on any product in a brand purged the prerendered PDP
 * entry of every other product in it, none of whose logos had changed — tags
 * propagate outward unconditionally onto the awaiting route's CDN entry.
 *
 * THE TRADE THIS ACCEPTS, so nobody re-derives it: `headkit:brands` reaches
 * every PDP on the store, not only one brand's, so a brand-term edit now
 * refreshes all of them. That is a rare admin action against the most frequent
 * event in the system, and it is an INVALIDATION rather than a deletion, so
 * each page serves its previous copy while refreshing behind the request.
 * `headkit:brands` is therefore classified WIDE in `lib/cache-tags.ts`; that
 * classification is not optional and must not be reverted while this line
 * stands, or one brand-term edit becomes a site-wide DELETION. A narrower fix
 * needs a new `headkit:brand-term:{slug}` tag, which needs a theme release.
 *
 * A failed brand read is a missing logo, never a failed PDP: the product is
 * the page, the logo is decoration. `brands.get` answers the brand detail
 * (with a page of its products), so only the three fields the PDP needs are
 * returned — a "use cache" entry stores its return value.
 *
 * During `phase-production-build` the name and logo come from the CDN-cached
 * brand LIST instead (`lib/brand-prerender.ts`): `brands.get` is an
 * edge-bypassing origin read, and this entry runs once per distinct brand the
 * prerendered products carry. The three fields are identical on both routes, so
 * nothing is lost by it, and the entry is refreshed from the detail read like
 * any other.
 */
export async function getCachedProductBrand(
  slug: string,
): Promise<ProductDisplayBrand | null> {
  "use cache";
  cacheLifeForProfile("days", "max");
  cacheTag(TAG.brands);
  try {
    if (brandPrerenderUsesList(env.NEXT_PHASE)) {
      const summary = brandHeaderFromSummaries(
        slug,
        await getPrerenderBrandIndex(),
      );
      if (!summary) return null;
      return {
        name: summary.name,
        slug: summary.slug,
        logoUrl: summary.imageSrc || summary.thumbnail || null,
      };
    }
    const brand = await headkit.brands.get(slug);
    if (!brand) return null;
    const logoUrl = brand.image?.src || brand.thumbnail || null;
    return { name: brand.name, slug: brand.slug, logoUrl };
  } catch (error) {
    logger.info("pdp.brand_logo_unavailable", {
      brandSlug: slug,
      ...errorFields(error),
    });
    return null;
  }
}

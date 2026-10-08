import { getProductForPage } from "@/lib/product-cache";
import { env } from "@/lib/env";
import { isShopifyStorefront } from "@/lib/shopify-storefront";

/**
 * Shopify Admin preview entry points, and why both are blocking routes.
 *
 * The HeadKit redirect theme rewrites Admin's two preview paths to the
 * storefront, preserving the query string
 * (`integrations/shopify/theme/layout/theme.liquid`). `app/products_preview`
 * and `app/draft-product` are where they land. Both render nothing: they read
 * `preview_key`/`shpxid`, resolve the product here, and redirect.
 *
 * Both MUST read `searchParams` above every Suspense boundary — the decision
 * they make IS the response — and both set `export const instant = false`.
 * That export DECLARES the shape (a segment allowed to block when navigated
 * to); it does not grant the read. See "Setting a status code needs THREE
 * conditions" in `apps/starter/AGENTS.md`, which measures what `instant` does
 * and does not do. They used to borrow the boundary `app/layout.tsx` wrapped
 * `{children}` in; the canonical-URL change removed it so the product and
 * collection routes could serve real 308s, which left these two with no
 * boundary and failed the build outright.
 *
 * Giving them a boundary of their own would be the wrong repair for the same
 * reason it was removed from the layout: under Cache Components a redirect
 * thrown below a boundary commits after the response, so the route answers 200
 * plus an empty shell and redirects only on the client.
 */

/** Internal commerce slug prefix for Shopify Admin preview product IDs (shpxid). */
export const SHOPIFY_PREVIEW_SLUG_PREFIX = "__shopify_preview__:";

export function shopifyPreviewKeyFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const raw = searchParams?.preview_key;
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw;
  }
  return undefined;
}

export function shopifyProductIdFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const raw = searchParams?.shpxid;
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.trim();
  }
  return undefined;
}

/**
 * Shopify Admin `preview_key`, or nothing when this store is not Shopify.
 *
 * Contact, checkout, and the CMS already branch on `isShopifyStorefront`.
 * Preview uses that same flag. WooCommerce returns before the query string
 * is read, so a Woo prerender never waits on Shopify Admin.
 */
export async function shopifyPreviewKeyWhenConnected(
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | undefined,
): Promise<string | undefined> {
  if (!isShopifyStorefront(env)) return undefined;
  return shopifyPreviewKeyFromSearchParams(
    searchParams ? await searchParams : undefined,
  );
}

/**
 * Resolve a Shopify Admin preview landing URL to the PDP path that can render it.
 *
 * Returns the FLAT `/products/{handle}?preview_key=…`, and that is deliberate:
 * since the 2026-08-22 canonical decision the flat shape is the LOSER for
 * ordinary traffic, but it is the only shape a DRAFT product can be served on.
 *
 * The nested `/shop/…` route verifies its candidate against
 * `getCachedProduct` before serving (`resolveShopProduct` in
 * `app/shop/[...slug]/page.tsx`) — the public catalogue read, which a draft
 * fails by construction — so a draft sent there answers notFound(). The flat
 * route gates its 308 on that same read, so a draft is not redirected and
 * falls through to a render that does consult the Admin API.
 *
 * Do not "correct" this to `productPath(product)` to satisfy the canonical
 * invariant. The canonical governs URLs offered to CRAWLERS; this one is
 * handed to a merchant previewing unpublished content, is noindex at the page
 * level, and pointing it at the nested shape would 404 every draft.
 */
export async function resolveShopifyPreviewProductPath(
  previewKey: string,
  shopifyProductId: string | undefined,
): Promise<string | null> {
  if (!shopifyProductId) {
    return null;
  }

  const product = await getProductForPage(
    `${SHOPIFY_PREVIEW_SLUG_PREFIX}${shopifyProductId}`,
    { shopifyPreviewKey: previewKey },
  );
  if (!product?.slug) {
    return null;
  }

  const params = new URLSearchParams({ preview_key: previewKey });
  return `/products/${encodeURIComponent(product.slug)}?${params.toString()}`;
}

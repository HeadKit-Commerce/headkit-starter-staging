import { notFound, redirect } from "next/navigation";
import { env } from "@/lib/env";
import { isShopifyStorefront } from "@/lib/shopify-storefront";
import {
  resolveShopifyPreviewProductPath,
  shopifyPreviewKeyFromSearchParams,
  shopifyProductIdFromSearchParams,
} from "@/lib/shopify-preview";

type Props = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | undefined;
};

/**
 * Blocking, never prerendered — see the module doc in `@/lib/shopify-preview`
 * for why both preview entry points must be. Applies to THIS redirect-only
 * route; it says nothing about the PDP routes, which render a page and read
 * only `params` in their default export.
 */
export const instant = false;

/** Shopify Admin draft product preview path (`/draft-product?preview_key=…&shpxid=…`). */
export default async function ShopifyDraftProductPreviewPage({
  searchParams,
}: Props): Promise<never> {
  // Same provider flag as contact, checkout, and the CMS. WooCommerce
  // answers before the query string is read.
  if (!isShopifyStorefront(env)) {
    notFound();
  }
  const params = (await searchParams) ?? {};
  const previewKey = shopifyPreviewKeyFromSearchParams(params);
  if (!previewKey) {
    notFound();
  }

  const target = await resolveShopifyPreviewProductPath(
    previewKey,
    shopifyProductIdFromSearchParams(params),
  );
  if (!target) {
    notFound();
  }

  redirect(target);
}

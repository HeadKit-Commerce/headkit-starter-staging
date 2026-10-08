import { getProductStock } from "@/lib/product-cache";
import { LiveAvailability } from "@/components/headkit-ui/live-availability";
import type { StockSnapshot } from "@/components/headkit-ui/live-availability";
import { resolveDisplayBrand } from "@/lib/product-brand";
import { getBranding } from "@/lib/branding";
import { isQuoteMode, normalizeCheckoutMode } from "@/lib/checkout-mode";

interface Props {
  productSlug: string;
  colorSlug?: string;
}

/**
 * The PDP availability line.
 *
 * Reads `getProductStock`, the five-minute entry, and passes every variation
 * to `LiveAvailability`. It does not read `getCachedProduct`: that entry is
 * the catalogue snapshot and would hold the number for days.
 *
 * Quote checkout hides this line. The check runs before the stock read, on
 * the cached branding bundle, so a quote store never creates the five-minute
 * entry and its product page stays on the catalogue lifetime.
 *
 * Must never throw during post-action RSC refresh (e.g. after add-to-cart):
 * a provider outage would otherwise trip the route `error.tsx` boundary.
 */
export async function ProductStock({ productSlug }: Props) {
  try {
    const branding = await getBranding();
    if (
      isQuoteMode(normalizeCheckoutMode(branding.storeSettings.checkoutType))
    ) {
      return null;
    }

    const product = await getProductStock(productSlug);
    if (!product) return null;
    const snapshot: StockSnapshot = {
      stockStatus: product.stockStatus ?? "instock",
      stockQuantity: product.stockQuantity ?? null,
      brandSlug: resolveDisplayBrand(product.brands ?? [])?.slug ?? null,
      variations: product.variations.map((variation) => ({
        id: variation.id,
        stockStatus: variation.stockStatus ?? null,
        stockQuantity: variation.stockQuantity ?? null,
        attributes: variation.attributes.map((attribute) => ({
          key: attribute.key,
          value: attribute.value,
        })),
      })),
    };
    return <LiveAvailability snapshot={snapshot} />;
  } catch {
    return null;
  }
}

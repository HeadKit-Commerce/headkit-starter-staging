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
  // `snapshot` is bound outside the try and the element is constructed after
  // it, because `react-hooks/error-boundaries` refuses JSX built inside a
  // try/catch: React renders the child later, so a render error there is not
  // caught here anyway. The catch still swallows a failed READ.
  let snapshot: StockSnapshot | null = null;
  try {
    const branding = await getBranding();
    if (
      isQuoteMode(normalizeCheckoutMode(branding.storeSettings.checkoutType))
    ) {
      return null;
    }

    const product = await getProductStock(productSlug);
    if (!product) return null;
    snapshot = {
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
  } catch {
    return null;
  }

  if (!snapshot) return null;
  return <LiveAvailability snapshot={snapshot} />;
}

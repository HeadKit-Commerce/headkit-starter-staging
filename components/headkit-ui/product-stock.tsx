import { getLiveProductStock } from "@/lib/product-cache";
import { LiveAvailability } from "@/components/headkit-ui/live-availability";
import type { StockSnapshot } from "@/components/headkit-ui/live-availability";
import { resolveDisplayBrand } from "@/lib/product-brand";

interface Props {
  productSlug: string;
  colorSlug?: string;
}

/**
 * The PDP availability line.
 *
 * The product page renders this inside `<Suspense>`. The read is
 * `getLiveProductStock` (`"use cache: remote"`, `cacheLife("seconds")`).
 * Next.js leaves that lifetime out of the prerender, so the fallback is in
 * the static shell and this line streams in at request time. The gallery,
 * title, price and description stay on `getCachedProduct` and are not inside
 * this boundary.
 *
 * The snapshot includes every variation. `LiveAvailability` matches the
 * variation `ProductDetail` has selected, so a size click and the Add to Bag
 * button stay on the same stock. The URL colour is that component's seeded
 * selection, so this read does not pick a variation itself.
 *
 * Uses `products.get` until a lean `getStock` SDK method ships (ENG-853).
 *
 * Must never throw during post-action RSC refresh (e.g. after add-to-cart):
 * a provider outage would otherwise trip the route `error.tsx` boundary.
 */
export async function ProductStock({ productSlug }: Props) {
  let snapshot: StockSnapshot | null = null;
  try {
    const product = await getLiveProductStock(productSlug);
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

  return <LiveAvailability snapshot={snapshot} />;
}

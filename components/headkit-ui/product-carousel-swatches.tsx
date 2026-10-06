import { ProductCard } from "@/components/headkit-ui/product-card";
import { CAROUSEL_CARD_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import type { CatalogProduct } from "@/lib/catalog-display";

/**
 * Client card, loaded only when branding turns swatches on. The static
 * slide stays a Server Component otherwise, so this module is not in the
 * homepage graph until that branch runs.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 */
export function SwatchProductSlide({
  product,
}: {
  product: CatalogProduct;
}): React.JSX.Element {
  return (
    <ProductCard
      product={product}
      isNew={product.isNew}
      prefetch
      imageSizes={CAROUSEL_CARD_IMAGE_SIZES}
      imageQuality={50}
    />
  );
}

import { ProductPageShell } from "@/app/products/[...slug]/product-page-shell";

/**
 * Instant navigation fallback for `/shop/…`.
 *
 * Next.js shows this only while the destination segment is not ready.
 * A prerendered or prefetched product renders its content instead. Product
 * cards land on this route; a category URL served here uses the same
 * fallback for the moment before its grid resolves.
 */
export default function ShopLoading(): React.JSX.Element {
  return <ProductPageShell />;
}

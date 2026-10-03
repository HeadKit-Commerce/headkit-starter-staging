import { ProductPageShell } from "./product-page-shell";

/**
 * Instant navigation fallback for a flat product URL.
 *
 * Shown only when that page is not already ready. A product card whose
 * canonical path is `/products/…` lands here.
 */
export default function ProductLoading(): React.JSX.Element {
  return <ProductPageShell />;
}

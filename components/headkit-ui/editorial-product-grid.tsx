import type { Product } from "@headkit/sdk";
import { ProductCarousel } from "@/components/headkit-ui/product-carousel";
import type { ColourwayPins } from "@/lib/catalog-display";

interface Props {
  /** Products resolved (by slug) from a WordPress handpicked-products block. */
  products: Product[];
  /**
   * Column count from WP's `has-N-columns` (unused — homepage styling uses the
   * scrollable ProductCarousel, not a static grid). Kept for call-site compat.
   */
  columns?: number;
  /** Optional admin pins: product ID → colourway slug. */
  colourwayPins?: ColourwayPins | null | undefined;
}

/**
 * Renders a WordPress handpicked-products block using the same ProductCarousel
 * as the homepage HeadKit product sections (scrollable cards, scrollbar when
 * overflow, one colourway per product).
 *
 * Injected by EditorialContent in place of the `.wc-block-grid` node. Negative
 * horizontal margin cancels the parent `hk-section-content` / prose pad so the
 * carousel's own `px-5 md:px-10` matches homepage alignment.
 */
export function EditorialProductGrid({
  products,
  colourwayPins,
}: Props): React.JSX.Element | null {
  if (!products.length) return null;

  return (
    <div className="not-prose -mx-5 md:-mx-10">
      <ProductCarousel products={products} colourwayPins={colourwayPins} />
    </div>
  );
}

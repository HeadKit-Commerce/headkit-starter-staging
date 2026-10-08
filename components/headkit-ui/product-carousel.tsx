import { CAROUSEL_CARD_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import { Carousel } from "@/components/headkit-ui/carousel";
import { ProductSlide } from "@/components/headkit-ui/product-slide";
import { getBranding } from "@/lib/branding";
import { clientThemeSlice } from "@/lib/client-theme";
import { getStoreTheme } from "@/lib/store-theme";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";
import {
  collapseCatalogProducts,
  type ColourwayPins,
} from "@/lib/catalog-display";

interface Props {
  products: ProductSummaryFieldsFragment[];
  carouselItemClassName?: string;
  id?: string;
  /** Optional admin pins from handpicked-products `productColourways`. */
  colourwayPins?: ColourwayPins | null | undefined;
  /**
   * Accepted so existing call sites keep typechecking. Every product card
   * passes `prefetch={true}`. Next's prefetch scheduler orders a page of
   * them; this count no longer withholds the rest.
   */
  prefetchCount?: number;
  /** Store forks (Bike Society) pass their shared card-carousel track. */
  gap?: string;
  itemSizing?: {
    base: string;
    sm?: string;
    lg?: string;
    xl?: string;
    "2xl"?: string;
  };
  stacked?: boolean;
  emphasizeTitle?: boolean;
  badgeClassName?: string;
  imageClassName?: string;
}

/**
 * Width of the first visible row of a default `Carousel` (up to four cards).
 * Kept for call sites that used to limit prefetch to that row. Prefetch is no
 * longer capped here.
 */
export const CAROUSEL_FIRST_ROW = 4;

/**
 * Server Component. Slides are server HTML passed as children, so the card
 * markup is not part of the carousel client module. Swatch cards are the
 * exception: they still need the client `ProductCard`, and that module is
 * imported only when branding has swatches on.
 *
 * Not wrapped in Suspense. A completed boundary past the progressive chunk
 * size is outlined into a hidden segment.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 * https://nextjs.org/docs/app/getting-started/caching#static-cached-and-streaming
 */
const ProductCarousel = async ({
  products,
  carouselItemClassName: _carouselItemClassName,
  id = "product-carousel",
  colourwayPins,
  prefetchCount: _prefetchCount = 0,
  gap,
  itemSizing,
  stacked = false,
  emphasizeTitle = true,
  badgeClassName,
  imageClassName,
}: Props) => {
  const items = collapseCatalogProducts(products, colourwayPins);
  const branding = (await getBranding()).branding;
  const theme = clientThemeSlice(getStoreTheme());
  const track = {
    id,
    showPagination: false as const,
    ...(gap ? { gap } : {}),
    ...(itemSizing ? { itemSizing } : {}),
  };

  if (branding.showSwatches) {
    const { SwatchProductSlide } =
      await import("@/components/headkit-ui/product-carousel-swatches");
    return (
      <Carousel {...track}>
        {items.map((product) => (
          <SwatchProductSlide
            key={product.id || product.slug}
            product={product}
          />
        ))}
      </Carousel>
    );
  }

  return (
    <Carousel {...track}>
      {items.map((product) => (
        <ProductSlide
          key={product.id || product.slug}
          product={product}
          imageRollover={branding.imageRollover}
          badgeTags={theme.badgeTags}
          imageSizes={CAROUSEL_CARD_IMAGE_SIZES}
          imageQuality={50}
          stacked={stacked}
          emphasizeTitle={emphasizeTitle}
          {...(badgeClassName ? { badgeClassName } : {})}
          {...(imageClassName ? { imageClassName } : {})}
        />
      ))}
    </Carousel>
  );
};

export { ProductCarousel };

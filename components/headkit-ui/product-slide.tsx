import { InstantLink } from "@/components/headkit-ui/instant-link";
import { FeaturedImage } from "@/components/headkit-ui/featured-image";
import { ProductPrice } from "@/components/headkit-ui/product-price";
import { BadgeList } from "@/components/headkit-ui/badge-list";
import { TitleEmphasis } from "@/components/headkit-ui/title-emphasis";
import { CATALOG_GRID_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import type { CatalogProduct } from "@/lib/catalog-display";
import { findSwatchAttribute } from "@/lib/swatch-attribute";
import { productPath } from "@/lib/canonical-path";
import { getVariationCardPrice } from "@/lib/price-display";
import { productBadgesFromTags } from "@/lib/product-badges";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { stripTitleMarkers } from "@/lib/title-emphasis";

/**
 * Server-rendered product card for a carousel. No swatch state: that stays
 * on the client `ProductCard`, which the carousel loads only when branding
 * has swatches on. Rollover is a `group-hover` class, not component state.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 */

function isVariableProduct(product: CatalogProduct): boolean {
  return product.type?.toUpperCase() === "VARIABLE";
}

function slideImage(
  product: CatalogProduct,
  imageRollover: boolean,
): { href: string; src: string; hoverSrc: string | null } {
  const locked = product.colorwaySlug ?? null;
  const colourAttr = findSwatchAttribute(product.attributes ?? []);
  let colour: string | null = locked;
  let src = product.image?.src ?? "";
  if (!locked && isVariableProduct(product)) {
    if ((product.attributes?.length ?? 0) === 1 && !colourAttr) {
      colour = null;
      src = product.variations?.[0]?.image?.src ?? "";
    } else {
      colour = colourAttr?.fullOptions?.[0]?.slug ?? null;
    }
  } else if (!locked) {
    colour = null;
  }

  if (isVariableProduct(product) && colour) {
    const selected = product.variations?.find((variation) =>
      variation.attributes.some((attr) => colour === attr.value),
    );
    if (selected?.image?.src) src = selected.image.src;
    else if (product.image?.src) src = product.image.src;
  }

  const selectedVariation =
    isVariableProduct(product) && colour
      ? product.variations?.find((variation) =>
          variation.attributes.some((attr) => colour === attr.value),
        )
      : undefined;
  const hoverSrc = imageRollover
    ? locked
      ? (product.hoverImage?.src ?? null)
      : (selectedVariation?.images?.[1]?.src ?? product.hoverImage?.src ?? null)
    : null;

  return {
    href: productPath(product, locked ?? colour ?? undefined),
    src,
    hoverSrc,
  };
}

export function ProductSlide({
  product,
  imageRollover,
  badgeTags,
  priority = false,
  prefetch = true,
  imageSizes = CATALOG_GRID_IMAGE_SIZES,
  imageQuality = 50,
  titleAs = "h3",
  stacked = false,
  emphasizeTitle = true,
  badgeClassName = "absolute left-2 top-2 z-10",
  imageClassName,
  dark = false,
  className,
}: {
  product: CatalogProduct;
  imageRollover: boolean;
  badgeTags?: string[] | undefined;
  priority?: boolean;
  prefetch?: boolean;
  imageSizes?: string;
  imageQuality?: 50 | 65 | 75 | 100;
  titleAs?: "h2" | "h3";
  /** Bike Society stacks the price under the title. */
  stacked?: boolean;
  emphasizeTitle?: boolean;
  badgeClassName?: string;
  imageClassName?: string;
  dark?: boolean;
  className?: string;
}): React.JSX.Element {
  const TitleTag = titleAs;
  const { href, src, hoverSrc } = slideImage(product, imageRollover);
  const prices = isVariableProduct(product)
    ? getVariationCardPrice({
        variations: product.variations ?? [],
        fallbackPrice: product.price,
        fallbackRegularPrice: product.regularPrice,
      })
    : {
        price: product.price ?? "",
        regularPrice: product.regularPrice ?? "",
      };
  const isNewIn = Boolean(product.isNew);
  // SDK 1.4 product summaries have no `tags`. Newer SDKs do. Read them
  // only when the field is present so both typecheck. New and Sale still
  // come from `isNew` and `onSale`.
  const tags =
    "tags" in product
      ? (
          product as {
            tags?: Parameters<typeof productBadgesFromTags>[0];
          }
        ).tags
      : undefined;
  const badges = productBadgesFromTags(tags, badgeTags, {
    hideNew: isNewIn,
    hideSale: product.onSale ?? false,
  });
  const plainName = stripTitleMarkers(
    decodeHtmlEntities(product.name ?? "Product"),
  );
  const title = emphasizeTitle ? (
    <TitleEmphasis text={product.name ?? ""} highlight={titleAs === "h2"} />
  ) : (
    decodeHtmlEntities(product.name ?? "")
  );

  return (
    <div className={cn("headkit-product-card relative w-full", className)}>
      <div className={badgeClassName}>
        <BadgeList
          isSale={product.onSale ?? false}
          isNewIn={isNewIn}
          badges={badges}
        />
      </div>
      <InstantLink
        href={href}
        prefetch={prefetch}
        aria-label="Featured Image"
        className="group block"
      >
        <FeaturedImage
          src={src}
          hoverSrc={hoverSrc}
          revealOnGroupHover={Boolean(hoverSrc)}
          alt={plainName}
          priority={priority}
          fit="contain"
          sizes={imageSizes}
          quality={imageQuality}
          {...(imageClassName ? { className: imageClassName } : {})}
        />
      </InstantLink>
      <div className="pt-3">
        <div
          className={
            stacked
              ? undefined
              : "flex flex-col gap-1 lg:flex-row lg:justify-between lg:gap-2"
          }
        >
          <div className="min-w-0">
            <InstantLink href={href} prefetch={prefetch} pendingVariant="text">
              <TitleTag
                className={cn(
                  "text-[17px] text-primary line-clamp-2 break-words",
                  dark && "text-white",
                )}
              >
                {title}
              </TitleTag>
            </InstantLink>
          </div>
          {stacked ? (
            <ProductPrice
              price={prices.price}
              regularPrice={prices.regularPrice}
              onSale={product.onSale ?? false}
              dark={dark}
            />
          ) : (
            <div className="flex shrink-0 justify-between">
              <ProductPrice
                price={prices.price}
                regularPrice={prices.regularPrice}
                onSale={product.onSale ?? false}
                dark={dark}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

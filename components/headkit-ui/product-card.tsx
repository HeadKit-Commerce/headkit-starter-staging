"use client";

import { InstantLink } from "@/components/headkit-ui/instant-link";
import { Fragment, useEffect, useState } from "react";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";
import { cn, decodeHtmlEntities, getFloatVal } from "@/lib/utils";
import { productPath } from "@/lib/canonical-path";
import { FeaturedImage } from "@/components/headkit-ui/featured-image";
import { ProductPrice } from "@/components/headkit-ui/product-price";
import { BadgeList } from "@/components/headkit-ui/badge-list";
import { SwatchDot } from "@/components/headkit-ui/swatch-dot";
import { getVariationCardPrice } from "@/lib/price-display";
import { findSwatchAttribute } from "@/lib/swatch-attribute";
import { useCatalogDisplay } from "@/components/headkit-ui/catalog-display-provider";
import type { CatalogProduct } from "@/lib/catalog-display";
import { TitleEmphasis } from "@/components/headkit-ui/title-emphasis";
import { productBadgesFromTags } from "@/lib/product-badges";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { getStoreTheme } from "@/lib/store-theme";
import {
  buildSelectItem,
  productToGa4Item,
  pushGa4Ecommerce,
} from "@/lib/ga4-ecommerce";

const isVariableProduct = (product: ProductSummaryFieldsFragment): boolean =>
  product?.type?.toUpperCase() === "VARIABLE";

/**
 * Colour chips stay out of the viewport prefetch queue until the pointer
 * enters that chip. `prefetch={true}` then resolves that colourway. The set
 * only grows, so leaving the chip does not cancel the prefetch.
 *
 * `prefetch={null}` would only pull the shared shell under Partial
 * Prefetching. The colourway is keyed on `params`, so the armed chip uses
 * `true`.
 * https://nextjs.org/docs/app/guides/prefetching#hover-triggered-prefetch
 * https://nextjs.org/docs/app/guides/optimizing-prefetching
 */
function rememberSwatch(
  armed: ReadonlySet<string>,
  optionSlug: string,
): ReadonlySet<string> {
  if (optionSlug.length === 0 || armed.has(optionSlug)) return armed;
  const next = new Set(armed);
  next.add(optionSlug);
  return next;
}

/**
 * Colour dots a card shows before the rest collapse into a "+N" chip.
 *
 * N dots PLUS the chip, not N including it: at four-plus-one a card with five
 * colourways still shows four, where four-including would show three and a
 * "+2" — strictly less information for the same width.
 *
 * 10 is the platform default and is what every store renders today. A store
 * whose cards carry long colourway ranges can lower it with
 * `catalog.maxCardSwatches` in `overrides/theme.json` (Bike Society runs 4);
 * the value only decides where the chip starts, never whether the row is
 * accessible — the 24 px target below is unconditional.
 */
const DEFAULT_MAX_CARD_SWATCHES = 10;

function colourAttribute(product: ProductSummaryFieldsFragment) {
  return findSwatchAttribute(product.attributes);
}

interface Props {
  product: CatalogProduct;
  className?: string;
  dark?: boolean;
  mobileCol?: boolean;
  isNew?: boolean;
  /** Eager-load the card image (first-row cards where it may be the LCP). */
  priority?: boolean;
  /**
   * Forwarded to both of the card's `InstantLink`s. Omitted means `true`: a
   * product URL is keyed on `params`, so it joins Next's prefetch queue.
   * The scheduler prefetches visible links, moves the hovered one to the
   * front, and does not drop that priority when the pointer leaves.
   * https://nextjs.org/docs/app/guides/prefetching#prefetch-scheduling
   * Pass `false` only to opt a card out.
   */
  prefetch?: boolean | undefined;
  /**
   * Heading level for the product name. The correct level depends on where the
   * card sits:
   *
   *   - PLP / search / carousels: the card sits under a section `h2` (visible
   *     on carousels; `sr-only` "Products" on the collection grid), so `h3`.
   *   - Wishlist: the card follows the page `h1` directly, so `h2`.
   *
   * Defaults to `h3`, the nested case.
   */
  titleAs?: "h2" | "h3";
  /**
   * List identity for GA4 `select_item`. Set by surfaces that ARE a list (the
   * collection grid passes the collection path); omitted elsewhere, in which
   * case the card emits nothing — a `select_item` with no list is not a
   * measurement, it is noise.
   */
  listName?: string;
  /** Zero-based position of this card within `listName`. */
  listIndex?: number;
}

export const ProductCard = ({
  product,
  className,
  dark = false,
  mobileCol = false,
  isNew = false,
  priority = false,
  prefetch,
  titleAs = "h3",
  listName,
  listIndex,
}: Props) => {
  const TitleTag = titleAs;
  const { showSwatches, imageRollover } = useCatalogDisplay();
  const lockedColour = product.colorwaySlug ?? null;

  const [colourSelected, setColourSelected] = useState<string | null>(() => {
    if (lockedColour) return lockedColour;
    if (!product || !isVariableProduct(product)) return null;
    return colourAttribute(product)?.fullOptions?.[0]?.slug ?? null;
  });
  const [imageSelected, setImageSelected] = useState<string>(() => {
    if (!product) return "";
    if (!isVariableProduct(product)) return product.image?.src ?? "";
    const colourAttr = colourAttribute(product);
    if (product.attributes.length === 1 && !colourAttr) {
      return product.variations?.[0]?.image?.src ?? "";
    }
    return product.image?.src ?? "";
  });
  const [isHovering, setIsHovering] = useState(false);
  const [armedSwatches, setArmedSwatches] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const armSwatch = (optionSlug: string): void => {
    setColourSelected(optionSlug || null);
    setArmedSwatches((current) => rememberSwatch(current, optionSlug));
  };

  // The one canonical path, resolved from the product's own permalink — the
  // same string the canonical tag, the sitemap and the Product JSON-LD emit.
  // Building `/products/{slug}` here is what pointed every card, on every
  // surface, at the shape the store did NOT have indexed.
  const href = productPath(product, lockedColour ?? colourSelected);

  const selectedVariationForHover =
    isVariableProduct(product) && colourSelected
      ? product.variations.find((variation) =>
          variation.attributes.some((attr) => colourSelected === attr.value),
        )
      : undefined;
  // Prefer the second variation gallery image; parent hoverImage applies to
  // simple cards and non-exploded swatch cards. Exploded colourway cards
  // already resolved hoverImage in catalog-display (colourway images[1],
  // then parent hover if it is not another colourway's primary). Do not
  // re-scan variations — that reintroduces the first-card stolen-hover bug.
  const hoverSrc = imageRollover
    ? lockedColour
      ? (product.hoverImage?.src ?? null)
      : (selectedVariationForHover?.images?.[1]?.src ??
        product.hoverImage?.src ??
        null)
    : null;

  useEffect(() => {
    if (!product) return;

    if (lockedColour) {
      setColourSelected(lockedColour);
      return;
    }

    if (isVariableProduct(product)) {
      const colourAttr = colourAttribute(product);
      if (product.attributes.length === 1 && !colourAttr) {
        setColourSelected(null);
        setImageSelected(product.variations?.[0]?.image?.src ?? "");
      } else {
        setColourSelected(colourAttr?.fullOptions?.[0]?.slug ?? null);
      }
    } else {
      setColourSelected(null);
      setImageSelected(product.image?.src ?? "");
    }
  }, [product, lockedColour]);

  useEffect(() => {
    if (!product || !isVariableProduct(product)) return;

    const selectedVariation = product.variations.find((variation) =>
      variation.attributes.some((attr) => colourSelected === attr.value),
    );

    if (selectedVariation) {
      setImageSelected(selectedVariation.image?.src ?? "");
    } else if (product.image?.src) {
      setImageSelected(product.image.src);
    }
  }, [colourSelected, product]);

  const getDisplayPrice = () => {
    if (!isVariableProduct(product)) {
      return {
        price: product?.price ?? "",
        regularPrice: product?.regularPrice ?? "",
      };
    }
    return getVariationCardPrice({
      variations: product.variations ?? [],
      fallbackPrice: product?.price,
      fallbackRegularPrice: product?.regularPrice,
    });
  };

  const { price: displayPrice, regularPrice: displayRegularPrice } =
    getDisplayPrice();

  if (!product) return null;

  const maxCardSwatches =
    getStoreTheme().catalog?.maxCardSwatches ?? DEFAULT_MAX_CARD_SWATCHES;

  const isNewIn = isNew || Boolean(product?.isNew);
  const customBadges = productBadgesFromTags(
    product.tags,
    getStoreTheme().catalog?.badgeTags,
    { hideNew: isNewIn, hideSale: product?.onSale ?? false },
  );
  const plainName = stripTitleMarkers(
    decodeHtmlEntities(product?.name ?? "Product"),
  );

  // GA4 `select_item` — the click that leaves a list for the PDP. The price is
  // the card's own displayed price, so the list event and the `view_item` that
  // follows it agree on the figure the shopper saw.
  const handleSelectItem = (): void => {
    if (!listName) return;
    pushGa4Ecommerce(
      buildSelectItem(
        listName,
        productToGa4Item(product, {
          price: getFloatVal(displayPrice),
          ...(listIndex !== undefined ? { index: listIndex } : {}),
          itemListName: listName,
        }),
      ),
    );
  };

  return (
    <div className={cn("headkit-product-card relative w-full", className)}>
      <div className="absolute left-2 top-2 z-10">
        <BadgeList
          isSale={product?.onSale ?? false}
          // Prefer explicit prop; fall back to product.isNew so collection grids
          // show New without every caller passing the prop.
          isNewIn={isNewIn}
          badges={customBadges}
        />
      </div>
      {/*
        `prefetch={true}` puts this product URL in Next's queue. Visible cards
        prefetch in the background; the card under the pointer is the priority
        task and stays there after the pointer leaves.
      */}
      <InstantLink
        href={href}
        prefetch={prefetch ?? true}
        aria-label="Featured Image"
        className="block"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={handleSelectItem}
      >
        <FeaturedImage
          src={imageSelected}
          hoverSrc={hoverSrc}
          showHover={isHovering}
          alt={plainName}
          priority={priority}
          fit="contain"
        />
      </InstantLink>
      <div className="pt-3">
        <div
          className={cn(
            // Title/price share a row only from lg: — at md (3-col grid,
            // ~230px cards) the shrink-0 price squeezed titles to ~100px,
            // truncating mid-word and stacking swatches one per row (F11).
            "flex flex-col gap-1 lg:flex-row lg:justify-between lg:gap-2",
            mobileCol && "flex-col",
          )}
        >
          <div className="min-w-0">
            <InstantLink
              href={href}
              prefetch={prefetch ?? true}
              pendingVariant="text"
              onClick={handleSelectItem}
            >
              {/* Level comes from `titleAs` — see the prop docs. Visual size is
                  class-driven and identical at either level. */}
              <TitleTag
                className={cn(
                  "text-[17px] text-primary line-clamp-2 break-words",
                  dark && "text-white",
                )}
              >
                <TitleEmphasis
                  text={product?.name ?? ""}
                  highlight={titleAs === "h2"}
                />
              </TitleTag>
            </InstantLink>
            <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
              {showSwatches &&
                isVariableProduct(product) &&
                product.attributes.map((attribute) => {
                  if (!findSwatchAttribute([attribute])) return null;
                  const options = attribute.fullOptions ?? [];
                  const visible = options.slice(0, maxCardSwatches);
                  const extra = options.length - visible.length;
                  return (
                    <Fragment key={attribute.slug}>
                      {/*
                        The dots keep their own container so the 24 px targets
                        can sit FLUSH (no gap) while the row's outer `gap-2`
                        still separates them from the "+N" chip. Flush is what
                        makes the target legal AND invisible: a 16 px dot
                        centred in a 24 px box repeats every 24 px, which is
                        exactly the 16 px dot + 8 px gap pitch the row had
                        before. The negative margins then hand back the 4 px
                        the padding added on each side (and 2 px top and
                        bottom), so the first dot, the last dot, the chip and
                        the row height land on the pixels they did when the
                        links wrapped `<button>`s.
                      */}
                      <div className="-mx-1 -my-0.5 flex flex-wrap items-center">
                        {visible.map((option) => {
                          const optionSlug = option?.slug ?? "";
                          const swatchHref = productPath(
                            product,
                            optionSlug || undefined,
                          );
                          return (
                            <InstantLink
                              href={swatchHref}
                              key={optionSlug || option?.name}
                              pendingVariant="text"
                              // The link is the whole target. It used to wrap a
                              // `<button>` carrying the same click — invalid
                              // markup, two axe `target-size` failures per dot,
                              // and two tab stops. `group` is what lets the dot
                              // draw the hover ring the button drew.
                              className="group inline-flex h-6 w-6 items-center justify-center"
                              aria-label={option?.name ?? ""}
                              // The tooltip the `<button>` carried.
                              title={option?.name ?? ""}
                              prefetch={
                                optionSlug.length > 0 &&
                                armedSwatches.has(optionSlug)
                                  ? true
                                  : false
                              }
                              onMouseEnter={() => armSwatch(optionSlug)}
                              // Kept from the button this replaced: a click
                              // navigates to the colourway, and the preview
                              // swap keeps the card correct for the frame
                              // before the navigation lands.
                              onClick={() =>
                                setColourSelected(optionSlug || null)
                              }
                            >
                              <SwatchDot
                                label={option?.name ?? ""}
                                isSelected={colourSelected === optionSlug}
                                color1={option?.swatchColor ?? undefined}
                                color2={option?.swatchColor2 ?? undefined}
                                imageSrc={option?.swatchImage ?? undefined}
                              />
                            </InstantLink>
                          );
                        })}
                      </div>
                      {extra > 0 && (
                        // Straight to the card's OWN destination — the product
                        // page, where the full colourway set already lives. No
                        // disclosure to build, no new state, and no new product
                        // question: it is the same `href` the image and the
                        // title use, so the chip cannot send a shopper anywhere
                        // the card did not already offer. Sized to the same
                        // 24 px floor as the dots, and a link, so Tab reaches
                        // it and Enter follows it.
                        <InstantLink
                          href={href}
                          pendingVariant="text"
                          className="-my-0.5 inline-flex h-6 min-w-6 items-center justify-center text-xs font-medium leading-none text-gray-800 hover:text-primary"
                          aria-label={`${extra} more colours`}
                        >
                          +{extra}
                        </InstantLink>
                      )}
                    </Fragment>
                  );
                })}
            </div>
          </div>

          <div className="flex justify-between shrink-0">
            <ProductPrice
              price={displayPrice}
              regularPrice={displayRegularPrice}
              onSale={product?.onSale ?? false}
              dark={dark}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

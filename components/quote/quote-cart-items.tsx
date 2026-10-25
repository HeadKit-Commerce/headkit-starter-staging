"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { XIcon } from "@/components/icon";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { resolveCartItemPath } from "@/lib/cart-item-path";
import {
  getCartAction,
  removeCartItemAction,
  updateCartItemAction,
} from "@/lib/cart-actions";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { QuantityStepper } from "@/components/headkit-ui/quantity-stepper";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { markShopperRemovedLine } from "@/lib/shopper-cart-edit";
import {
  GiftCardDetails,
  type GiftCardDisplay,
} from "@/components/checkout/gift-card-details";

export type QuoteLineItem = {
  key: string;
  name: string;
  slug?: string | null;
  quantity: number;
  stockStatus?: string | null;
  stockQuantity?: number | null;
  images: Array<{ src?: string | null; alt?: string | null }>;
  variation?: Array<{ attribute: string; value: string }>;
  giftCard?: GiftCardDisplay | null;
};

type QuoteCartItemProps = {
  item: QuoteLineItem;
  showQuantityControls: boolean;
};

function QuoteCartItem({
  item,
  showQuantityControls,
}: QuoteCartItemProps): React.ReactElement {
  const [quantity, setQuantity] = useState(item.quantity);
  const {
    setCartData,
    toggleCart,
    isPending: loading,
    optimisticRemoveItem,
    optimisticUpdateQuantity,
    startCartTransition,
  } = useCartContext();

  useEffect(() => {
    setQuantity(item.quantity);
  }, [item.quantity]);

  const [canonicalHref, setCanonicalHref] = useState<string | null>(null);

  useEffect(() => {
    setCanonicalHref(null);
    const slug = item.slug;
    if (!slug) return;
    let cancelled = false;
    resolveCartItemPath(slug).then((path) => {
      if (!cancelled && path) setCanonicalHref(path);
    });
    return () => {
      cancelled = true;
    };
  }, [item.slug]);

  const isOutOfStock = item.stockStatus?.toLowerCase() === "outofstock";
  const isOnBackorder = item.stockStatus?.toLowerCase() === "onbackorder";
  const maxStock =
    !isOnBackorder && item.stockQuantity != null ? item.stockQuantity : null;

  const commitQuantity = (updated: number): void => {
    setQuantity(updated);
    startCartTransition(async () => {
      optimisticUpdateQuantity(item.key, updated);
      const result = await updateCartItemAction(item.key, updated);
      if (result.success) {
        setCartData(result.cart);
        return;
      }
      const cart = await getCartAction();
      if (cart) setCartData(cart);
      else setQuantity(item.quantity);
    });
  };

  const handleRemove = (): void => {
    markShopperRemovedLine(item.key);
    startCartTransition(async () => {
      optimisticRemoveItem(item.key);
      const result = await removeCartItemAction(item.key);
      if (result.success) {
        setCartData(result.cart);
        return;
      }
      const cart = await getCartAction();
      if (cart) setCartData(cart);
    });
  };

  const displayName = stripTitleMarkers(decodeHtmlEntities(item.name));
  const imageSrc = item.images[0]?.src ?? "/assets/HeadKit-Fallback.png";
  const imageAlt = stripTitleMarkers(
    decodeHtmlEntities(item.images[0]?.alt ?? item.name),
  );
  // The cart fragment selects a slug and no permalink, so this component
  // cannot build the canonical `/shop/{cat…}/{slug}` path
  // (`lib/canonical-path.ts`) from `item` alone (G23).
  // `resolveCartItemPath` (`lib/cart-item-path.ts`) looks the product up by
  // slug through the same cache the PDP routes read and resolves the real
  // canonical without an SDK/schema change; until that resolves (or if it
  // misses), this falls back to the flat `/products/{slug}` guess, which
  // still reaches the product via the 308. That fallback matters here more
  // than on the drawer: `app/quote/page.tsx` server-renders a populated cart
  // (short-circuiting to `<QuoteEmpty />` only when it's empty), so this can
  // put the flat guess into crawlable HTML for the brief window before the
  // client resolves the canonical.
  const productHref =
    canonicalHref ?? (item.slug ? `/products/${item.slug}` : null);
  const variation = item.variation ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex gap-4 md:gap-5">
        {productHref ? (
          <InstantLink
            href={productHref}
            onClick={() => toggleCart(false)}
            className="relative h-[120px] w-[120px] shrink-0 overflow-hidden rounded-[3px] bg-white md:h-[140px] md:w-[140px]"
          >
            <Image
              src={imageSrc}
              fill
              className="absolute left-0 top-0 h-full w-full object-contain"
              alt={imageAlt}
              quality={50}
              sizes="140px"
            />
          </InstantLink>
        ) : (
          <div className="relative h-[120px] w-[120px] shrink-0 overflow-hidden rounded-[3px] bg-white md:h-[140px] md:w-[140px]">
            <Image
              src={imageSrc}
              fill
              className="absolute left-0 top-0 h-full w-full object-contain"
              alt={imageAlt}
              quality={50}
              sizes="140px"
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            {productHref ? (
              <InstantLink
                href={productHref}
                pendingVariant="text"
                onClick={() => toggleCart(false)}
                className="line-clamp-2 text-base font-semibold capitalize text-[#343A40] hover:underline md:text-lg"
              >
                {displayName}
              </InstantLink>
            ) : (
              <p className="line-clamp-2 text-base font-semibold capitalize text-[#343A40] md:text-lg">
                {displayName}
              </p>
            )}
            {variation.length > 0 && (
              <div className="mt-1 flex flex-wrap text-sm text-[#343A40]/70">
                {variation.map((v, i) => (
                  <span key={v.attribute}>
                    {i > 0 && <span className="px-1">/</span>}
                    {decodeHtmlEntities(v.value)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {showQuantityControls ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <QuantityStepper
                value={quantity}
                min={1}
                max={isOutOfStock ? quantity : maxStock}
                disabled={loading || isOutOfStock}
                onChange={commitQuantity}
                onDecrement={() => commitQuantity(Math.max(1, quantity - 1))}
                onIncrement={() => {
                  const next = quantity + 1;
                  commitQuantity(
                    maxStock != null ? Math.min(maxStock, next) : next,
                  );
                }}
              />

              <button
                type="button"
                onClick={handleRemove}
                className={cn(
                  "relative z-10 -m-3 cursor-pointer border-none bg-transparent p-3 shadow-none outline-none ring-0 appearance-none hover:opacity-70 focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                  loading && "cursor-not-allowed opacity-40",
                )}
                disabled={loading}
                aria-label="Remove item"
              >
                <XIcon className="h-4 w-4 text-pink-500" />
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#343A40]/70">Qty {quantity}</p>
          )}
        </div>
      </div>

      {item.giftCard ? <GiftCardDetails giftCard={item.giftCard} /> : null}
    </div>
  );
}

export type QuoteCartItemsProps = {
  items: QuoteLineItem[];
  /** When true, show PDP-style qty controls (checkout). Confirmation leaves this off. */
  showQuantityControls?: boolean;
};

/**
 * Quote line items — image plate only (no card chrome), matching cart/PLP tiles.
 */
export function QuoteCartItems({
  items,
  showQuantityControls = false,
}: QuoteCartItemsProps): React.ReactElement {
  return (
    <div className="space-y-5">
      {items.map((item) => (
        <QuoteCartItem
          key={item.key}
          item={item}
          showQuantityControls={showQuantityControls}
        />
      ))}
    </div>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MinusIcon, PlusIcon, XIcon } from "@/components/icon";
import { cn, decodeHtmlEntities, getFloatVal, formatPrice } from "@/lib/utils";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { lineDisplayTotal } from "@/lib/cart-prices";
import {
  buildRemoveFromCart,
  lineToGa4Item,
  pushGa4Ecommerce,
} from "@/lib/ga4-ecommerce";
import { resolveCartItemPath } from "@/lib/cart-item-path";
import {
  getCartAction,
  removeCartItemAction,
  updateCartItemAction,
} from "@/lib/cart-actions";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { GiftCardDetails } from "@/components/checkout/gift-card-details";
import { AddonDetails } from "@/components/checkout/addon-details";
import { issueForLine, lineIssueMessage } from "@/lib/cart-issues";
import { markShopperRemovedLine } from "@/lib/shopper-cart-edit";
import type { CartFieldsFragment } from "@headkit/sdk";

type CartItem = CartFieldsFragment["items"][number];

interface CartItemProps {
  item: CartItem;
  currency: { code: string };
  removeable?: boolean;
  onCartUpdate: (cart: CartFieldsFragment) => void;
}

export function CartItemRow({
  item,
  currency,
  removeable = true,
  onCartUpdate,
}: CartItemProps) {
  const [quantity, setQuantity] = useState(item.quantity);
  const {
    cartData,
    toggleCart,
    isPending: loading,
    optimisticRemoveItem,
    optimisticUpdateQuantity,
    startCartTransition,
  } = useCartContext();
  const isQuoteMode = useIsQuoteMode();

  useEffect(() => {
    setQuantity(item.quantity);
  }, [item.quantity]);

  const [canonicalHref, setCanonicalHref] = useState<string | null>(null);

  useEffect(() => {
    setCanonicalHref(null);
    if (!item.slug) return;
    let cancelled = false;
    resolveCartItemPath(item.slug).then((path) => {
      if (!cancelled && path) setCanonicalHref(path);
    });
    return () => {
      cancelled = true;
    };
  }, [item.slug]);

  const isOnSale =
    item.prices.price !== "" &&
    item.prices.regularPrice !== "" &&
    getFloatVal(item.prices.price) < getFloatVal(item.prices.regularPrice);

  const isOutOfStock = item.stockStatus?.toLowerCase() === "outofstock";
  // The store already says it will not sell this line as it stands (sold out
  // while it sat in the cart, say). Checkout is refused until it is removed or
  // reduced, so say so on the line itself — see lib/cart-issues.ts.
  const lineIssue = issueForLine(cartData, item);
  const isOnBackorder = item.stockStatus?.toLowerCase() === "onbackorder";
  const isAtStockLimit =
    !isOnBackorder &&
    item.stockQuantity != null &&
    quantity >= item.stockQuantity;

  // GA4 `remove_from_cart`. `cartData` is passed as the tax-convention source
  // so the reported price is the same tax-inclusive per-unit figure the row
  // itself renders.
  const emitRemoveFromCart = (removedQuantity: number): void => {
    if (removedQuantity <= 0) return;
    pushGa4Ecommerce(
      buildRemoveFromCart(currency.code, [
        { ...lineToGa4Item(item, cartData), quantity: removedQuantity },
      ]),
    );
  };

  const handleRemove = () => {
    markShopperRemovedLine(item.key);
    startCartTransition(async () => {
      optimisticRemoveItem(item.key);
      const result = await removeCartItemAction(item.key);
      if (result.success) {
        emitRemoveFromCart(quantity);
        // Commit server cart (including empty) so badge/drawer refresh when the
        // last line item is removed.
        onCartUpdate(result.cart);
        return;
      }
      const cart = await getCartAction();
      if (cart) onCartUpdate(cart);
    });
  };

  const handleDecrement = async () => {
    if (quantity === 1) {
      handleRemove();
      return;
    }
    const updated = quantity - 1;
    setQuantity(updated);
    startCartTransition(async () => {
      optimisticUpdateQuantity(item.key, updated);
      const result = await updateCartItemAction(item.key, updated);
      if (result.success) {
        // A decrement removes one unit; the quantity-1 case above delegates to
        // handleRemove, so this never double-reports a full-line removal.
        emitRemoveFromCart(1);
        onCartUpdate(result.cart);
        return;
      }
      const cart = await getCartAction();
      if (cart) onCartUpdate(cart);
      else setQuantity(item.quantity);
    });
  };

  const handleIncrement = async () => {
    const updated = quantity + 1;
    setQuantity(updated);
    startCartTransition(async () => {
      optimisticUpdateQuantity(item.key, updated);
      const result = await updateCartItemAction(item.key, updated);
      if (result.success) {
        onCartUpdate(result.cart);
        return;
      }
      const cart = await getCartAction();
      if (cart) onCartUpdate(cart);
      else setQuantity(item.quantity);
    });
  };

  const displayName = stripTitleMarkers(decodeHtmlEntities(item.name));
  const imageSrc = item.images[0]?.src ?? "/assets/HeadKit-Fallback.png";
  const imageAlt = stripTitleMarkers(
    decodeHtmlEntities(item.images[0]?.alt ?? item.name),
  );
  // The cart fragment selects a slug and no permalink, so this component
  // cannot build the canonical `/shop/{cat…}/{slug}` path (`lib/canonical-path.ts`)
  // from `item` alone (G23). `resolveCartItemPath` (`lib/cart-item-path.ts`)
  // looks the product up by slug through the same cache the PDP routes read
  // and resolves the real canonical without an SDK/schema change; until that
  // resolves (or if it misses), this falls back to the flat `/products/{slug}`
  // guess, which still reaches the product via the 308.
  const productHref =
    canonicalHref ?? (item.slug ? `/products/${item.slug}` : null);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-3">
        {/* Product image */}
        {productHref ? (
          <InstantLink
            href={productHref}
            onClick={() => toggleCart(false)}
            className="relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-[3px] bg-white"
          >
            <Image
              src={imageSrc}
              fill
              className="absolute left-0 top-0 h-full w-full object-contain"
              alt={imageAlt}
              quality={50}
              sizes="100px"
            />
          </InstantLink>
        ) : (
          <div className="relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-[3px] bg-white">
            <Image
              src={imageSrc}
              fill
              className="absolute left-0 top-0 h-full w-full object-contain"
              alt={imageAlt}
              quality={50}
              sizes="100px"
            />
          </div>
        )}

        {/* Product info */}
        <div className="flex min-w-0 flex-1 flex-col justify-between px-2 md:px-5">
          <div>
            {productHref ? (
              <InstantLink
                href={productHref}
                pendingVariant="text"
                onClick={() => toggleCart(false)}
                className="line-clamp-2 font-semibold capitalize text-[#343A40] hover:underline"
              >
                {displayName}
              </InstantLink>
            ) : (
              <p className="line-clamp-2 font-semibold capitalize text-[#343A40]">
                {displayName}
              </p>
            )}
            {item.variation.length > 0 && (
              <div className="mt-0.5 flex flex-wrap leading-[22px]">
                {item.variation.map((v, i) => (
                  <p
                    key={v.attribute}
                    className="text-sm capitalize text-[#343A40]"
                  >
                    {i > 0 && <span className="px-1">/</span>}
                    {decodeHtmlEntities(v.value)}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-3">
            <button
              type="button"
              className={cn(
                "flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-0 shadow-none outline-none ring-0 appearance-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                loading && "cursor-not-allowed opacity-40",
              )}
              onClick={handleDecrement}
              disabled={loading}
              aria-label="Decrease quantity"
            >
              <MinusIcon className="h-4 w-4 text-primary" />
            </button>
            <span className="min-w-6 text-center font-medium text-primary tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              className={cn(
                "flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-0 shadow-none outline-none ring-0 appearance-none hover:opacity-70 focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                (loading || isAtStockLimit || isOutOfStock) &&
                  "cursor-not-allowed opacity-40",
              )}
              onClick={handleIncrement}
              disabled={loading || isAtStockLimit || isOutOfStock}
              aria-label="Increase quantity"
            >
              <PlusIcon className="h-4 w-4 text-primary" />
            </button>
          </div>
        </div>

        {/* Price + remove */}
        <div className="flex shrink-0 flex-col items-end justify-between">
          {!isQuoteMode && (
            <div className="flex flex-col items-end">
              {isOnSale && (
                <p className="font-medium line-through">
                  {formatPrice(
                    getFloatVal(item.prices.regularPrice) * quantity,
                    currency.code,
                  )}
                </p>
              )}
              <p className={cn("font-medium", isOnSale && "text-pink-600")}>
                {formatPrice(
                  lineDisplayTotal(item.totals, null, cartData),
                  currency.code,
                )}
              </p>
            </div>
          )}

          {removeable && (
            <button
              type="button"
              onClick={handleRemove}
              className={cn(
                // p-3/-m-3 grows the tap target to ~40px (WCAG/HIG) without
                // shifting the 16px icon's visual position (F8).
                "-m-3 cursor-pointer border-none bg-transparent p-3 shadow-none outline-none ring-0 appearance-none hover:opacity-70 focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                loading && "cursor-not-allowed opacity-40",
                isQuoteMode && "mt-auto",
              )}
              disabled={loading}
              aria-label="Remove item"
            >
              <XIcon className="h-4 w-4 text-pink-500" />
            </button>
          )}
        </div>
      </div>
      {lineIssue && (
        <div
          role="alert"
          data-testid="cart-item-unavailable"
          className="flex items-center justify-between gap-3 rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span>{lineIssueMessage(lineIssue)}</span>
          {removeable && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={loading}
              className="shrink-0 cursor-pointer font-semibold underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {item.giftCard && <GiftCardDetails giftCard={item.giftCard} />}
      {/* Gift card first, add-ons second: a line can legitimately carry both,
          and this leaves the element order of a gift-card-only line untouched.
          The guard is a length test, not a null guard — the schema types
          `addons` as a non-null list with an empty default (D-14.1-04), so
          optional chaining here would assert a contract the schema forbids.
          AddonDetails also returns null for an empty list; the guard is here
          because "no add-ons means no element" should be legible at the mount
          point, which is where a reader looks. */}
      {item.addons.length > 0 && (
        <AddonDetails
          addons={item.addons}
          currency={currency.code}
          hidePrice={isQuoteMode}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CartItemRow } from "@/components/headkit-ui/cart-item";
import { CartDrawerExtras } from "@/components/headkit-ui/cart-drawer-extras";
import { CartDrawerRegions } from "@/components/headkit-ui/cart-drawer-regions";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { getCartAction, updateCartAttributesAction } from "@/lib/cart-actions";
import {
  attributeValue,
  clampGiftMessage,
  enqueueCartAttributeWrite,
  flushCartAttributeWrites,
  GIFT_MESSAGE_ATTRIBUTE_KEY,
  giftMessageDraft,
  PACKAGING_ATTRIBUTE_KEY,
  packagingSelection,
} from "@/lib/cart-attributes";
import {
  hasHostedCheckout,
  hostedCheckoutUrl,
  isHostedCheckoutHref,
} from "@/lib/hosted-checkout";
import { markHostedCheckoutPending } from "@/lib/hosted-cart-sync";
import { useClientTheme } from "@/components/headkit-ui/client-theme-provider";
import { formatPrice, getStoreCurrency } from "@/lib/utils";
import { cartItemsDisplayTotal } from "@/lib/cart-prices";
import { buildViewCartFromCart, pushGa4Ecommerce } from "@/lib/ga4-ecommerce";

const GIFT_MESSAGE_DEBOUNCE_MS = 400;

export function CartDrawer() {
  const { cartData, optimisticCart, setCartData, cartOpen, toggleCart } =
    useCartContext();
  const isQuoteMode = useIsQuoteMode();
  const theme = useClientTheme();
  const packagingTheme = theme.cart?.packaging;
  const giftTheme = theme.cart?.giftMessage;
  const emptyMessage = isQuoteMode
    ? undefined
    : theme.cart?.emptyMessage?.trim();

  const [packagingOverride, setPackagingOverride] = useState<string | null>(
    null,
  );
  const [giftOverride, setGiftOverride] = useState<{
    open: boolean;
    text: string;
  } | null>(null);
  const defaultPackagingFor = useRef<string | null>(null);
  const giftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getCartAction().then((cart) => {
      if (cart) setCartData(cart);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayCart = optimisticCart ?? cartData;
  const items = displayCart?.items ?? [];
  const currency = displayCart?.currency ?? {
    code: getStoreCurrency(),
    symbol: "$",
    minorUnit: 2,
  };
  const totalPrice = cartItemsDisplayTotal(displayCart);

  // GA4 `view_cart`, once per opening of the drawer. The drawer is this
  // storefront's cart surface — there is no /cart route — so this is where the
  // container's 3 `view_cart` references have to be served from. Keyed on the
  // open flag and the line identities, so re-rendering while it is open (a
  // quantity change, an optimistic update) does not re-fire it.
  const cartOpenKey = cartOpen ? items.map((item) => item.key).join(",") : "";
  useEffect(() => {
    if (!cartOpen || !displayCart) return;
    const event = buildViewCartFromCart(displayCart, currency.code);
    if (event) pushGa4Ecommerce(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen, cartOpenKey]);
  // Shopify: leave HeadKit entirely — do not route through /checkout (skeleton
  // + blank redirect flash). WooCommerce keeps the internal Stripe checkout.
  const hostedCheckout = isQuoteMode ? null : hostedCheckoutUrl(displayCart);
  const checkoutHref = isQuoteMode ? "/quote" : (hostedCheckout ?? "/checkout");
  const checkoutIsExternal = isHostedCheckoutHref(checkoutHref);
  const showExtras =
    items.length > 0 &&
    !isQuoteMode &&
    hasHostedCheckout(displayCart) &&
    Boolean(packagingTheme || giftTheme);

  const attributes = displayCart?.attributes;
  const serverPackagingId = packagingTheme
    ? packagingSelection(attributes, packagingTheme.options)
    : "";
  const serverGift = giftMessageDraft(attributes);
  const selectedPackagingId = packagingOverride ?? serverPackagingId;
  const giftOpen = giftOverride?.open ?? serverGift.checked;
  const giftText = giftOverride?.text ?? serverGift.text;

  useEffect(() => {
    if (!showExtras || !packagingTheme || !displayCart?.token) return;
    if (attributeValue(attributes, PACKAGING_ATTRIBUTE_KEY)) return;
    if (defaultPackagingFor.current === displayCart.token) return;
    const title = packagingTheme.options[0]?.title;
    if (!title) return;
    defaultPackagingFor.current = displayCart.token;
    void enqueueCartAttributeWrite(async () => {
      const result = await updateCartAttributesAction([
        { key: PACKAGING_ATTRIBUTE_KEY, value: title },
      ]);
      if (result.success) setCartData(result.cart);
    });
  }, [showExtras, packagingTheme, displayCart?.token, attributes, setCartData]);

  function persistGift(open: boolean, text: string): void {
    const value = open ? clampGiftMessage(text) : "";
    void enqueueCartAttributeWrite(async () => {
      const result = await updateCartAttributesAction([
        { key: GIFT_MESSAGE_ATTRIBUTE_KEY, value },
      ]);
      if (result.success) setCartData(result.cart);
    });
  }

  function onPackagingChange(id: string): void {
    setPackagingOverride(id);
    const title = packagingTheme?.options.find(
      (option) => option.id === id,
    )?.title;
    if (!title) return;
    void enqueueCartAttributeWrite(async () => {
      const result = await updateCartAttributesAction([
        { key: PACKAGING_ATTRIBUTE_KEY, value: title },
      ]);
      if (result.success) setCartData(result.cart);
    });
  }

  function onGiftOpenChange(open: boolean): void {
    const text = open ? giftText : "";
    setGiftOverride({ open, text });
    if (giftTimer.current) {
      clearTimeout(giftTimer.current);
      giftTimer.current = null;
    }
    persistGift(open, text);
  }

  function onGiftTextChange(text: string): void {
    const next = clampGiftMessage(text);
    setGiftOverride({ open: true, text: next });
    if (giftTimer.current) clearTimeout(giftTimer.current);
    giftTimer.current = setTimeout(() => {
      giftTimer.current = null;
      persistGift(true, next);
    }, GIFT_MESSAGE_DEBOUNCE_MS);
  }

  async function leaveForHostedCheckout(
    event: MouseEvent<HTMLAnchorElement>,
  ): Promise<void> {
    event.preventDefault();
    if (giftTimer.current) {
      clearTimeout(giftTimer.current);
      giftTimer.current = null;
      if (giftOpen) persistGift(true, giftText);
    }
    await flushCartAttributeWrites();
    markHostedCheckoutPending();
    toggleCart(false);
    window.location.assign(checkoutHref);
  }

  const scroll =
    items.length > 0 ? (
      <div className="space-y-5 py-4">
        {items.map((item) => (
          <CartItemRow
            key={item.key}
            item={item}
            currency={currency}
            onCartUpdate={(cart) => setCartData(cart)}
          />
        ))}
      </div>
    ) : (
      <>
        {emptyMessage ? (
          <p className="mb-8">{emptyMessage}</p>
        ) : (
          <>
            <p className="mb-4">
              {isQuoteMode
                ? "No products in your quote yet."
                : "No products in your cart!"}
            </p>
            <p className="mb-8 font-medium">
              {isQuoteMode ? (
                <>
                  Browse our selection and add products to request pricing. If
                  you&apos;re not ready to build your quote please{" "}
                  <Link
                    href="/contact"
                    className="underline underline-offset-2 hover:opacity-80"
                    onClick={() => toggleCart(false)}
                  >
                    contact us
                  </Link>{" "}
                  instead.
                </>
              ) : (
                "Have a look around our selection of products to get ready for your next adventure."
              )}
            </p>
          </>
        )}
        <InstantLink href="/shop" pendingVariant="text">
          <Button
            fullWidth
            suppressHydrationWarning
            className="shadow-none focus-visible:ring-0"
            onClick={() => toggleCart(false)}
          >
            {isQuoteMode ? "Browse collections" : "Start shopping"}
          </Button>
        </InstantLink>
      </>
    );

  const footer =
    items.length > 0 ? (
      <SheetFooter className="shrink-0">
        <div className="flex w-full flex-col gap-2 bg-brand-bg">
          {!isQuoteMode && (
            <div className="flex gap-1 font-medium">
              <p className="flex flex-1 items-end">
                Shipping calculated at checkout
              </p>
              <p className="flex items-end text-xl">
                {formatPrice(totalPrice, currency.code)}
              </p>
            </div>
          )}
          {checkoutIsExternal ? (
            <a
              href={checkoutHref}
              rel="noopener noreferrer"
              onClick={(event) => {
                void leaveForHostedCheckout(event);
              }}
            >
              <Button
                fullWidth
                suppressHydrationWarning
                className="mt-3 shadow-none focus-visible:ring-0"
              >
                Checkout
              </Button>
            </a>
          ) : (
            <Link href={checkoutHref}>
              <Button
                fullWidth
                suppressHydrationWarning
                onClick={() => toggleCart(false)}
                className="mt-3 shadow-none focus-visible:ring-0"
                {...(isQuoteMode ? { rightIcon: "plus" as const } : {})}
              >
                {isQuoteMode ? "Review Quote" : "Checkout"}
              </Button>
            </Link>
          )}
        </div>
      </SheetFooter>
    ) : null;

  return (
    <Sheet open={cartOpen} onOpenChange={(open) => toggleCart(open)}>
      <SheetContent className="headkit-cart-drawer flex h-full min-h-0 flex-col overflow-hidden bg-brand-bg">
        <SheetHeader className="shrink-0">
          <SheetTitle className="mt-3 text-left">
            {isQuoteMode ? "My Quote" : "Your Bag"}
          </SheetTitle>
          <SheetDescription hidden />
        </SheetHeader>

        <CartDrawerRegions
          scroll={scroll}
          pinned={
            showExtras && theme.cart ? (
              <CartDrawerExtras
                cart={theme.cart}
                selectedPackagingId={selectedPackagingId}
                onPackagingChange={onPackagingChange}
                giftOpen={giftOpen}
                onGiftOpenChange={onGiftOpenChange}
                giftText={giftText}
                onGiftTextChange={onGiftTextChange}
              />
            ) : null
          }
          footer={footer}
        />
      </SheetContent>
    </Sheet>
  );
}

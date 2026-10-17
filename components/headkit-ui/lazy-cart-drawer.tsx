"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { getCartAction } from "@/lib/cart-actions";

const CartDrawer = dynamic(
  () =>
    import("@/components/headkit-ui/cart-drawer").then((mod) => mod.CartDrawer),
  { ssr: false },
);

/** The checkout page itself, where the cart is corrected at entry (C1). */
export function isCheckoutEntryPath(pathname: string): boolean {
  return /^\/checkout\/?$/.test(pathname);
}

/**
 * Refresh the badge without the drawer module. The drawer used to do this
 * on mount, which pulled Stripe into every page.
 *
 * Not on a /checkout load. That page corrects the cart at entry (C1) and
 * hands the corrected cart to the context itself, so this read adds nothing
 * there and races it twice over: it can read the cart BEFORE the correction
 * and land after checkout adopted it (rehearsal S2: the removed line and the
 * old total and count beside the "has been removed" alert), and because the
 * Store API mints a new Cart-Token on every read, `getCartAction` sets the
 * cart cookie — which makes Next re-render the route. While checkout is still
 * streaming that re-render replaces the first one, and the second has nothing
 * left to correct, so the shopper never sees the alert.
 */
function CartCountSync(): null {
  const { setCartData } = useCartContext();
  useEffect(() => {
    if (isCheckoutEntryPath(window.location.pathname)) return;
    getCartAction().then((cart) => {
      if (cart) setCartData(cart);
    });
  }, [setCartData]);
  return null;
}

/**
 * Stripe, line items, and checkout load the first time the cart opens.
 * The header button is `cart-trigger-button.tsx` and does not import them.
 */
export function LazyCartDrawer(): React.JSX.Element {
  const { cartOpen } = useCartContext();
  const [mounted, setMounted] = useState(false);
  if (cartOpen && !mounted) {
    setMounted(true);
  }
  return (
    <>
      <CartCountSync />
      {mounted ? <CartDrawer /> : null}
    </>
  );
}

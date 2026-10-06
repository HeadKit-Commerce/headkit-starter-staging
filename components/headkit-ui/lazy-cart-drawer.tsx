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

/**
 * Refresh the badge without the drawer module. The drawer used to do this
 * on mount, which pulled Stripe into every page.
 */
function CartCountSync(): null {
  const { setCartData } = useCartContext();
  useEffect(() => {
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

"use client";

import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/icon";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { useChromeIcons } from "@/components/branding/branding-icons-provider";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";

/**
 * Cart icon that opens the drawer. This file does not import
 * `cart-drawer.tsx`, so Stripe and the bag stay out of the header bundle.
 */

/**
 * Standalone cart icon button that opens the CartDrawer.
 * Can be dropped anywhere inside a CartProvider.
 * In quote mode, renders a "My Quote" CTA with a plus icon.
 */
export function CartTriggerButton({
  initialCartCount = 0,
}: {
  initialCartCount?: number;
}) {
  const { cartData, optimisticCart, toggleCart } = useCartContext();
  const { Cart } = useChromeIcons();
  const isQuoteMode = useIsQuoteMode();
  const count = (optimisticCart ?? cartData)?.itemsCount ?? initialCartCount;

  if (isQuoteMode) {
    return (
      <Button
        variant="default"
        size="sm"
        aria-label="My Quote"
        className="relative h-9 gap-1.5 pl-[10px] pr-3"
        onClick={() => toggleCart(true)}
      >
        <span>My Quote</span>
        <PlusIcon className="h-4 w-4" />
        {count > 0 && (
          <span className="headkit-badge-cart absolute -right-1 -top-1 z-10 h-[14px] min-w-[14px] rounded-full bg-brand-bg text-center text-[10px] font-medium leading-[14px] text-primary px-0.5">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cart"
      className="relative h-9 w-9 justify-end pr-0"
      onClick={() => toggleCart(true)}
    >
      <Cart className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
      {count > 0 && (
        <span className="headkit-badge-cart absolute right-0 top-[10px] z-10 h-[14px] min-w-[14px] rounded-full bg-primary text-center text-[10px] font-medium leading-[14px] text-white px-0.5">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Button>
  );
}

"use client";

import type { CartFieldsFragment } from "@headkit/sdk";
import { Cart } from "@/components/checkout/cart";
import { CheckoutFormSkeleton } from "@/components/checkout/checkout-form-skeleton";
import { CheckoutPaymentIcons } from "@/components/checkout/checkout-payment-icons";
import { cartItemsDisplayTotal } from "@/lib/cart-prices";
import { formatPrice } from "@/lib/utils";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { useEffect } from "react";

interface Props {
  /**
   * Server-validated cart for this navigation. Adopted into cart context so
   * the live form inherits it, and rendered immediately (does not wait on
   * context hydration).
   */
  cart: CartFieldsFragment;
}

/**
 * Checkout chrome while the Stripe session is still minting: real order
 * summary + known step titles. Replaces a full-page skeleton so the shopper
 * lands on something that already looks like checkout.
 */
export function CheckoutPendingShell({ cart }: Props): React.ReactElement {
  const { setCartData } = useCartContext();
  const currency = cart.currency?.code ?? "AUD";
  const itemCount = cart.itemsCount ?? cart.items?.length ?? 0;
  const mobileTotal = formatPrice(cartItemsDisplayTotal(cart), currency);

  useEffect(() => {
    setCartData(cart);
  }, [cart, setCartData]);

  return (
    <div className="headkit-checkout min-h-[700px] py-10">
      <div className="mx-auto grid grid-cols-12 gap-[20px] px-[20px] md:px-[40px]">
        <div className="order-2 col-span-12 md:order-1 md:col-span-6">
          <CheckoutFormSkeleton />
        </div>
        <div className="order-1 col-span-12 md:order-2 md:col-span-6 md:col-start-7 lg:col-span-5 lg:col-start-8">
          <div className="border-y border-[#d6d6d6] px-5 py-[17px] md:border-0 md:px-0 md:py-0">
            <div className="mb-5 flex justify-between md:hidden">
              <span className="font-medium">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              <span className="font-medium">{mobileTotal}</span>
            </div>
            <Cart cart={cart} showDisplayShipping={true} hideCoupon={true} />
            <CheckoutPaymentIcons />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Route `loading.tsx` shell: step titles + whatever the cart drawer already
 * holds (client navigations). No server cart read — that would race the page.
 */
export function CheckoutLoadingShell(): React.ReactElement {
  const { cartData } = useCartContext();

  return (
    <div className="bg-brand-bg">
      <div className="headkit-checkout min-h-[700px] py-10">
        <div className="mx-auto grid grid-cols-12 gap-[20px] px-[20px] md:px-[40px]">
          <div className="order-2 col-span-12 md:order-1 md:col-span-6">
            <CheckoutFormSkeleton />
          </div>
          <div className="order-1 col-span-12 md:order-2 md:col-span-6 md:col-start-7 lg:col-span-5 lg:col-start-8">
            <div className="border-y border-[#d6d6d6] px-5 py-[17px] md:border-0 md:px-0 md:py-0">
              {cartData ? (
                <>
                  <Cart
                    cart={cartData as CartFieldsFragment}
                    showDisplayShipping={true}
                    hideCoupon={true}
                  />
                  <CheckoutPaymentIcons />
                </>
              ) : (
                <CheckoutOrderSummaryPlaceholder />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutOrderSummaryPlaceholder(): React.ReactElement {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="flex gap-3">
        <div className="h-20 w-20 shrink-0 rounded-md bg-gray-100" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 w-3/4 rounded bg-gray-100" />
          <div className="h-4 w-1/2 rounded bg-gray-100" />
        </div>
      </div>
      <div className="space-y-2 pt-4">
        <div className="flex justify-between text-sm font-medium text-gray-400">
          <span>Subtotal</span>
          <span>—</span>
        </div>
        <div className="flex justify-between text-sm font-medium text-gray-400">
          <span>Shipping</span>
          <span>Calculated at next step</span>
        </div>
        <div className="mt-5 flex justify-between text-xl font-medium text-gray-400">
          <span>Total</span>
          <span>—</span>
        </div>
      </div>
      <CheckoutPaymentIcons />
    </div>
  );
}

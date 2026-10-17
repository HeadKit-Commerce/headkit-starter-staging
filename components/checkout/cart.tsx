"use client";

import type { CartFieldsFragment } from "@headkit/sdk";
import { CouponBox } from "@/components/checkout/coupon-box";
import { LineItemDisplay } from "@/components/checkout/line-item-display";
import {
  cartDiscountDisplayTotal,
  cartItemsDisplayTotal,
  lineDisplayTotal,
  shippingDisplayTotal,
} from "@/lib/cart-prices";
import { getFloatVal, formatPrice } from "@/lib/utils";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { PaymentMethodMessaging } from "@/components/stripe/payment-messaging";

/**
 * What the BNPL badge needs to decide whether it can render. Absent (the
 * offline-gateway summary, quote mode) means no badge at all — see the render
 * site below.
 */
export interface CartBnplMessaging {
  /**
   * From the CHECKOUT SESSION, not `getStripeConfig()`. The session's key is
   * the one the shopper is actually paying through, so it is the one whose
   * account's BNPL providers the badge must describe.
   */
  publishableKey: string;
  stripeAccountId?: string | null;
  /** Commerce's `bnplMessagingEnabled` (see `lib/stripe-config.ts`). */
  enabled: boolean;
}

interface Props {
  showDisplayShipping?: boolean;
  /** Omit to render no BNPL badge (see {@link CartBnplMessaging}). */
  bnpl?: CartBnplMessaging;
}

const Cart = ({ showDisplayShipping, bnpl }: Props) => {
  const { cartData } = useCartContext();
  const isQuoteMode = useIsQuoteMode();

  if (!cartData) return null;

  const currency = cartData.currency.code;

  const shippingCost = shippingDisplayTotal(cartData);

  const discount = cartDiscountDisplayTotal(cartData);

  const calculateShipping = () => {
    if (!showDisplayShipping) {
      return (
        <span className="font-normal text-base">Calculated at next step</span>
      );
    }
    return shippingCost === 0 ? "Free" : formatPrice(shippingCost, currency);
  };

  // The figure the Total row prints, as a number. Shared with the BNPL badge
  // below so the two can never quote different amounts.
  const totalForDisplay = showDisplayShipping
    ? getFloatVal(cartData.totals.totalPrice)
    : getFloatVal(cartData.totals.totalPrice) - shippingCost;

  const calculateTotal = () => formatPrice(totalForDisplay, currency);

  return (
    <div>
      {/* Cart items */}
      <div className="space-y-[20px]">
        {cartData.items.map((item, i) => (
          <LineItemDisplay
            key={i}
            name={item.name}
            images={item.images}
            variation={item.variation ?? []}
            quantity={item.quantity}
            lineTotal={lineDisplayTotal(item.totals, null, cartData)}
            currency={currency}
            giftCard={item.giftCard ?? null}
            addons={item.addons}
            hideLineTotal={isQuoteMode}
            hideAddonPrices={isQuoteMode}
          />
        ))}
      </div>

      {!isQuoteMode && (
        <>
          {/* Unified coupon / gift-card redemption. One input discriminates on the
              gift-card format; applying either re-syncs the Stripe session amount
              via the shared checkout-actions context. */}
          <div className="mt-[32px] mb-[20px] space-y-[16px]">
            <CouponBox cart={cartData as CartFieldsFragment} />
          </div>

          {/* Totals. Subtotal, Discount and Shipping are all tax-INCLUSIVE, so
              they reconcile against the inclusive line rows above and the
              inclusive Total below; the tax row beneath them is informational,
              not another addend. */}
          <div className="flex justify-between font-medium">
            <p>Subtotal</p>
            <p>{formatPrice(cartItemsDisplayTotal(cartData), currency)}</p>
          </div>

          {discount > 0 && (
            <div className="flex justify-between font-medium mt-[8px]">
              <p>Discount</p>
              <p>−{formatPrice(discount, currency)}</p>
            </div>
          )}

          <div className="flex justify-between font-medium mt-[8px]">
            <p>Shipping</p>
            <p>{calculateShipping()}</p>
          </div>

          {getFloatVal(cartData.totals.totalTax) > 0 && (
            <div className="flex justify-between font-medium mt-[8px]">
              <p>Includes tax</p>
              <p>
                {formatPrice(getFloatVal(cartData.totals.totalTax), currency)}
              </p>
            </div>
          )}

          <div className="flex justify-between text-xl mt-[20px]">
            <div>
              <p className="font-medium">Total</p>
            </div>
            <div className="text-right font-medium">
              <p>{calculateTotal()}</p>
            </div>
          </div>

          {/* BNPL instalment messaging, directly under the Total it describes.
              The component already existed but had exactly one mount site in
              the repo — the PDP — so checkout showed nothing at any step, with
              the toggle on and providers live. This is that missing mount.

              Unconditional by design: `PaymentMethodMessaging` returns null
              when its own gate fails (toggle off, no `acct_`, currency Stripe
              does not accept) and, when Stripe accepts the request but the
              merchant has no BNPL provider enabled, suppresses the 9px sliver
              Stripe paints and claims no margin. An empty render here is the
              correct outcome, not a bug to design around.

              It is fed `totalForDisplay` — the same number the Total row above
              prints — because the instalment plan a shopper is offered has to
              be a division of what they are about to pay, not of a line price
              or a pre-shipping subtotal. */}
          {bnpl && (
            <div className="mt-[20px]">
              <PaymentMethodMessaging
                price={totalForDisplay}
                currency={currency}
                publishableKey={bnpl.publishableKey}
                stripeAccountId={bnpl.stripeAccountId ?? null}
                enabled={bnpl.enabled}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export { Cart };

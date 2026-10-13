import type { StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent } from "@stripe/stripe-js";
import type { CartFieldsFragment } from "@headkit/sdk";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import { hasSelectedPickupRate } from "@/lib/shipping-rates";

/**
 * Express stays mounted on every pay-capable step, including Payment.
 *
 * Express is a Payment Intents Elements instance — not Checkout Sessions —
 * so shippingaddresschange works. Click & Collect carts hide Express.
 */
export function shouldMountExpressCheckout(
  step: CheckoutFormStepEnum,
  cart?: Pick<CartFieldsFragment, "needsShipping" | "shippingRates"> | null,
): boolean {
  const stepOk =
    step === CheckoutFormStepEnum.CONTACT ||
    step === CheckoutFormStepEnum.DELIVERY_METHOD ||
    step === CheckoutFormStepEnum.ADDRESS ||
    step === CheckoutFormStepEnum.PAYMENT;
  if (!stepOk) return false;
  if (cart?.needsShipping && hasSelectedPickupRate(cart.shippingRates)) {
    return false;
  }
  return true;
}

/**
 * Whether Stripe reported at least one wallet the buyer can actually use.
 *
 * `event.paymentMethods` is an OBJECT keyed by wallet — not a list — so
 * `Boolean(event.paymentMethods)` is true even when every wallet is
 * `{ available: false }`.
 */
export function hasAvailableWallet(
  paymentMethods: StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent["paymentMethods"],
): boolean {
  return Object.values(paymentMethods ?? {}).some((m) => m?.available === true);
}

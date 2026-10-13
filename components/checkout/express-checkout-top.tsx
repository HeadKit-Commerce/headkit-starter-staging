"use client";

import type { Stripe } from "@stripe/stripe-js";
import type { CartFieldsFragment } from "@headkit/sdk";
import { ExpressCheckoutPi } from "@/components/checkout/express-checkout-pi";

export {
  shouldMountExpressCheckout,
  hasAvailableWallet,
} from "@/components/checkout/express-checkout-mount";

export function ExpressCheckoutTop({
  stripePromise,
  cart,
}: {
  stripePromise: Promise<Stripe | null>;
  cart: Pick<
    CartFieldsFragment,
    "needsShipping" | "shippingRates" | "totals" | "currency"
  >;
}): React.ReactElement {
  return <ExpressCheckoutPi stripePromise={stripePromise} cart={cart} />;
}

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Elements,
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type {
  Stripe,
  StripeElementsOptions,
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementOptions,
  StripeExpressCheckoutElementShippingAddressChangeEvent,
  StripeExpressCheckoutElementShippingRateChangeEvent,
} from "@stripe/stripe-js";
import type { CartFieldsFragment } from "@headkit/sdk";
import { useRouter } from "next/navigation";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import {
  selectShippingAction,
  updateCustomerAddressAction,
} from "@/lib/cart-actions";
import {
  createPaymentIntentAction,
  processCheckoutAction,
  releaseCheckoutStockAction,
} from "@/app/checkout/actions";
import { useStockRefusal } from "@/components/checkout/stock-alerts";
import { paymentIntentIdFromClientSecret } from "@/lib/stock-hold";
import { hasSelectedPickupRate } from "@/lib/shipping-rates";
import {
  decodeExpressShippingRateId,
  expressPiAmountFromCart,
  expressSheetDestination,
  expressShippingRatesFromCart,
} from "@/lib/express-pi-shipping";
import { buildCheckoutAppearance } from "@/lib/stripe-appearance";

function hasAvailableWallet(
  paymentMethods:
    | {
        link?: { available: boolean };
        applePay?: { available: boolean };
        googlePay?: { available: boolean };
        paypal?: { available: boolean };
        amazonPay?: { available: boolean };
        klarna?: { available: boolean };
        [key: string]: { available: boolean } | undefined;
      }
    | undefined,
): boolean {
  return Object.values(paymentMethods ?? {}).some((m) => m?.available === true);
}

/**
 * Payment Intents Express Checkout Element — shippingaddresschange /
 * shippingratechange update the Woo cart and the Elements amount before the
 * buyer authorises. Checkout Sessions Express cannot do this; Payment Element
 * stays on Checkout Sessions elsewhere on the page.
 */

type CartLike = Pick<
  CartFieldsFragment,
  "needsShipping" | "shippingRates" | "totals" | "currency"
>;

function ExpressCheckoutPiInner({
  cartNeedsShipping,
}: {
  cartNeedsShipping: boolean;
}): React.ReactElement {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const { cartData, setCartData } = useCartContext();
  const handleStockRefusal = useStockRefusal();
  const [hasWallet, setHasWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncAmountFromCart = useCallback(
    async (cart: CartLike) => {
      if (!elements) return;
      const amount = expressPiAmountFromCart(cart);
      if (amount > 0) {
        await elements.update({ amount });
      }
    },
    [elements],
  );

  const onShippingAddressChange = useCallback(
    async (event: StripeExpressCheckoutElementShippingAddressChangeEvent) => {
      const destination = expressSheetDestination({
        name: event.name,
        address: event.address,
      });
      if (!destination) {
        event.reject();
        return;
      }
      try {
        const result = await updateCustomerAddressAction(
          { shippingAddress: destination },
          { keepCheckoutSession: true },
        );
        if (!result.success || !result.cart) {
          event.reject();
          return;
        }
        setCartData(result.cart);
        const shippingRates = expressShippingRatesFromCart(result.cart);
        if (result.cart.needsShipping && shippingRates.length === 0) {
          event.reject();
          return;
        }
        await syncAmountFromCart(result.cart);
        event.resolve({
          shippingRates: shippingRates.map((r) => ({
            id: r.id,
            displayName: r.displayName,
            amount: r.amount,
          })),
        });
      } catch {
        event.reject();
      }
    },
    [setCartData, syncAmountFromCart],
  );

  const onShippingRateChange = useCallback(
    async (event: StripeExpressCheckoutElementShippingRateChangeEvent) => {
      const decoded = decodeExpressShippingRateId(event.shippingRate.id);
      if (!decoded) {
        event.reject();
        return;
      }
      try {
        const result = await selectShippingAction(
          decoded.packageId,
          decoded.rateId,
          { keepCheckoutSession: true },
        );
        if (!result.success || !result.cart) {
          event.reject();
          return;
        }
        setCartData(result.cart);
        await syncAmountFromCart(result.cart);
        event.resolve({
          shippingRates: expressShippingRatesFromCart(result.cart).map((r) => ({
            id: r.id,
            displayName: r.displayName,
            amount: r.amount,
          })),
        });
      } catch {
        event.reject();
      }
    },
    [setCartData, syncAmountFromCart],
  );

  const onConfirm = useCallback(
    async (event: StripeExpressCheckoutElementConfirmEvent) => {
      setError(null);
      if (!stripe || !elements) {
        event.paymentFailed({ reason: "fail" });
        setError("Payment is not ready. Please try again.");
        return;
      }

      if (cartNeedsShipping) {
        const destination = expressSheetDestination(event.shippingAddress);
        if (!destination) {
          event.paymentFailed({ reason: "invalid_shipping_address" });
          return;
        }
        const addrResult = await updateCustomerAddressAction(
          { shippingAddress: destination },
          { keepCheckoutSession: true },
        );
        if (!addrResult.success) {
          event.paymentFailed({ reason: "fail" });
          setError(addrResult.error || "Could not save shipping address.");
          return;
        }
        setCartData(addrResult.cart);
        if (
          expressShippingRatesFromCart(addrResult.cart).length === 0 &&
          !hasSelectedPickupRate(addrResult.cart.shippingRates)
        ) {
          event.paymentFailed({ reason: "address_unserviceable" });
          return;
        }
        if (event.shippingRate?.id) {
          const decoded = decodeExpressShippingRateId(event.shippingRate.id);
          if (decoded) {
            const sel = await selectShippingAction(
              decoded.packageId,
              decoded.rateId,
              { keepCheckoutSession: true },
            );
            if (sel.success && sel.cart) setCartData(sel.cart);
          }
        }
        await syncAmountFromCart(addrResult.cart);
      }

      // createPaymentIntent places the stock hold on a stock-hold store
      // (checkout plan v3 §1.2) and refuses the intent when the cart cannot be
      // held: close the sheet uncharged, correct the cart in place, alert.
      let clientSecret: string;
      try {
        const intent = await createPaymentIntentAction();
        if (!intent.ok) {
          event.paymentFailed({ reason: "fail" });
          await handleStockRefusal(intent.hold);
          return;
        }
        clientSecret = intent.clientSecret;
      } catch (err) {
        event.paymentFailed({ reason: "fail" });
        setError(
          err instanceof Error ? err.message : "Could not start payment.",
        );
        return;
      }
      const paymentIntentId = paymentIntentIdFromClientSecret(clientSecret);
      // Ask commerce to release the hold after a failed attempt. It decides on
      // the live intent, so a status this component calls "not completed"
      // (requires_action, requires_capture) keeps its hold (plan v3 §1.6).
      const releaseHold = () => {
        if (paymentIntentId) {
          void releaseCheckoutStockAction({ paymentIntentId });
        }
      };

      const { error: confirmError, paymentIntent } =
        await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: {
            return_url: `${window.location.origin}/checkout/success?express_pi=1`,
          },
          redirect: "if_required",
        });

      if (confirmError) {
        event.paymentFailed({ reason: "fail" });
        releaseHold();
        setError(confirmError.message ?? "Payment failed.");
        return;
      }

      const pi = paymentIntent;
      if (!pi || (pi.status !== "succeeded" && pi.status !== "processing")) {
        event.paymentFailed({ reason: "fail" });
        releaseHold();
        setError("Payment was not completed.");
        return;
      }

      const ship = event.shippingAddress;
      const dest = expressSheetDestination(ship);
      const billingName = event.billingDetails?.name ?? ship?.name ?? "";
      const nameParts = billingName.trim().split(/\s+/);
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts.slice(1).join(" ");

      try {
        const checkout = await processCheckoutAction({
          paymentMethod: "headkit-payments",
          billingAddress: {
            firstName,
            lastName,
            address1:
              event.billingDetails?.address?.line1 ?? dest?.address1 ?? "",
            address2:
              event.billingDetails?.address?.line2 ?? dest?.address2 ?? "",
            city: event.billingDetails?.address?.city ?? dest?.city ?? "",
            state: event.billingDetails?.address?.state ?? dest?.state ?? "",
            postcode:
              event.billingDetails?.address?.postal_code ??
              dest?.postcode ??
              "",
            country:
              event.billingDetails?.address?.country ?? dest?.country ?? "",
            email: event.billingDetails?.email ?? "",
            phone: event.billingDetails?.phone ?? "",
          },
          shippingAddress: dest
            ? {
                firstName: dest.firstName,
                lastName: dest.lastName,
                address1: dest.address1,
                address2: dest.address2,
                city: dest.city,
                state: dest.state,
                postcode: dest.postcode,
                country: dest.country,
              }
            : {
                firstName,
                lastName,
                address1: "",
                address2: "",
                city: "",
                state: "",
                postcode: "",
                country: "",
              },
          paymentData: [
            { key: "payment_intent_id", value: pi.id },
            { key: "payment_status", value: "paid" },
            { key: "payment_provider", value: "stripe" },
            {
              key: "payment_mode",
              value: pi.livemode ? "live" : "test",
            },
          ],
        });
        if (
          checkout?.orderId &&
          checkout.orderId !== "0" &&
          checkout.orderKey
        ) {
          router.push(
            `/checkout/success/${checkout.orderId}?key=${encodeURIComponent(checkout.orderKey)}`,
          );
          return;
        }
      } catch {
        /* webhook / race — fall through to generic success */
      }
      router.push(
        `/checkout/success?payment_intent=${encodeURIComponent(pi.id)}`,
      );
    },
    [
      stripe,
      elements,
      cartNeedsShipping,
      setCartData,
      syncAmountFromCart,
      router,
      handleStockRefusal,
    ],
  );

  const expressOptions = useMemo<StripeExpressCheckoutElementOptions>(() => {
    const options: StripeExpressCheckoutElementOptions = {
      paymentMethods: {
        applePay: "always",
        googlePay: "always",
        link: "auto",
      },
      emailRequired: true,
    };
    if (!cartNeedsShipping) return options;
    options.shippingAddressRequired = true;
    const rates = cartData ? expressShippingRatesFromCart(cartData) : [];
    if (rates.length > 0) {
      options.shippingRates = rates.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        amount: r.amount,
      }));
    }
    return options;
  }, [cartData, cartNeedsShipping]);

  return (
    <div data-testid="express-checkout-section">
      {hasWallet ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-brand-fg">
            Express checkout
          </p>
        </div>
      ) : null}
      <div data-testid="express-checkout">
        <ExpressCheckoutElement
          options={expressOptions}
          onConfirm={onConfirm}
          {...(cartNeedsShipping
            ? {
                onShippingAddressChange,
                onShippingRateChange,
              }
            : {})}
          onAvailablePaymentMethodsChange={(event) => {
            setHasWallet(hasAvailableWallet(event.paymentMethods));
          }}
        />
      </div>
      {hasWallet ? (
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-brand-fg/15" />
          <span className="text-xs uppercase tracking-wide text-brand-fg/50">
            Or
          </span>
          <div className="h-px flex-1 bg-brand-fg/15" />
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ExpressCheckoutPi({
  stripePromise,
  cart,
}: {
  stripePromise: Promise<Stripe | null>;
  cart: CartLike;
}): React.ReactElement | null {
  const amount = expressPiAmountFromCart(cart);
  const currency = (cart.currency?.code ?? "aud").toLowerCase();
  if (amount <= 0) return null;

  const appearance = buildCheckoutAppearance();
  const options: StripeElementsOptions = {
    mode: "payment",
    amount,
    currency,
    appearance,
    // Wallets are collected via ECE; Payment Element on CS tree hides them.
  };

  const needsShipping =
    cart.needsShipping === true && !hasSelectedPickupRate(cart.shippingRates);

  return (
    <Elements stripe={stripePromise} options={options}>
      <ExpressCheckoutPiInner cartNeedsShipping={needsShipping} />
    </Elements>
  );
}

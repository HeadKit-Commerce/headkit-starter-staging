"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartFieldsFragment } from "@headkit/sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { processCheckoutAction } from "@/app/checkout/actions";
import { EMPTY_CART } from "@/components/checkout/clear-cart";
import { clearCartTokenAction } from "@/lib/cart-actions";
import { Cart } from "@/components/checkout/cart";
import {
  offlineGateways,
  type PaymentGatewayChoice,
} from "@/lib/payment-gateways";

/**
 * Checkout for merchants who take payment OUTSIDE the storefront — bank
 * transfer, cheque, cash on delivery. WooCommerce calls these offline gateways.
 *
 * There is no payment session: the order is finalized through the same
 * `processCheckoutAction` the quote flow uses, and the merchant collects
 * payment afterwards. That is why this component owns a plain address form
 * rather than Stripe's address element — no Stripe session exists here.
 *
 * Coupons and gift cards are unaffected: they are applied to the CART, before
 * this component runs, and the finalized order carries whatever discount the
 * cart held.
 */

type BillingForm = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
};

const INITIAL_FORM: BillingForm = {
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  postcode: "",
  country: "AU",
};

export type OfflinePaymentCheckoutProps = {
  cart: CartFieldsFragment;
};

export function OfflinePaymentCheckout({
  cart,
}: OfflinePaymentCheckoutProps): React.JSX.Element {
  const router = useRouter();
  const { setCartData, toggleCart } = useCartContext();

  const gateways = useMemo<PaymentGatewayChoice[]>(
    () => offlineGateways(cart.paymentMethods),
    [cart.paymentMethods],
  );
  const [gatewayId, setGatewayId] = useState<string>(gateways[0]?.id ?? "");
  const [form, setForm] = useState<BillingForm>(INITIAL_FORM);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);

  const setField = useCallback((key: keyof BillingForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // WooCommerce refuses a shippable cart that has no rate selected. The offline
  // form collects an address but does not pick rates, so say so plainly instead
  // of letting the finalize fail with a REST error the shopper cannot act on.
  const hasSelectedShippingRate = (cart.shippingRates ?? []).some((pkg) =>
    (pkg?.shippingRates ?? []).some((rate) => rate?.selected),
  );
  const shippingBlocked = cart.needsShipping && !hasSelectedShippingRate;

  const placeOrder = useCallback(async () => {
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim()]),
    ) as BillingForm;

    if (!gatewayId) {
      setErrorMessage("Please choose a payment method.");
      return;
    }
    if (!trimmed.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      setErrorMessage("Please enter a valid email address for your order.");
      return;
    }
    if (
      !trimmed.firstName ||
      !trimmed.lastName ||
      !trimmed.address1 ||
      !trimmed.city ||
      !trimmed.state ||
      !trimmed.postcode
    ) {
      setErrorMessage(
        "Please complete your name and address — WooCommerce requires them to place an order.",
      );
      return;
    }

    setIsPlacing(true);
    setErrorMessage("");
    try {
      const address = {
        firstName: trimmed.firstName,
        lastName: trimmed.lastName,
        address1: trimmed.address1,
        address2: trimmed.address2,
        city: trimmed.city,
        state: trimmed.state.toUpperCase(),
        postcode: trimmed.postcode,
        country: trimmed.country.toUpperCase(),
        email: trimmed.email,
        phone: trimmed.phone,
      };

      const order = await processCheckoutAction({
        paymentMethod: gatewayId,
        billingAddress: address,
        shippingAddress: address,
      });

      const orderId = order.orderId;
      const orderKey = order.orderKey;
      // "0" is WooCommerce's sentinel for "no order", never a real id.
      if (!orderId || !orderKey || orderId === "0") {
        throw new Error(
          "Your order was placed, but its confirmation page could not be opened. Please check your order confirmation email.",
        );
      }

      // The cart has been consumed by the finalize. Clear the UI copy and
      // rotate the token so a refetch cannot resurrect the old session.
      setCartData(EMPTY_CART);
      void clearCartTokenAction().catch(() => {});
      toggleCart(false);

      router.push(
        `/checkout/success/${encodeURIComponent(orderId)}?key=${encodeURIComponent(orderKey)}`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not place your order. Please try again.",
      );
      setIsPlacing(false);
    }
  }, [form, gatewayId, router, setCartData, toggleCart]);

  const selected = gateways.find((g) => g.id === gatewayId);

  return (
    <div className="headkit-offline-checkout min-h-[700px] py-10 px-[20px] md:px-10">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-10 md:grid-cols-2">
        <div>
          <h1 className="mb-6 text-2xl font-bold text-primary">Checkout</h1>

          {gateways.length > 1 && (
            <fieldset className="mb-6">
              <legend className="mb-2 text-sm font-medium">
                Payment method
              </legend>
              <div className="space-y-2">
                {gateways.map((gateway) => (
                  <label
                    key={gateway.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-primary px-3 py-2"
                  >
                    {/* A native radio, not `RadioGroupItem`: this row is a
                        plain `<label>` outside react-hook-form, and `accent-primary`
                        is the only lever a UA-drawn radio exposes. The ROW's
                        border is the brand edge the shared surface states —
                        see `components/ui/form-control-surface.ts`. */}
                    <input
                      type="radio"
                      className="accent-primary"
                      name="offline-gateway"
                      value={gateway.id}
                      checked={gatewayId === gateway.id}
                      onChange={() => setGatewayId(gateway.id)}
                      disabled={isPlacing}
                    />
                    <span>{gateway.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {gateways.length === 1 && selected && (
            <p className="mb-6 text-sm text-gray-600">
              Payment method:{" "}
              <span className="font-medium">{selected.label}</span>
            </p>
          )}

          <div className="mb-6 space-y-3 text-left">
            <div>
              <Label htmlFor="offline-email">Email</Label>
              <Input
                id="offline-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                disabled={isPlacing}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="offline-first-name">First name</Label>
                <Input
                  id="offline-first-name"
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) => setField("firstName", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
              <div>
                <Label htmlFor="offline-last-name">Last name</Label>
                <Input
                  id="offline-last-name"
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => setField("lastName", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="offline-address1">Address line 1</Label>
              <Input
                id="offline-address1"
                autoComplete="address-line1"
                value={form.address1}
                onChange={(e) => setField("address1", e.target.value)}
                disabled={isPlacing}
              />
            </div>
            <div>
              <Label htmlFor="offline-address2">
                Address line 2 (optional)
              </Label>
              <Input
                id="offline-address2"
                autoComplete="address-line2"
                value={form.address2}
                onChange={(e) => setField("address2", e.target.value)}
                disabled={isPlacing}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="offline-city">City</Label>
                <Input
                  id="offline-city"
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
              <div>
                <Label htmlFor="offline-state">State</Label>
                <Input
                  id="offline-state"
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => setField("state", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="offline-postcode">Postcode</Label>
                <Input
                  id="offline-postcode"
                  autoComplete="postal-code"
                  value={form.postcode}
                  onChange={(e) => setField("postcode", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
              <div>
                <Label htmlFor="offline-country">Country</Label>
                <Input
                  id="offline-country"
                  autoComplete="country"
                  value={form.country}
                  onChange={(e) => setField("country", e.target.value)}
                  disabled={isPlacing}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="offline-phone">Phone</Label>
              <Input
                id="offline-phone"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                disabled={isPlacing}
              />
            </div>
          </div>

          {shippingBlocked && (
            <div className="mb-4 text-center text-sm text-red-500">
              Choose a delivery option in your cart before placing this order.
            </div>
          )}
          {errorMessage && (
            <div className="mb-4 text-center text-red-500">{errorMessage}</div>
          )}

          <Button
            fullWidth
            onClick={placeOrder}
            disabled={isPlacing || shippingBlocked}
          >
            {isPlacing ? "Placing order…" : "Place order"}
          </Button>
        </div>

        {/* Order summary. `Cart` carries the line items with their add-ons, the
            unified coupon / gift-card box, and the totals — the same component
            the Stripe checkout shows, so an offline shopper sees exactly what a
            card shopper sees. CouponBox reads `useCheckoutActions()`, whose
            context DEFAULTS to `{actions: null}`, so outside the Stripe provider
            it applies straight to the cart instead of re-syncing a session that
            does not exist. */}
        <div className="md:pt-[60px]">
          <Cart showDisplayShipping={true} />
        </div>
      </div>
    </div>
  );
}

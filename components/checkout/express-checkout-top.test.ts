import { describe, expect, it } from "vitest";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import {
  hasAvailableWallet,
  shouldMountExpressCheckout,
} from "./express-checkout-mount";

/**
 * The wallet-availability gate behind the "Express checkout" heading and the
 * "OR" divider.
 *
 * The case this exists for is the third one: Stripe reports the shape with
 * every wallet unavailable. The previous implementation was
 * `Boolean(event.paymentMethods)`, which is `true` for a non-empty object
 * regardless of what is in it, so that case rendered a heading and a rule
 * around a zero-height element. It is invisible on every store tested so far
 * because Link is available on all of them.
 */
describe("hasAvailableWallet", () => {
  it("is false when Stripe reports no paymentMethods at all", () => {
    expect(hasAvailableWallet(undefined)).toBe(false);
  });

  it("is false for an empty object", () => {
    expect(hasAvailableWallet({})).toBe(false);
  });

  it("is false when every reported wallet is unavailable", () => {
    // The regression case. `Boolean({...})` returns true here.
    expect(
      hasAvailableWallet({
        applePay: { available: false },
        googlePay: { available: false },
        link: { available: false },
      }),
    ).toBe(false);
  });

  it("is true when any one wallet is available", () => {
    expect(
      hasAvailableWallet({
        applePay: { available: false },
        googlePay: { available: false },
        link: { available: true },
      }),
    ).toBe(true);
  });

  it("is true when every wallet is available", () => {
    expect(
      hasAvailableWallet({
        applePay: { available: true },
        googlePay: { available: true },
      }),
    ).toBe(true);
  });

  it("ignores a wallet key present but explicitly undefined", () => {
    // Not reachable through the declared type — `exactOptionalPropertyTypes`
    // rejects an explicit `undefined` on an optional property, which is why
    // these two go through `unknown`. But the object arrives from Stripe.js
    // over the wire and the shape above is a hand-written declaration, not a
    // validator, so the optional-chain in the implementation is a real guard
    // against a real wire shape rather than dead defensiveness. Asserted here
    // so a future "simplification" to `m.available` is caught.
    const wire = (v: unknown): boolean =>
      hasAvailableWallet(v as Parameters<typeof hasAvailableWallet>[0]);

    expect(wire({ applePay: undefined, link: { available: true } })).toBe(true);
    expect(wire({ applePay: undefined })).toBe(false);
  });
});

describe("shouldMountExpressCheckout", () => {
  it("mounts on earlier steps so one-tap wallets stay available", () => {
    expect(shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT)).toBe(true);
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.DELIVERY_METHOD),
    ).toBe(true);
    expect(shouldMountExpressCheckout(CheckoutFormStepEnum.ADDRESS)).toBe(true);
  });

  it("stays mounted on Payment (Express is PI ECE; PE wallets are hidden)", () => {
    expect(shouldMountExpressCheckout(CheckoutFormStepEnum.PAYMENT)).toBe(true);
  });

  it("hides Express when Click & Collect is selected", () => {
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, {
        needsShipping: true,
        shippingRates: [
          {
            packageId: "0",
            name: "Shipping",
            shippingRates: [
              {
                rateId: "pickup_location:1",
                name: "Pickup",
                price: "0",
                taxes: "0",
                selected: true,
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});

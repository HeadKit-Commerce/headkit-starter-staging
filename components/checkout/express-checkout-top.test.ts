import { describe, expect, it, vi } from "vitest";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";

// The component statically imports two server-action modules — the
// dead-session probe and, for the confirm-time re-price, the cart action —
// and each pulls `@headkit/sdk/server` into this module graph, which does
// not resolve under vitest. Neither pure rule below touches either one;
// they are driven for real in
// `app/checkout/express-wallet-confirm.test.tsx`.
//
// The `checkout-session-status` mock is NEW and it is a FIX: without it
// this whole file failed to import, so every assertion in it — including
// the mount-gate suite that PR #273 added — had been silently unrun.
vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));
vi.mock("@/lib/cart-actions", () => ({
  updateCustomerAddressAction: vi.fn(),
}));

const { hasAvailableWallet, shouldMountExpressCheckout } =
  await import("./express-checkout-top");

/**
 * Two pure rules from `express-checkout-top.tsx`: the wallet-availability gate
 * behind the heading and the divider, and the MOUNT gate that decides whether
 * the Express element exists at all.
 *
 * WHERE THIS FILE STOPS: both are pure functions. Nothing here renders the
 * component, mounts Stripe's element, or reads a real cart — the composition
 * with the real component and the real call site is
 * `app/checkout/express-wallet-confirm.test.tsx`, and no test in this
 * repository can tap a wallet.
 *
 * The availability gate's own reasoning follows.
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
  /**
   * **This block was REVERSED on 2026-10-11, and the reversal is the point.**
   *
   * PR #273's gate required a SELECTED, PRICED DELIVERY rate before mounting.
   * It closed live order 283750 and it also hid the wallet on every
   * free-shipping cart, which was never at risk — the two states are
   * indistinguishable in the Store API payload (research
   * `261010-bs-applepay-shipping-callbacks` finding 3c). The undercharge is
   * now closed at CONFIRM instead (`walletConfirmPlan`, covered in
   * `lib/wallet-shipping.test.ts`), so the mount rule is narrow: mount unless
   * the cart is unknown or the buyer chose Click & Collect.
   *
   * Every "mounts" case below is therefore a case the previous gate refused.
   * They are kept as positive assertions rather than deleted so that
   * reinstating the old rule fails here rather than quietly costing one-tap
   * again.
   *
   * WooCommerce reports Click & Collect as an ordinary shipping rate, and this
   * store's two `pickup_location` rows are returned on EVERY cart — measured
   * on the rehearsal Store API, including on a cart with no address at all
   * (finding 3a). They are in every fixture below for that reason.
   */
  const pickupRows = [
    {
      packageId: "0",
      shippingRates: [
        {
          rateId: "pickup_location:1",
          name: "Adelaide City",
          price: "0",
          taxes: "0",
          selected: false,
        },
        {
          rateId: "pickup_location:2",
          name: "Brighton",
          price: "0",
          taxes: "0",
          selected: false,
        },
      ],
    },
  ];

  /** A cart that needs shipping, carrying exactly the rates given. */
  const shippingCart = (
    rates: (typeof pickupRows)[number]["shippingRates"],
  ) => ({
    needsShipping: true,
    shippingRates: [{ packageId: "0", shippingRates: rates }],
  });

  const deliveryRate = (
    rateId: string,
    price: string,
    selected: boolean,
    taxes = "0",
  ) => ({ rateId, name: rateId, price, taxes, selected });

  it("MOUNTS on the 283750 cart — the reversal", () => {
    // No destination, no delivery rate, nothing selected, `total_shipping` 0.
    // PR #273 refused this; the confirm path prices it from the sheet's own
    // address and refuses that attempt instead.
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, {
        needsShipping: true,
        shippingRates: pickupRows,
      }),
    ).toBe(true);
  });

  it("mounts with `city` but no `postcode`, or `postcode` but no `city`", () => {
    // Finding 3a: WooCommerce selects no delivery rate until the cart's
    // shipping address carries BOTH, so each of these carts returns exactly
    // what the no-address cart returns. The gate no longer cares; the confirm
    // path supplies the address the sheet collected.
    const cityOnly = {
      needsShipping: true,
      shippingRates: pickupRows,
      shippingAddress: {
        city: "Adelaide",
        state: "SA",
        postcode: "",
        country: "AU",
      },
    };
    const postcodeOnly = {
      needsShipping: true,
      shippingRates: pickupRows,
      shippingAddress: {
        city: "",
        state: "SA",
        postcode: "5000",
        country: "AU",
      },
    };
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, cityOnly),
    ).toBe(true);
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.ADDRESS, postcodeOnly),
    ).toBe(true);
  });

  it("mounts when a delivery rate is OFFERED but not selected", () => {
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart([
          ...pickupRows[0]!.shippingRates,
          deliveryRate("flat_rate:8", "10.91", false, "1.09"),
        ]),
      ),
    ).toBe(true);
  });

  it("mounts on a cart with a selected PAID delivery rate", () => {
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart([
          ...pickupRows[0]!.shippingRates,
          deliveryRate("flat_rate:8", "10.91", true, "1.09"),
        ]),
      ),
    ).toBe(true);
  });

  it("mounts on a cart with a selected FREE delivery rate", () => {
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart([
          ...pickupRows[0]!.shippingRates,
          deliveryRate("advanced_free_shipping", "0", true),
        ]),
      ),
    ).toBe(true);
  });

  it("does NOT mount once a pickup rate is SELECTED", () => {
    // Click & Collect stays closed — captain's decision, and under the confirm
    // path the hazard is sharper than it was: that path writes the sheet's
    // shipping address to the cart, which would convert a pickup order into a
    // delivery one. `walletConfirmPlan` refuses the same carts again.
    const selectedPickup = pickupRows[0]!.shippingRates.map((r, i) => ({
      ...r,
      selected: i === 0,
    }));
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart(selectedPickup),
      ),
    ).toBe(false);
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.CONTACT,
        shippingCart(selectedPickup),
      ),
    ).toBe(false);
  });

  it("DOES mount when the pickup rows are merely offered — the half of the old rule that was wrong", () => {
    // PR #273's gate refused this too, and its test called it "a Click &
    // Collect cart, pickup selected or not". An unselected pickup row is not a
    // pickup cart: it is every cart's starting state on this store, and
    // refusing it is exactly what hid the button for everyone.
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart(pickupRows[0]!.shippingRates),
      ),
    ).toBe(true);
  });

  it("mounts when the selected rate carries no price", () => {
    // Unpriced is not priced, so the confirm path treats it as a cart to
    // re-price. The gate does not need to know.
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        shippingCart([deliveryRate("flat_rate:8", "", true)]),
      ),
    ).toBe(true);
  });

  it("mounts from the first step on a cart that needs NO shipping", () => {
    // Gift cards / virtual products. There is no shipping to drop and nothing
    // to price.
    const noShipping = { needsShipping: false, shippingRates: [] };
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, noShipping),
    ).toBe(true);
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.PAYMENT, noShipping),
    ).toBe(true);
  });

  it("stays mounted on Payment so Express and Payment Element wallets can both show", () => {
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.PAYMENT,
        shippingCart([deliveryRate("flat_rate:8", "10.91", true, "1.09")]),
      ),
    ).toBe(true);
  });

  it("does not mount on an unknown cart", () => {
    // Fail-safe, and it is the one half of #273's gate that is unchanged: the
    // confirm path cannot price a cart it cannot read, and the cheap failure
    // is a hidden button.
    expect(shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, null)).toBe(
      false,
    );
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, undefined),
    ).toBe(false);
    expect(shouldMountExpressCheckout(CheckoutFormStepEnum.CONTACT, {})).toBe(
      false,
    );
  });

  it("never mounts on a step that cannot pay, however good the cart is", () => {
    const good = shippingCart([
      deliveryRate("flat_rate:8", "10.91", true, "1.09"),
    ]);
    const payCapable = new Set<CheckoutFormStepEnum>([
      CheckoutFormStepEnum.CONTACT,
      CheckoutFormStepEnum.DELIVERY_METHOD,
      CheckoutFormStepEnum.ADDRESS,
      CheckoutFormStepEnum.PAYMENT,
    ]);
    for (const step of Object.values(CheckoutFormStepEnum)) {
      if (payCapable.has(step)) continue;
      expect(shouldMountExpressCheckout(step, good)).toBe(false);
    }
  });
});

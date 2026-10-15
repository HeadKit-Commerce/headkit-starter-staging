import { describe, expect, it } from "vitest";
import {
  cartPricedForDelivery,
  cartRateForStripeShippingOption,
  walletConfirmPlan,
  walletConfirmRefusal,
  walletMayWriteShipping,
  walletRepriceRefusal,
  walletSheetDestination,
  walletUnserviceableRefusal,
} from "./wallet-shipping";
import { eceShippingRateId } from "./stripe-ece-shipping-preview";
import { shippingDisplayTotal } from "./cart-prices";

/**
 * The rule behind the wallet confirm gate, in isolation.
 *
 * It is a two-input truth table, and the reason it is worth its own suite is
 * that THREE of the four cells must pass the payment through: a gate that
 * refuses whenever the session reports no shipping would break every
 * free-shipping wallet order on the store, which is the majority of them. The
 * only refusing cell is the one live order 283750 landed in.
 *
 * The second block composes the real `shippingDisplayTotal` rather than
 * hand-feeding a number, because the cart input is tax-EXCLUSIVE with the tax
 * in a sibling field and reading `totalShipping` alone under-reads every
 * GST-charging store — the defect `lib/cart-prices.ts` exists for. A test that
 * passes `cartShippingCost` directly is green whichever field the component
 * reads.
 *
 * WHERE IT STOPS: it is a pure rule. It does not render, does not reach
 * Stripe, and says nothing about whether the component actually consults it —
 * `app/checkout/express-wallet-shipping.test.tsx` drives that through the real
 * `ExpressCheckoutTop`, and neither can tap a wallet.
 */
describe("walletConfirmRefusal", () => {
  it("refuses when the cart bills shipping and the session carries none", () => {
    // Order 283750: cart $12.00 delivery, session shipping_cost null.
    expect(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: null,
      }),
    ).toMatchObject({ reason: "fail" });
  });

  it("refuses a session whose shipping option is present but zero", () => {
    // The placeholder-rate shape Stripe's own docs suggest for the embedded
    // form ("an initial shipping rate of 0"). A zero option against a cart
    // that bills $12.00 is the same undercharge as no option at all.
    expect(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: 0,
      }),
    ).toMatchObject({ reason: "fail" });
  });

  it("allows a cart that bills shipping against a session that charges it", () => {
    expect(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: 1200,
      }),
    ).toBeNull();
  });

  it("allows a free-shipping cart whose session carries no shipping", () => {
    // Order 283749, the control: a wallet payment that charged correctly.
    expect(
      walletConfirmRefusal({
        cartShippingCost: 0,
        sessionShippingMinorUnits: null,
      }),
    ).toBeNull();
  });

  it("allows a free-shipping cart whose session charges shipping", () => {
    // Not a state this store produces, but refusing it would be the gate
    // inventing an amount comparison it deliberately does not make.
    expect(
      walletConfirmRefusal({
        cartShippingCost: 0,
        sessionShippingMinorUnits: 1200,
      }),
    ).toBeNull();
  });

  it("does not compare the two amounts", () => {
    // A disagreement in AMOUNT is ENG-784 mechanism 2's call, server-side,
    // where the authoritative figures and the currency divisor live. Pinning
    // this stops a later "improvement" from adding a client-side comparison
    // that refuses correct orders over a rounding difference.
    expect(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: 1,
      }),
    ).toBeNull();
  });
});

describe("the cart figure the gate is fed", () => {
  it("counts the sibling shipping tax, so a GST store is not under-read", () => {
    // WooCommerce Store API totals are tax-EXCLUSIVE. $10.91 + $1.09 GST is
    // the $12.00 delivery the shopper was quoted.
    const cart = {
      totals: { totalShipping: "10.91", totalShippingTax: "1.09" },
    };
    expect(shippingDisplayTotal(cart)).toBeCloseTo(12, 2);
    expect(
      walletConfirmRefusal({
        cartShippingCost: shippingDisplayTotal(cart),
        sessionShippingMinorUnits: null,
      }),
    ).toMatchObject({ reason: "fail" });
  });

  it("reads a genuinely free delivery as zero", () => {
    const cart = { totals: { totalShipping: "0", totalShippingTax: "0" } };
    expect(shippingDisplayTotal(cart)).toBe(0);
    expect(
      walletConfirmRefusal({
        cartShippingCost: shippingDisplayTotal(cart),
        sessionShippingMinorUnits: null,
      }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * Pricing from the sheet's own address (2c)
 * -------------------------------------------------------------------------- */

/**
 * The rules that replaced the mount gate PR #273 shipped, in isolation.
 *
 * WHERE THIS BLOCK STOPS. These are pure functions over hand-built inputs.
 * Nothing here writes a cart, re-syncs a session, renders the component, or
 * reaches Stripe or WooCommerce — the composition with the real component, the
 * real cart action and the real sync fetch is
 * `app/checkout/express-wallet-confirm.test.tsx`. Whether WooCommerce
 * actually selects a rate for a given address is a Store API claim, measured
 * in research `261010-bs-applepay-shipping-callbacks` finding 3a and not
 * re-derivable here. And no test in this repository can tap a wallet, so what
 * the sheet does with a `reason` or a `message` is a device claim.
 */
describe("walletSheetDestination", () => {
  const sheetAddress = (
    over: Partial<{
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    }> = {},
    name = "Jane Example Smith",
  ) => ({
    name,
    address: {
      line1: "1 Example St",
      line2: null,
      city: "Adelaide",
      state: "SA",
      postal_code: "5000",
      country: "AU",
      ...over,
    },
  });

  it("takes the whole address the sheet collected", () => {
    expect(walletSheetDestination(sheetAddress())).toEqual({
      firstName: "Jane",
      lastName: "Example Smith",
      address1: "1 Example St",
      address2: "",
      city: "Adelaide",
      state: "SA",
      postcode: "5000",
      country: "AU",
    });
  });

  it("refuses an address missing `city` or `postcode` — finding 3a", () => {
    // WooCommerce selects NO delivery rate until the cart's shipping address
    // carries BOTH, so writing one of them buys nothing and mutates the cart
    // for no reason.
    expect(walletSheetDestination(sheetAddress({ city: "" }))).toBeNull();
    expect(
      walletSheetDestination(sheetAddress({ postal_code: "" })),
    ).toBeNull();
    expect(walletSheetDestination(sheetAddress({ country: "" }))).toBeNull();
  });

  it("refuses an absent address, an absent `address`, and whitespace", () => {
    expect(walletSheetDestination(null)).toBeNull();
    expect(walletSheetDestination(undefined)).toBeNull();
    expect(walletSheetDestination({ name: "Jane" })).toBeNull();
    expect(walletSheetDestination(sheetAddress({ city: "   " }))).toBeNull();
  });

  it("emits every field it did not get as an explicit empty string", () => {
    // `update-customer` MERGES field by field (finding 4), so a partial write
    // composites two addresses: sending a postcode and state while omitting
    // `city` produced the destination "Sydney WA 6000", which WooCommerce
    // accepted and priced. An explicit "" clears, which makes this a replace.
    const destination = walletSheetDestination(
      sheetAddress({ line1: "", state: "" }, ""),
    );
    expect(destination).toEqual({
      firstName: "",
      lastName: "",
      address1: "",
      address2: "",
      city: "Adelaide",
      state: "",
      postcode: "5000",
      country: "AU",
    });
    // And `phone` is absent rather than blank — the sheet carries none, and
    // omitting the key is what preserves one the checkout steps already put
    // on the cart.
    expect(Object.keys(destination!)).not.toContain("phone");
    expect(Object.keys(destination!)).not.toContain("email");
  });

  it("splits a one-word name into the first name alone", () => {
    expect(walletSheetDestination(sheetAddress({}, "Prince"))).toMatchObject({
      firstName: "Prince",
      lastName: "",
    });
  });
});

describe("cartPricedForDelivery", () => {
  const pickupRow = {
    rateId: "pickup_location:1",
    name: "Adelaide City",
    price: "0",
    taxes: "0",
    selected: false,
  };
  const cart = (rates: (typeof pickupRow)[]) => ({
    needsShipping: true,
    shippingRates: [{ packageId: "0", shippingRates: rates }],
  });

  it("is false on every cart with no destination, pickup rows included", () => {
    // This store returns both Click & Collect rows on EVERY cart, so a cart
    // that looks rate-bearing can have no delivery rate at all.
    expect(cartPricedForDelivery(cart([pickupRow]))).toBe(false);
  });

  it("is false when a delivery rate is offered but not selected", () => {
    expect(
      cartPricedForDelivery(
        cart([
          pickupRow,
          {
            rateId: "flat_rate:8",
            name: "Standard",
            price: "10.91",
            taxes: "1.09",
            selected: false,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("is true on a selected PAID rate and on a selected FREE rate", () => {
    const selected = (rateId: string, price: string, taxes: string) =>
      cart([pickupRow, { rateId, name: rateId, price, taxes, selected: true }]);
    expect(
      cartPricedForDelivery(selected("flat_rate:8", "10.91", "1.09")),
    ).toBe(true);
    // A free rate is a priced rate — the `advanced_free_shipping` row an
    // over-threshold cart selects.
    expect(
      cartPricedForDelivery(selected("advanced_free_shipping", "0", "0")),
    ).toBe(true);
  });

  it("is false when the selected rate carries no price", () => {
    expect(
      cartPricedForDelivery(
        cart([
          {
            rateId: "flat_rate:8",
            name: "Standard",
            price: "",
            taxes: "",
            selected: true,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("is true on a cart that needs no shipping, and false on an unknown one", () => {
    expect(
      cartPricedForDelivery({ needsShipping: false, shippingRates: [] }),
    ).toBe(true);
    expect(cartPricedForDelivery(null)).toBe(false);
    expect(cartPricedForDelivery({})).toBe(false);
  });
});

describe("walletConfirmPlan", () => {
  const pickupRows = [
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
  ];
  const paidDelivery = {
    rateId: "flat_rate:8",
    name: "Standard Delivery",
    price: "10.91",
    taxes: "1.09",
    selected: true,
  };
  const cart = (rates: typeof pickupRows, needsShipping = true) => ({
    needsShipping,
    shippingRates: [{ packageId: "0", shippingRates: rates }],
  });
  const sheet = {
    name: "A Buyer",
    address: {
      line1: "1 Example St",
      line2: null,
      city: "Adelaide",
      state: "SA",
      postal_code: "5000",
      country: "AU",
    },
  };

  it("prices the 283750 cart from the sheet's own address", () => {
    // The state that produced the live undercharge: no destination, nothing
    // selected, session shipping null. PR #273 answered it by hiding the
    // button; this prices it and refuses the attempt.
    expect(
      walletConfirmPlan({
        cart: cart(pickupRows),
        cartShippingCost: 0,
        sessionShippingMinorUnits: null,
        sheetShippingAddress: sheet,
      }),
    ).toEqual({
      action: "price",
      destination: {
        firstName: "A",
        lastName: "Buyer",
        address1: "1 Example St",
        address2: "",
        city: "Adelaide",
        state: "SA",
        postcode: "5000",
        country: "AU",
      },
    });
  });

  it("refuses an unpriced cart when the sheet gave no usable address", () => {
    // Nothing to price from, and the address is genuinely the thing that needs
    // attention — so this is the one refusal that names it.
    for (const sheetShippingAddress of [
      undefined,
      null,
      { name: "A Buyer" },
      { ...sheet, address: { ...sheet.address, postal_code: "" } },
    ]) {
      expect(
        walletConfirmPlan({
          cart: cart(pickupRows),
          cartShippingCost: 0,
          sessionShippingMinorUnits: null,
          sheetShippingAddress,
        }),
      ).toEqual({
        action: "refuse",
        refusal: {
          reason: "invalid_shipping_address",
          message: expect.stringContaining("postcode") as unknown as string,
        },
      });
    }
  });

  it("confirms a cart already priced for delivery against a priced session", () => {
    // The path that was already correct pays no round trip: no price step.
    expect(
      walletConfirmPlan({
        cart: cart([...pickupRows, paidDelivery]),
        cartShippingCost: 12,
        sessionShippingMinorUnits: 1200,
        sheetShippingAddress: sheet,
      }),
    ).toEqual({ action: "confirm" });
  });

  it("falls through to the stage-1 floor on a DESYNCED priced cart", () => {
    // Cart carries a rate, session lost it — the measured trap that an
    // explicit rate choice does not survive an address change. The floor
    // refuses, and the plan must not "helpfully" re-price instead: the cart is
    // already priced, so there is nothing an address write would fix.
    expect(
      walletConfirmPlan({
        cart: cart([...pickupRows, paidDelivery]),
        cartShippingCost: 12,
        sessionShippingMinorUnits: null,
        sheetShippingAddress: sheet,
      }),
    ).toEqual({
      action: "refuse",
      refusal: walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: null,
      }),
    });
  });

  it("NEVER prices a Click & Collect cart", () => {
    // Writing the sheet's shipping address to a cart on which the buyer chose
    // to collect would convert a pickup order into a delivery one. The mount
    // gate keeps the element off these carts; this is the same rule at the
    // decision that would do the damage.
    const plan = walletConfirmPlan({
      cart: cart([{ ...pickupRows[0]!, selected: true }, pickupRows[1]!]),
      cartShippingCost: 0,
      sessionShippingMinorUnits: null,
      sheetShippingAddress: sheet,
    });
    expect(plan.action).toBe("refuse");
    expect(plan).not.toMatchObject({ action: "price" });
  });

  it("confirms a cart that needs no shipping, with no address in the sheet", () => {
    // Gift cards / virtual products: nothing to price, one tap as always.
    expect(
      walletConfirmPlan({
        cart: cart([], false),
        cartShippingCost: 0,
        sessionShippingMinorUnits: null,
        sheetShippingAddress: undefined,
      }),
    ).toEqual({ action: "confirm" });
  });

  it("refuses an unknown cart rather than pricing one", () => {
    for (const unknown of [null, undefined, {}]) {
      const plan = walletConfirmPlan({
        cart: unknown,
        cartShippingCost: 0,
        sessionShippingMinorUnits: null,
        sheetShippingAddress: sheet,
      });
      expect(plan.action).toBe("refuse");
    }
  });
});

describe("the refusals a re-price ends in", () => {
  it("quotes the session's own formatted total, and dismisses the sheet", () => {
    const refusal = walletRepriceRefusal("A$41.95");
    expect(refusal.message).toContain("A$41.95");
    // `fail` is what dismisses the sheet. An open sheet keeps displaying the
    // amount it was built with, so re-authorising in it after a re-price would
    // approve one figure and charge another.
    expect(refusal.reason).toBe("fail");
  });

  it("quotes NO figure when the re-sync did not land", () => {
    const refusal = walletRepriceRefusal(null);
    expect(refusal.message).not.toMatch(/\d/);
    expect(refusal.reason).toBe("fail");
    // Same text as the stage-1 floor's: the state is the same one, and the
    // buyer's next step is the same too.
    expect(refusal.message).toBe(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: null,
      })!.message,
    );
  });

  it("keeps the sheet open for a destination WooCommerce will not price", () => {
    // Correctable in place, and the amount has not moved — so unlike a
    // successful re-price this one may leave the sheet up.
    expect(walletUnserviceableRefusal()).toEqual({
      reason: "address_unserviceable",
      message: expect.stringContaining("address") as unknown as string,
    });
  });
});

/**
 * The rules the wallet sheet's own shipping events read.
 *
 * WHERE THEY STOP: pure rules again. Whether the component consults them —
 * and whether Stripe's preview calls the handlers at all — is
 * `app/checkout/express-wallet-sheet-events.test.tsx` and a device claim
 * respectively.
 */
describe("eceShippingRateId", () => {
  it("prefers `rate`, which is what Stripe.js actually sends in Checkout mode", () => {
    // Read out of the `custom-checkout` chunk:
    // `callDecider: (e) => f({rate: {id, amount, displayName}, runServerUpdate: e})`.
    expect(
      eceShippingRateId({
        rate: { id: "shr_from_checkout_mode" },
        shippingRate: { id: "shr_elements_mode_spelling" },
        runServerUpdate: async () => {},
      }),
    ).toBe("shr_from_checkout_mode");
  });

  it("falls back to `shippingRate`, the public Elements-mode spelling", () => {
    // The preview is ahead of the published types, so a rename must not become
    // "no rate id" — which would reject every rate change on every wallet.
    expect(
      eceShippingRateId({
        shippingRate: { id: "shr_express" },
        runServerUpdate: async () => {},
      }),
    ).toBe("shr_express");
  });

  it("answers null for an absent or blank id, never an empty string", () => {
    // `""` would be looked up in the mapping and could match an empty key.
    expect(eceShippingRateId({ runServerUpdate: async () => {} })).toBeNull();
    expect(
      eceShippingRateId({
        rate: { id: "  " },
        runServerUpdate: async () => {},
      }),
    ).toBeNull();
    expect(eceShippingRateId(null)).toBeNull();
  });
});

describe("cartRateForStripeShippingOption", () => {
  const packages = [
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
          rateId: "flat_rate:8",
          name: "Standard",
          price: "10.91",
          taxes: "1.09",
          selected: true,
        },
      ],
    },
  ];
  const mapping = [
    { rateId: "flat_rate:8", stripeShippingRateId: "shr_standard" },
    { rateId: "pickup_location:1", stripeShippingRateId: "shr_pickup" },
  ];

  it("resolves the cart rate AND the package it must be selected against", () => {
    // `selectShipping` takes both, and the packageId is not in the mapping —
    // it comes from the cart.
    expect(
      cartRateForStripeShippingOption(mapping, packages, "shr_standard"),
    ).toEqual({ packageId: "0", rateId: "flat_rate:8" });
  });

  it("refuses an option id in no mapping, because Stripe recreates those ids every sync", () => {
    expect(
      cartRateForStripeShippingOption(mapping, packages, "shr_from_last_sync"),
    ).toBeNull();
  });

  it("refuses a mapping row whose rate the cart no longer offers", () => {
    expect(
      cartRateForStripeShippingOption(
        [{ rateId: "flat_rate:9", stripeShippingRateId: "shr_express" }],
        packages,
        "shr_express",
      ),
    ).toBeNull();
  });

  it("refuses a PICKUP rate even when a mapping names one", () => {
    // Honouring it would convert a delivery order into a Click & Collect one
    // from inside a wallet sheet.
    expect(
      cartRateForStripeShippingOption(mapping, packages, "shr_pickup"),
    ).toBeNull();
  });

  it("refuses an absent id and an absent mapping", () => {
    expect(cartRateForStripeShippingOption(mapping, packages, null)).toBeNull();
    expect(
      cartRateForStripeShippingOption(null, packages, "shr_standard"),
    ).toBeNull();
  });
});

describe("walletMayWriteShipping", () => {
  const pickup = (selected: boolean) => ({
    needsShipping: true,
    shippingRates: [
      {
        packageId: "0",
        shippingRates: [
          {
            rateId: "pickup_location:1",
            name: "Adelaide City",
            price: "0",
            taxes: "0",
            selected,
          },
        ],
      },
    ],
  });

  it("refuses an unknown cart", () => {
    expect(walletMayWriteShipping(null)).toBe(false);
    expect(walletMayWriteShipping({})).toBe(false);
  });

  it("refuses a cart on which the buyer CHOSE Click & Collect", () => {
    expect(walletMayWriteShipping(pickup(true))).toBe(false);
  });

  it("allows a cart that merely OFFERS pickup — every cart's starting state", () => {
    // This store returns both pickup rows on every cart (finding 3a), so
    // presence says nothing and refusing it would hide the wallet's shipping
    // step for everyone.
    expect(walletMayWriteShipping(pickup(false))).toBe(true);
  });

  it("allows a cart that needs no shipping at all", () => {
    expect(walletMayWriteShipping({ needsShipping: false })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  deliveryShippingRates,
  hasSelectedPickupRate,
  isPickupRate,
  isPricedRate,
  selectedDeliveryRate,
} from "./shipping-rates";

/**
 * The pickup predicate and the delivery-rate flatten, which five surfaces used
 * to hand-write.
 *
 * The case that justifies the module is the last one: the two forms people
 * reach for are NOT equivalent. `rateId.includes("local_pickup")` matches
 * WooCommerce's real instance-suffixed id `local_pickup:3`; the `===`
 * comparison two order pages use does not, and would put a Click & Collect
 * rate into a delivery list.
 *
 * WHERE IT STOPS: pure list arithmetic. It says nothing about which rates
 * WooCommerce returns for an address, and nothing about what any caller does
 * with the list.
 */
const rate = (rateId: string, price = "10.00", selected = false) => ({
  rateId,
  name: rateId,
  price,
  taxes: "0",
  selected,
});

describe("isPickupRate", () => {
  it("matches both of WooCommerce's pickup method ids", () => {
    expect(isPickupRate("local_pickup")).toBe(true);
    expect(isPickupRate("pickup_location")).toBe(true);
  });

  it("matches an instance-suffixed id, which `===` would miss", () => {
    expect(isPickupRate("local_pickup:3")).toBe(true);
    expect(isPickupRate("pickup_location:1")).toBe(true);
  });

  it("does not match a delivery rate", () => {
    expect(isPickupRate("flat_rate:5")).toBe(false);
    expect(isPickupRate("free_shipping:2")).toBe(false);
  });
});

describe("deliveryShippingRates", () => {
  it("flattens every non-pickup rate across packages and carries the package id", () => {
    expect(
      deliveryShippingRates([
        {
          packageId: "0",
          shippingRates: [rate("flat_rate:5"), rate("local_pickup:3")],
        },
        { packageId: "1", shippingRates: [rate("free_shipping:2", "0")] },
      ]).map((r) => [r.rateId, r.packageId]),
    ).toEqual([
      ["flat_rate:5", "0"],
      ["free_shipping:2", "1"],
    ]);
  });

  it("preserves cart order, which the on-page step renders", () => {
    expect(
      deliveryShippingRates([
        {
          packageId: "0",
          shippingRates: [
            rate("express:1", "25.00"),
            rate("flat_rate:5", "10.00"),
          ],
        },
      ]).map((r) => r.rateId),
    ).toEqual(["express:1", "flat_rate:5"]);
  });

  it("is empty for a pickup-only cart", () => {
    expect(
      deliveryShippingRates([
        { packageId: "0", shippingRates: [rate("local_pickup:3")] },
      ]),
    ).toEqual([]);
  });

  it("tolerates an absent packages list", () => {
    expect(deliveryShippingRates(null)).toEqual([]);
    expect(deliveryShippingRates(undefined)).toEqual([]);
  });
});

describe("isPricedRate", () => {
  it("accepts a free rate, which is the over-threshold cart's selection", () => {
    // `advanced_free_shipping` at 0 is priced. A `price > 0` test would read
    // it as unpriced and hide the wallet on every free-shipping cart.
    expect(isPricedRate({ price: "0", taxes: "0" })).toBe(true);
    expect(isPricedRate({ price: "0.00", taxes: "0.00" })).toBe(true);
  });

  it("accepts a paid rate with its sibling tax", () => {
    expect(isPricedRate({ price: "10.91", taxes: "1.09" })).toBe(true);
  });

  it("rejects what `getFloatVal` cannot tell apart from free", () => {
    // The whole reason this predicate exists: `getFloatVal` answers 0 for all
    // three of these, so a `>= 0` check at a call site reads them as free.
    expect(isPricedRate({ price: "", taxes: "0" })).toBe(false);
    expect(isPricedRate({ price: "   ", taxes: "0" })).toBe(false);
    expect(isPricedRate({ price: "abc", taxes: "0" })).toBe(false);
  });

  it("requires the tax sibling too, since the shopper-facing cost is the sum", () => {
    expect(isPricedRate({ price: "10.91", taxes: "" })).toBe(false);
  });

  it("rejects a non-string arriving off the wire", () => {
    const wire = (v: unknown): boolean =>
      isPricedRate(v as Parameters<typeof isPricedRate>[0]);
    expect(wire({ price: null, taxes: "0" })).toBe(false);
    expect(wire({ taxes: "0" })).toBe(false);
  });
});

describe("selectedDeliveryRate", () => {
  it("is null when WooCommerce has selected nothing", () => {
    // The measured no-destination cart: pickup rows returned, nothing selected.
    expect(
      selectedDeliveryRate([
        {
          packageId: "0",
          shippingRates: [rate("pickup_location:1"), rate("pickup_location:2")],
        },
      ]),
    ).toBeNull();
  });

  it("is null when a rate is offered but not selected", () => {
    expect(
      selectedDeliveryRate([
        { packageId: "0", shippingRates: [rate("flat_rate:8", "10.91")] },
      ]),
    ).toBeNull();
  });

  it("is null when the SELECTED rate is a pickup rate", () => {
    // Click & Collect selects a real rate, and it is not a delivery rate.
    expect(
      selectedDeliveryRate([
        {
          packageId: "0",
          shippingRates: [
            rate("pickup_location:1", "0", true),
            rate("flat_rate:8", "10.91"),
          ],
        },
      ]),
    ).toBeNull();
  });

  it("returns the selected delivery rate with its package id", () => {
    const found = selectedDeliveryRate([
      {
        packageId: "0",
        shippingRates: [
          rate("pickup_location:1"),
          rate("flat_rate:8", "10.91", true),
          rate("flat_rate:10", "18.18"),
        ],
      },
    ]);
    expect(found?.rateId).toBe("flat_rate:8");
    expect(found?.packageId).toBe("0");
  });

  it("tolerates an absent packages list", () => {
    expect(selectedDeliveryRate(null)).toBeNull();
    expect(selectedDeliveryRate(undefined)).toBeNull();
  });
});

describe("hasSelectedPickupRate", () => {
  /**
   * The question the wallet mount gate asks, and it is NOT "is there no
   * delivery selection". A cart with nothing selected at all answers false
   * here and `null` from `selectedDeliveryRate` — two different states that
   * need two different answers, which is why both predicates exist.
   */
  const pickupRows = [
    {
      rateId: "pickup_location:1",
      name: "Adelaide City",
      price: "0",
      taxes: "0",
      selected: false,
    },
    {
      rateId: "local_pickup:3",
      name: "Brighton",
      price: "0",
      taxes: "0",
      selected: false,
    },
  ];
  const pkg = (rates: typeof pickupRows) => [
    { packageId: "0", shippingRates: rates },
  ];

  it("is false when the pickup rows are merely OFFERED", () => {
    // This store returns both on every cart, so presence says nothing.
    expect(hasSelectedPickupRate(pkg(pickupRows))).toBe(false);
  });

  it("is true for either pickup method id, selected", () => {
    expect(
      hasSelectedPickupRate(pkg([{ ...pickupRows[0]!, selected: true }])),
    ).toBe(true);
    expect(
      hasSelectedPickupRate(pkg([{ ...pickupRows[1]!, selected: true }])),
    ).toBe(true);
  });

  it("is false when a DELIVERY rate is the selected one", () => {
    expect(
      hasSelectedPickupRate(
        pkg([
          ...pickupRows,
          {
            rateId: "flat_rate:8",
            name: "Standard Delivery",
            price: "10.91",
            taxes: "1.09",
            selected: true,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("is false on an absent or empty list", () => {
    expect(hasSelectedPickupRate(null)).toBe(false);
    expect(hasSelectedPickupRate(undefined)).toBe(false);
    expect(hasSelectedPickupRate([])).toBe(false);
  });
});

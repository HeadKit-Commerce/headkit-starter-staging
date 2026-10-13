import { describe, expect, it } from "vitest";
import {
  decodeExpressShippingRateId,
  encodeExpressShippingRateId,
  expressPiAmountFromCart,
  expressSheetDestination,
  expressShippingRatesFromCart,
} from "./express-pi-shipping";

describe("encode/decodeExpressShippingRateId", () => {
  it("round-trips package and rate ids", () => {
    const id = encodeExpressShippingRateId("0", "flat_rate:12");
    expect(decodeExpressShippingRateId(id)).toEqual({
      packageId: "0",
      rateId: "flat_rate:12",
    });
  });

  it("returns null for malformed ids", () => {
    expect(decodeExpressShippingRateId("no-separator")).toBeNull();
    expect(decodeExpressShippingRateId("::rate")).toBeNull();
  });
});

describe("expressShippingRatesFromCart", () => {
  it("maps priced delivery rates and skips pickup", () => {
    const rates = expressShippingRatesFromCart({
      currency: { minorUnit: 2 },
      shippingRates: [
        {
          packageId: "0",
          shippingRates: [
            {
              rateId: "flat_rate:1",
              name: "Standard",
              price: "10.00",
              taxes: "1.00",
              selected: true,
            },
            {
              rateId: "local_pickup:2",
              name: "Pickup",
              price: "0",
              taxes: "0",
              selected: false,
            },
          ],
        },
      ],
    });
    expect(rates).toEqual([
      {
        id: "0::flat_rate:1",
        displayName: "Standard",
        amount: 1100,
      },
    ]);
  });
});

describe("expressPiAmountFromCart", () => {
  it("scales the major-unit totalPrice by the cart minor unit", () => {
    expect(
      expressPiAmountFromCart({
        currency: { minorUnit: 2 },
        totals: { totalPrice: "419.50" },
      }),
    ).toBe(41950);
  });

  it("defaults to two decimals when the cart reports no minor unit", () => {
    expect(expressPiAmountFromCart({ totals: { totalPrice: "419.50" } })).toBe(
      41950,
    );
  });

  it("agrees with the shipping-rate helper on units", () => {
    const cart = {
      currency: { minorUnit: 2 },
      totals: { totalPrice: "11.00" },
      shippingRates: [
        {
          packageId: "0",
          shippingRates: [
            {
              rateId: "flat_rate:1",
              name: "Standard",
              price: "10.00",
              taxes: "1.00",
              selected: true,
            },
          ],
        },
      ],
    };
    expect(expressPiAmountFromCart(cart)).toBe(
      expressShippingRatesFromCart(cart)[0]?.amount,
    );
  });

  it("does not scale a zero-decimal currency", () => {
    // JPY: the cart minor unit and the ISO minor unit are both 0, so the
    // major-unit total is already the Stripe amount.
    expect(
      expressPiAmountFromCart({
        currency: { minorUnit: 0 },
        totals: { totalPrice: "1359" },
      }),
    ).toBe(1359);
  });

  it("is zero for a missing or non-positive total", () => {
    expect(expressPiAmountFromCart({})).toBe(0);
    expect(expressPiAmountFromCart({ totals: { totalPrice: "0.00" } })).toBe(0);
  });
});

describe("expressSheetDestination", () => {
  it("requires city, postcode, and country", () => {
    expect(
      expressSheetDestination({
        name: "Ada Lovelace",
        address: { city: "Sydney", postal_code: "", country: "AU" },
      }),
    ).toBeNull();
  });

  it("splits the name and blanks omitted address fields", () => {
    expect(
      expressSheetDestination({
        name: "Ada Lovelace",
        address: {
          line1: "1 Street",
          city: "Sydney",
          postal_code: "2000",
          country: "AU",
        },
      }),
    ).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      address1: "1 Street",
      address2: "",
      city: "Sydney",
      state: "",
      postcode: "2000",
      country: "AU",
    });
  });
});

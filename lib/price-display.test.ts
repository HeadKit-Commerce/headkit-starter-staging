import { describe, it, expect } from "vitest";
import {
  getPriceDisplay,
  getVariationCardPrice,
  pickFirstPrice,
} from "@/lib/price-display";

describe("getPriceDisplay", () => {
  it("shows a real discount: regular > sale, on sale", () => {
    expect(
      getPriceDisplay({ price: "24", regularPrice: "32", onSale: true }),
    ).toEqual({ min: 24, max: null, struck: 32 });
  });

  it("suppresses the fake strikethrough when regular price is unknown (variable products)", () => {
    // F3 root cause: variable products surface regularPrice "" with onSale=true;
    // the old fallback rendered "~~$24.00~~ $24.00".
    expect(
      getPriceDisplay({ price: "24", regularPrice: "", onSale: true }),
    ).toEqual({ min: 24, max: null, struck: null });
  });

  it("suppresses the strikethrough when regular equals the sale price", () => {
    expect(
      getPriceDisplay({ price: "24", regularPrice: "24", onSale: true }),
    ).toEqual({ min: 24, max: null, struck: null });
  });

  it("suppresses the strikethrough when regular is lower than the current price", () => {
    expect(
      getPriceDisplay({ price: "24", regularPrice: "20", onSale: true }),
    ).toEqual({ min: 24, max: null, struck: null });
  });

  it("never strikes through when not on sale, even with a higher regular price", () => {
    expect(
      getPriceDisplay({ price: "24", regularPrice: "32", onSale: false }),
    ).toEqual({ min: 24, max: null, struck: null });
  });

  it("returns a range without strikethrough", () => {
    expect(
      getPriceDisplay({ price: "25 - 36", regularPrice: "", onSale: true }),
    ).toEqual({ min: 25, max: 36, struck: null });
  });

  it("handles currency symbols and undefined regular price", () => {
    expect(getPriceDisplay({ price: "$24.00", onSale: true })).toEqual({
      min: 24,
      max: null,
      struck: null,
    });
    expect(
      getPriceDisplay({
        price: "$24.00",
        regularPrice: "$32.00",
        onSale: true,
      }),
    ).toEqual({ min: 24, max: null, struck: 32 });
  });

  it("handles empty price", () => {
    expect(getPriceDisplay({ price: "", onSale: false })).toEqual({
      min: 0,
      max: null,
      struck: null,
    });
  });
});

describe("pickFirstPrice", () => {
  it('skips empty strings the way ?? cannot (gateway sends salePrice: "")', () => {
    // The P1-14 regression: selectedVariation?.price ?? salePrice ?? price
    // kept "" and rendered A$0.00 on simple non-sale PDPs.
    expect(pickFirstPrice(undefined, "", "50.00")).toBe("50.00");
  });

  it("returns the first non-empty candidate", () => {
    expect(pickFirstPrice("22.00", "29.00")).toBe("22.00");
  });

  it("skips null, undefined and whitespace-only", () => {
    expect(pickFirstPrice(null, undefined, "   ", "9.99")).toBe("9.99");
  });

  it("returns empty string when nothing usable", () => {
    expect(pickFirstPrice(null, undefined, "")).toBe("");
  });
});

describe("getVariationCardPrice", () => {
  it("returns a single price when all variations match", () => {
    expect(
      getVariationCardPrice({
        variations: [{ price: "12" }, { price: "12.00" }],
      }),
    ).toEqual({ price: "12", regularPrice: "" });
  });

  it("includes $0 variations in the range (e.g. $0 – $2.00)", () => {
    expect(
      getVariationCardPrice({
        variations: [{ price: "0" }, { price: "2" }],
      }),
    ).toEqual({ price: "0 - 2", regularPrice: "" });
  });

  it("falls back when variations have no parseable prices", () => {
    expect(
      getVariationCardPrice({
        variations: [{ price: "" }, { price: null }],
        fallbackPrice: "9.99",
        fallbackRegularPrice: "12",
      }),
    ).toEqual({ price: "9.99", regularPrice: "12" });
  });

  // The regression this suite exists to hold: a variable product's parent
  // carries `regularPrice: ""` while on sale, so a card that read only the
  // parent could never strike a was-price. Every case below is paired with
  // `getPriceDisplay`, because the card's strike is the composition of the two
  // — a regular resolved here that the display rule then refuses is not a fix.
  describe("the regular price of a variable product (card was-price)", () => {
    it("takes the regular of the min-priced variation", () => {
      const card = getVariationCardPrice({
        variations: [
          { price: "11499.00", regularPrice: "13900.00" },
          { price: "12499.00", regularPrice: "14900.00" },
        ],
        fallbackPrice: "11499.00",
        fallbackRegularPrice: "",
        onSale: true,
      });
      expect(card).toEqual({ price: "11499", regularPrice: "13900" });
      expect(getPriceDisplay({ ...card, onSale: true })).toEqual({
        min: 11499,
        max: null,
        struck: 13900,
      });
    });

    it("takes the common regular when every variation shares one", () => {
      const card = getVariationCardPrice({
        variations: [
          { price: "89.00", regularPrice: "139.00" },
          { price: "89.00", regularPrice: "139.00" },
          { price: "89.00", regularPrice: "139.00" },
        ],
        onSale: true,
      });
      expect(card).toEqual({ price: "89", regularPrice: "139" });
      expect(getPriceDisplay({ ...card, onSale: true })).toEqual({
        min: 89,
        max: null,
        struck: 139,
      });
    });

    it("invents nothing when the min-priced variation carries no regular", () => {
      // A dearer sibling's regular is NOT the card's: the card prices itself
      // from the min, so borrowing the other variation's regular would strike
      // a was-price that never applied to the figure shown.
      expect(
        getVariationCardPrice({
          variations: [
            { price: "89.00", regularPrice: "" },
            { price: "99.00", regularPrice: "139.00" },
          ],
          onSale: true,
        }),
      ).toEqual({ price: "89 - 99", regularPrice: "" });
    });

    it("prefers the discounted sibling when variations tie at the min price", () => {
      expect(
        getVariationCardPrice({
          variations: [
            { price: "89.00", regularPrice: "89.00" },
            { price: "89.00", regularPrice: "139.00" },
          ],
          onSale: true,
        }),
      ).toEqual({ price: "89", regularPrice: "139" });
    });

    it("emits no regular when none of the variations carries one", () => {
      const card = getVariationCardPrice({
        variations: [{ price: "89.00" }, { price: "89.00" }],
        onSale: true,
      });
      expect(card).toEqual({ price: "89", regularPrice: "" });
      expect(getPriceDisplay({ ...card, onSale: true }).struck).toBeNull();
    });

    // The guard the original docblock was written to answer: the client
    // reported fake "~~$24.00~~ $24.00" rows. A regular equal to (or below)
    // the current price must never strike, however it was resolved.
    it("cannot produce a fake equal-price strike", () => {
      const card = getVariationCardPrice({
        variations: [
          { price: "24.00", regularPrice: "24.00" },
          { price: "24.00", regularPrice: "24.00" },
        ],
        onSale: true,
      });
      expect(card).toEqual({ price: "24", regularPrice: "24" });
      expect(getPriceDisplay({ ...card, onSale: true })).toEqual({
        min: 24,
        max: null,
        struck: null,
      });
    });

    it("cannot strike a regular BELOW the current price", () => {
      const card = getVariationCardPrice({
        variations: [{ price: "24.00", regularPrice: "20.00" }],
        onSale: true,
      });
      expect(getPriceDisplay({ ...card, onSale: true }).struck).toBeNull();
    });

    it("collapses an on-sale range to its min-price pair", () => {
      // A card shows ONE pair, and `getPriceDisplay` refuses a strike beside
      // a range, so the min-price pair is the shape that can render.
      const card = getVariationCardPrice({
        variations: [
          { price: "89.00", regularPrice: "139.00" },
          { price: "99.00", regularPrice: "149.00" },
        ],
        onSale: true,
      });
      expect(card).toEqual({ price: "89", regularPrice: "139" });
      expect(getPriceDisplay({ ...card, onSale: true })).toEqual({
        min: 89,
        max: null,
        struck: 139,
      });
    });

    it("keeps a range intact when there is no real discount", () => {
      expect(
        getVariationCardPrice({
          variations: [
            { price: "89.00", regularPrice: "89.00" },
            { price: "99.00", regularPrice: "99.00" },
          ],
          onSale: true,
        }),
      ).toEqual({ price: "89 - 99", regularPrice: "" });
    });

    it("keeps a range intact when the product is not on sale", () => {
      expect(
        getVariationCardPrice({
          variations: [
            { price: "89.00", regularPrice: "139.00" },
            { price: "99.00", regularPrice: "149.00" },
          ],
          onSale: false,
        }),
      ).toEqual({ price: "89 - 99", regularPrice: "" });
    });

    it("leaves a non-sale single price with its regular for the display rule to refuse", () => {
      const card = getVariationCardPrice({
        variations: [{ price: "89.00", regularPrice: "139.00" }],
        onSale: false,
      });
      expect(card).toEqual({ price: "89", regularPrice: "139" });
      expect(getPriceDisplay({ ...card, onSale: false }).struck).toBeNull();
    });
  });
});

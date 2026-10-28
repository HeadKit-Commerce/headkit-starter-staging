import { describe, expect, it } from "vitest";
import {
  defaultAttributesForColour,
  pickDefaultVariation,
} from "./default-size-selection";

/**
 * Default to the first IN-STOCK size, on load and again when the colour
 * changes; a remembered size wins only while it is in stock.
 */

const v = (
  colour: string,
  size: string,
  stockStatus: string,
  stockQuantity: number | null = null,
) => ({
  attributes: [
    { key: "pa_colour", value: colour },
    { key: "pa_size", value: size },
  ],
  stockStatus,
  stockQuantity,
});

const SIZES = ["41", "42", "43", "44"];

const VARIATIONS = [
  v("white", "41", "outofstock", 0),
  v("white", "42", "instock", 2),
  v("white", "43", "instock", 5),
  v("white", "44", "outofstock", 0),
  v("black", "41", "instock", 1),
  v("black", "42", "outofstock", 0),
  v("black", "43", "onbackorder", 0),
];

const base = {
  variations: VARIATIONS,
  colorKey: "pa_colour",
  sizeKey: "pa_size",
  sizeOptions: SIZES,
};

describe("pickDefaultVariation", () => {
  it("skips a sold-out smallest size and picks the next in-stock one", () => {
    const chosen = pickDefaultVariation({ ...base, colour: "white" });
    expect(chosen?.attributes).toEqual(v("white", "42", "instock").attributes);
  });

  it("keeps the remembered size when its variation is in stock", () => {
    const chosen = pickDefaultVariation({
      ...base,
      colour: "white",
      preferredSize: "43",
    });
    expect(chosen?.attributes[1]?.value).toBe("43");
  });

  it("skips a remembered size that is out of stock", () => {
    const chosen = pickDefaultVariation({
      ...base,
      colour: "white",
      preferredSize: "44",
    });
    expect(chosen?.attributes[1]?.value).toBe("42");
  });

  it("re-evaluates on a colour change: the size kept from the old colour only survives if in stock", () => {
    // Shopper was on white / 42; black / 42 is sold out → black / 41.
    const afterSwitch = pickDefaultVariation({
      ...base,
      colour: "black",
      preferredSize: "42",
    });
    expect(afterSwitch?.attributes[1]?.value).toBe("41");

    // Shopper was on white / 43; black / 43 is on backorder (sellable) → keep.
    const kept = pickDefaultVariation({
      ...base,
      colour: "black",
      preferredSize: "43",
    });
    expect(kept?.attributes[1]?.value).toBe("43");
  });

  it("keeps the remembered size when every size is sold out", () => {
    const soldOut = [
      v("red", "42", "outofstock", 0),
      v("red", "43", "outofstock", 0),
    ];
    const chosen = pickDefaultVariation({
      ...base,
      variations: soldOut,
      colour: "red",
      preferredSize: "43",
    });
    // Nothing is in stock, so there is nothing better to land on: the
    // remembered size resolves, as it did before the in-stock rule.
    expect(chosen?.attributes[1]?.value).toBe("43");
  });

  it("falls back to the first existing size when every size is sold out and none is remembered", () => {
    const soldOut = [
      v("red", "42", "outofstock", 0),
      v("red", "43", "outofstock", 0),
    ];
    const chosen = pickDefaultVariation({
      ...base,
      variations: soldOut,
      colour: "red",
    });
    expect(chosen?.attributes[1]?.value).toBe("42");
  });

  it("ignores a remembered size the colour does not carry", () => {
    const soldOut = [
      v("red", "42", "outofstock", 0),
      v("red", "43", "outofstock", 0),
    ];
    const chosen = pickDefaultVariation({
      ...base,
      variations: soldOut,
      colour: "red",
      preferredSize: "99",
    });
    expect(chosen?.attributes[1]?.value).toBe("42");
  });

  it("returns null when the colour has no variations", () => {
    expect(pickDefaultVariation({ ...base, colour: "green" })).toBeNull();
  });

  it("works without a colour axis (size-only product)", () => {
    const sizeOnly = [
      {
        attributes: [{ key: "pa_size", value: "S" }],
        stockStatus: "outofstock",
        stockQuantity: 0,
      },
      {
        attributes: [{ key: "pa_size", value: "M" }],
        stockStatus: "instock",
        stockQuantity: 3,
      },
    ];
    const chosen = pickDefaultVariation({
      variations: sizeOnly,
      sizeKey: "pa_size",
      sizeOptions: ["S", "M"],
    });
    expect(chosen?.attributes[0]?.value).toBe("M");
  });
});

describe("defaultAttributesForColour", () => {
  it("carries the colour and cascades the chosen variation's attributes", () => {
    expect(defaultAttributesForColour({ ...base, colour: "white" })).toEqual({
      pa_colour: "white",
      pa_size: "42",
    });
  });

  it("carries only the colour when nothing matches it", () => {
    expect(defaultAttributesForColour({ ...base, colour: "green" })).toEqual({
      pa_colour: "green",
    });
  });
});

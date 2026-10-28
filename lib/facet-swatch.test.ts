import { describe, expect, it } from "vitest";
import { facetSwatch } from "./facet-swatch";

/**
 * The pure rule only. It resolves no CSS and renders nothing, so it cannot see
 * the dot, its 16px box, the gradient it paints or the row's height — those are
 * `attribute-filter.swatch.test.tsx`'s (markup) and the PR's (browser).
 */
describe("facetSwatch", () => {
  it("is null for the empty string, which is what every store answers today", () => {
    // Non-null `String!` on the gateway: "no swatch" is "" and never null.
    expect(facetSwatch({ swatchColor: "", swatchColor2: "" })).toBeNull();
  });

  it("is null for whitespace, so a blank theme value cannot paint a dot", () => {
    expect(facetSwatch({ swatchColor: "   ", swatchColor2: "" })).toBeNull();
  });

  it("is null when the fields are absent or null", () => {
    expect(facetSwatch({})).toBeNull();
    expect(facetSwatch({ swatchColor: null, swatchColor2: null })).toBeNull();
  });

  it("resolves one colour to a single-tone swatch", () => {
    expect(facetSwatch({ swatchColor: "#aa224b", swatchColor2: "" })).toEqual({
      color1: "#aa224b",
    });
  });

  it("resolves both colours to a two-tone swatch", () => {
    expect(
      facetSwatch({ swatchColor: "#000000", swatchColor2: "#ffffff" }),
    ).toEqual({ color1: "#000000", color2: "#ffffff" });
  });

  it("trims, so a padded theme value still paints", () => {
    expect(
      facetSwatch({ swatchColor: " #aa224b ", swatchColor2: " #006d77 " }),
    ).toEqual({ color1: "#aa224b", color2: "#006d77" });
  });

  it("is null for a second colour with no first — not a one-sided gradient", () => {
    // `SwatchDot` only reads `color2` when `color1` is set, so there is nothing
    // for a lone second colour to paint against.
    expect(
      facetSwatch({ swatchColor: "", swatchColor2: "#ffffff" }),
    ).toBeNull();
  });

  it("does not validate the colour, deliberately", () => {
    // Same trust the product card and the PDP's `VariantSwatch` already place
    // in this theme-authored field. A rule stricter here than on the card would
    // show a dot on a card and none in the filter for the same option.
    expect(facetSwatch({ swatchColor: "rebeccapurple" })).toEqual({
      color1: "rebeccapurple",
    });
    expect(facetSwatch({ swatchColor: "rgb(0 109 119)" })).toEqual({
      color1: "rgb(0 109 119)",
    });
  });
});

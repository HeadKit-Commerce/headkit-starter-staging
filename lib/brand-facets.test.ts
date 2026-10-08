import { describe, it, expect } from "vitest";
import {
  brandSlugsForCategory,
  brandSlugsPerCategory,
  shouldFallBackToGlobalBrands,
  type CategoryBrandSource,
} from "./brand-facets";

function filters(...slugs: string[]): CategoryBrandSource {
  return {
    brands: slugs.map((slug, i) => ({
      __typename: "ProductFilterOption" as const,
      slug,
      name: slug,
      count: i + 1,
      // Brands share ProductFilterOption with attribute choices, which carry
      // swatch colours. A brand never does, so commerce sends "" for both —
      // this is the production value, not a fixture convenience.
      swatchColor: "",
      swatchColor2: "",
    })),
  };
}

const GLOBAL = ["shimano", "abus", "basil", "4iiii"];

describe("brandSlugsForCategory", () => {
  it("keeps only the brands the category reports", () => {
    expect(brandSlugsForCategory(filters("abus", "basil"), GLOBAL)).toEqual([
      "abus",
      "basil",
    ]);
  });

  it("preserves the global list's order so both emitters agree", () => {
    expect(brandSlugsForCategory(filters("basil", "shimano"), GLOBAL)).toEqual([
      "shimano",
      "basil",
    ]);
  });

  it("drops a brand the store no longer lists globally", () => {
    expect(
      brandSlugsForCategory(filters("shimano", "retired"), GLOBAL),
    ).toEqual(["shimano"]);
  });

  it("returns nothing for a category with no brands", () => {
    expect(brandSlugsForCategory(filters(), GLOBAL)).toEqual([]);
  });

  it("returns nothing when the getFilters call failed for that category", () => {
    expect(brandSlugsForCategory(null, GLOBAL)).toEqual([]);
  });

  it("ignores empty slugs on both sides", () => {
    expect(brandSlugsForCategory(filters("", "abus"), ["", "abus"])).toEqual([
      "abus",
    ]);
  });
});

describe("shouldFallBackToGlobalBrands", () => {
  it("is true when every category reports no brand but the store lists some", () => {
    expect(shouldFallBackToGlobalBrands([filters(), null], GLOBAL)).toBe(true);
  });

  it("is false as soon as ONE category reports a brand", () => {
    expect(
      shouldFallBackToGlobalBrands([filters(), filters("abus")], GLOBAL),
    ).toBe(false);
  });

  it("is false when the store lists no brands at all", () => {
    // Nothing to fall back to — a brandless store emits no brand facets either
    // way, so this must not be reported as a backend gap.
    expect(shouldFallBackToGlobalBrands([filters(), filters()], [])).toBe(
      false,
    );
  });
});

describe("brandSlugsPerCategory", () => {
  it("returns per-category lists parallel to the input", () => {
    expect(
      brandSlugsPerCategory(
        [filters("shimano"), filters("abus", "basil"), filters()],
        GLOBAL,
      ),
    ).toEqual([["shimano"], ["abus", "basil"], []]);
  });

  it("falls back to the whole global list for every category when none can report", () => {
    expect(brandSlugsPerCategory([null, filters()], GLOBAL)).toEqual([
      GLOBAL,
      GLOBAL,
    ]);
  });

  it("de-duplicates the global list", () => {
    expect(brandSlugsPerCategory([null], ["abus", "abus", "shimano"])).toEqual([
      ["abus", "shimano"],
    ]);
  });
});

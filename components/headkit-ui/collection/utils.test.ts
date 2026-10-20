import { describe, expect, it } from "vitest";
import {
  isIndexableFacet,
  isColorAttrSlug,
  facetTitle,
  facetDescription,
  encodeFilterSlug,
  decodeFilterSlug,
  buildBreadcrumbFromCategory,
  buildProductListFilter,
  normalizeFilterKey,
  DEFAULT_FILTER_VALUES,
  type FilterValues,
  collectionPathFromCategory,
} from "./utils";

/**
 * Tier-1 facet SEO predicate + copy helpers (phase 06-01).
 *
 * isIndexableFacet is the single source of truth that gates whether a
 * `/collections/<cat>/f/<filterSlug>` URL is a real, indexable "Nike-style"
 * page (single color, nothing else) vs a Tier-2 combo that canonicalizes back
 * to the base category and is noindex.
 */

/** Build a FilterValues with the given overrides on top of the defaults. */
function fv(overrides: Partial<FilterValues>): FilterValues {
  return { ...DEFAULT_FILTER_VALUES, ...overrides };
}

describe("isIndexableFacet (Tier-1 predicate)", () => {
  it("returns true for a single pa_color with a single value and nothing else", () => {
    expect(isIndexableFacet(fv({ attributes: { pa_color: ["red"] } }))).toBe(
      true,
    );
  });

  it("supports the pa_colour spelling variant", () => {
    expect(isIndexableFacet(fv({ attributes: { pa_colour: ["blue"] } }))).toBe(
      true,
    );
  });

  it("returns false for no filters at all", () => {
    expect(isIndexableFacet(fv({}))).toBe(false);
  });

  it("returns false for two colors (multi-value)", () => {
    expect(
      isIndexableFacet(fv({ attributes: { pa_color: ["red", "blue"] } })),
    ).toBe(false);
  });

  it("returns false for color + size (multi-attribute)", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"], pa_size: ["l"] } }),
      ),
    ).toBe(false);
  });

  it("returns false for a non-color single attribute", () => {
    expect(isIndexableFacet(fv({ attributes: { pa_size: ["l"] } }))).toBe(
      false,
    );
  });

  it("does not treat 1-product bundle option slugs as collection color facets", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { "monogram-bath-towel-colour": ["undergrowth"] } }),
      ),
    ).toBe(false);
  });

  it("returns false for color + brand", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, brands: ["nike"] }),
      ),
    ).toBe(false);
  });

  it("returns true for a single brand with a single value and nothing else", () => {
    expect(isIndexableFacet(fv({ brands: ["nike"] }))).toBe(true);
  });

  it("returns false for two brands (multi-value)", () => {
    expect(isIndexableFacet(fv({ brands: ["nike", "adidas"] }))).toBe(false);
  });

  it("returns false for brand + size", () => {
    expect(
      isIndexableFacet(
        fv({ brands: ["nike"], attributes: { pa_size: ["l"] } }),
      ),
    ).toBe(false);
  });

  it("returns false for brand + price_min", () => {
    expect(isIndexableFacet(fv({ brands: ["nike"], price_min: "10" }))).toBe(
      false,
    );
  });

  it("returns false for brand + a non-default sort", () => {
    expect(isIndexableFacet(fv({ brands: ["nike"], sort: "PRICE" }))).toBe(
      false,
    );
  });

  it("returns false for color + a category filter", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, categories: ["shoes"] }),
      ),
    ).toBe(false);
  });

  it("returns false for color + price_min", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, price_min: "10" }),
      ),
    ).toBe(false);
  });

  it("returns false for color + price_max", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, price_max: "99" }),
      ),
    ).toBe(false);
  });

  it("returns false for color + instock", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, instock: true }),
      ),
    ).toBe(false);
  });

  it("returns false for color + a non-default sort", () => {
    expect(
      isIndexableFacet(
        fv({ attributes: { pa_color: ["red"] }, sort: "PRICE" }),
      ),
    ).toBe(false);
  });

  it("returns false for color + a non-default page", () => {
    expect(
      isIndexableFacet(fv({ attributes: { pa_color: ["red"] }, page: 2 })),
    ).toBe(false);
  });

  it("ignores attribute entries with empty value arrays", () => {
    // pa_color single value with a stray empty pa_size key should still index.
    expect(
      isIndexableFacet(fv({ attributes: { pa_color: ["red"], pa_size: [] } })),
    ).toBe(true);
  });
});

describe("isColorAttrSlug (pa_ and stripped forms)", () => {
  it("recognises the pa_-prefixed filter convention", () => {
    expect(isColorAttrSlug("pa_color")).toBe(true);
    expect(isColorAttrSlug("pa_colour")).toBe(true);
  });

  it("recognises the SDK getFilters() stripped display form", () => {
    expect(isColorAttrSlug("color")).toBe(true);
    expect(isColorAttrSlug("colour")).toBe(true);
  });

  it("returns false for non-color attributes", () => {
    expect(isColorAttrSlug("pa_size")).toBe(false);
    expect(isColorAttrSlug("size")).toBe(false);
    expect(isColorAttrSlug("")).toBe(false);
    expect(isColorAttrSlug("colorway")).toBe(false);
  });

  it("recognises Shopify 1-product bundle option slugs ending in -colour", () => {
    expect(isColorAttrSlug("monogram-bath-towel-colour")).toBe(true);
    expect(isColorAttrSlug("monogram-bath-sheet-colour")).toBe(true);
    expect(isColorAttrSlug("monogram-bath-towel-color")).toBe(true);
  });
});

describe("facetTitle / facetDescription (Tier-1 copy)", () => {
  it("facetTitle is '{ColorLabel} {categoryName}'", () => {
    expect(facetTitle("Lifestyle Shoes", "Red")).toBe("Red Lifestyle Shoes");
  });

  it("facetTitle works for a brand label too ('{Brand} {categoryName}')", () => {
    expect(facetTitle("Apparel", "Velocity")).toBe("Velocity Apparel");
  });

  it("facetDescription mentions the color and category", () => {
    const desc = facetDescription("Lifestyle Shoes", "Red", "Paralel");
    expect(desc).toContain("Red");
    expect(desc).toContain("Lifestyle Shoes");
    expect(desc).toContain("Paralel");
    expect(desc).not.toContain(" at Store");
    expect(desc.length).toBeGreaterThan(0);
  });

  it("facetDescription mentions the brand and category", () => {
    const desc = facetDescription("Apparel", "Velocity", "Paralel");
    expect(desc).toContain("Velocity");
    expect(desc).toContain("Apparel");
    expect(desc).toContain("Paralel");
  });

  it("facetDescription omits placeholder site when store name is missing", () => {
    const desc = facetDescription("Lifestyle Shoes", "Red");
    expect(desc).not.toContain(" at Store");
    expect(desc).toContain("Shop Red Lifestyle Shoes.");
  });
});

describe("encodeFilterSlug / decodeFilterSlug (brand group)", () => {
  it("encodes a single brand as a brand.<slug> group", () => {
    expect(encodeFilterSlug(fv({ brands: ["velocity"] }))).toBe(
      "brand.velocity",
    );
  });

  it("round-trips a single brand back into filters.brands", () => {
    const decoded = decodeFilterSlug("brand.velocity");
    expect(decoded.brands).toEqual(["velocity"]);
    expect(decoded.attributes).toEqual({});
  });

  it("encodes/decodes multiple brands sorted and stable", () => {
    const slug = encodeFilterSlug(fv({ brands: ["velocity", "acme"] }));
    expect(slug).toBe("brand.acme.velocity");
    expect(decodeFilterSlug(slug).brands).toEqual(["acme", "velocity"]);
  });

  it("encodes mixed color + brand deterministically and round-trips", () => {
    const slug = encodeFilterSlug(
      fv({ attributes: { pa_color: ["black"] }, brands: ["velocity"] }),
    );
    const decoded = decodeFilterSlug(slug);
    expect(decoded.attributes).toEqual({ pa_color: ["black"] });
    expect(decoded.brands).toEqual(["velocity"]);
    // brand and color both present; round-trip preserves both groups
    expect(encodeFilterSlug(fv({ ...decoded }))).toBe(slug);
  });

  it("decodes an attribute-only slug with empty brands array", () => {
    const decoded = decodeFilterSlug("color.black");
    expect(decoded.attributes).toEqual({ pa_color: ["black"] });
    expect(decoded.brands).toEqual([]);
  });

  it("returns empty attributes + brands for an empty slug", () => {
    const decoded = decodeFilterSlug("");
    expect(decoded.attributes).toEqual({});
    expect(decoded.brands).toEqual([]);
  });
});

describe("encodeFilterSlug / decodeFilterSlug (delimiter-safe values)", () => {
  it("round-trips a value containing the value separator '.'", () => {
    const fvIn = fv({ attributes: { pa_color: ["off.white"] } });
    const decoded = decodeFilterSlug(encodeFilterSlug(fvIn));
    expect(decoded.attributes).toEqual({ pa_color: ["off.white"] });
  });

  it("round-trips a value containing the group separator '_'", () => {
    const fvIn = fv({ attributes: { pa_color: ["a_b"] } });
    const decoded = decodeFilterSlug(encodeFilterSlug(fvIn));
    expect(decoded.attributes).toEqual({ pa_color: ["a_b"] });
  });

  it("round-trips a value containing the escape introducer itself", () => {
    const fvIn = fv({ attributes: { pa_color: ["a~b"] } });
    const slug = encodeFilterSlug(fvIn);
    const decoded = decodeFilterSlug(slug);
    expect(decoded.attributes).toEqual({ pa_color: ["a~b"] });
  });

  it("round-trips a brand value containing '.' and '_'", () => {
    const fvIn = fv({ brands: ["a.b_c"] });
    const decoded = decodeFilterSlug(encodeFilterSlug(fvIn));
    expect(decoded.brands).toEqual(["a.b_c"]);
  });

  it("round-trips a value mixing all special chars without corruption", () => {
    const tricky = "x.y_z~w";
    const fvIn = fv({ attributes: { pa_color: [tricky] }, brands: [tricky] });
    const decoded = decodeFilterSlug(encodeFilterSlug(fvIn));
    expect(decoded.attributes).toEqual({ pa_color: [tricky] });
    expect(decoded.brands).toEqual([tricky]);
  });

  it("does not escape ordinary slugs (readable scheme preserved)", () => {
    expect(encodeFilterSlug(fv({ attributes: { pa_color: ["black"] } }))).toBe(
      "color.black",
    );
  });
});

describe("collectionPathFromCategory", () => {
  function category(
    slug: string,
    ancestorSlugs: string[],
  ): Parameters<typeof collectionPathFromCategory>[0] {
    return {
      id: slug,
      name: slug,
      slug,
      description: "",
      thumbnail: "",
      uri: "",
      children: [],
      ancestors: ancestorSlugs.map((s) => ({
        id: s,
        name: s,
        slug: s,
        description: "",
        thumbnail: "",
        uri: "",
        children: [],
        ancestors: [],
      })),
    };
  }

  it("joins ancestors root-first ahead of the category's own slug", () => {
    expect(
      collectionPathFromCategory(
        category("outdoor-benches", ["outdoor-furniture", "outdoor-seating"]),
      ),
    ).toBe("/collections/outdoor-furniture/outdoor-seating/outdoor-benches");
  });

  it("returns the bare path for a root category", () => {
    expect(collectionPathFromCategory(category("hoodies", []))).toBe(
      "/collections/hoodies",
    );
  });

  it("is independent of how the category was requested", () => {
    // The route resolves the category from the LAST slug segment, so several
    // request shapes serve one category; the canonical must not vary with them.
    const nested = category("child", ["parent"]);
    expect(collectionPathFromCategory(nested)).toBe(
      "/collections/parent/child",
    );
  });
});

describe("buildBreadcrumbFromCategory", () => {
  it("orders ancestors root-first and builds nested collection URIs", () => {
    // Woo/HeadKit REST returns ancestors already root → parent (see
    // headkit_build_category_response_item + array_reverse). Do not reverse.
    const category = {
      id: "551",
      name: "Outdoor Benches",
      slug: "outdoor-benches",
      description: "",
      thumbnail: "",
      uri: "",
      children: [],
      ancestors: [
        {
          id: "1",
          name: "Outdoor Furniture",
          slug: "outdoor-furniture",
          description: "",
          thumbnail: "",
          uri: "",
          children: [],
          ancestors: [],
        },
        {
          id: "2",
          name: "Outdoor Seating",
          slug: "outdoor-seating",
          description: "",
          thumbnail: "",
          uri: "",
          children: [],
          ancestors: [],
        },
      ],
    };

    expect(buildBreadcrumbFromCategory(category)).toEqual([
      { name: "Home", uri: "/", current: false },
      { name: "Shop", uri: "/shop", current: false },
      {
        name: "Outdoor Furniture",
        uri: "/collections/outdoor-furniture",
        current: false,
      },
      {
        name: "Outdoor Seating",
        uri: "/collections/outdoor-furniture/outdoor-seating",
        current: false,
      },
      {
        name: "Outdoor Benches",
        uri: "/collections/outdoor-furniture/outdoor-seating/outdoor-benches",
        current: true,
      },
    ]);
  });

  it("handles a root category with no ancestors", () => {
    const category = {
      id: "1",
      name: "Outdoor Furniture",
      slug: "outdoor-furniture",
      description: "",
      thumbnail: "",
      uri: "",
      children: [],
      ancestors: [],
    };

    expect(buildBreadcrumbFromCategory(category)).toEqual([
      { name: "Home", uri: "/", current: false },
      { name: "Shop", uri: "/shop", current: false },
      {
        name: "Outdoor Furniture",
        uri: "/collections/outdoor-furniture",
        current: true,
      },
    ]);
  });
});

describe("buildProductListFilter inStock", () => {
  // The "In Stock" switch wrote `?instock=true` and the grid did not change,
  // because nothing mapped it onto the commerce filter.
  it("maps the in-stock switch onto the commerce filter", () => {
    expect(buildProductListFilter(fv({ instock: true })).inStock).toBe(true);
  });

  it("maps it on a category and on a search alike", () => {
    expect(
      buildProductListFilter(fv({ instock: true }), {
        categorySlug: "road-bikes",
      }),
    ).toMatchObject({ category: "road-bikes", inStock: true });
    expect(
      buildProductListFilter(fv({ instock: true }), { search: "helmet" }),
    ).toMatchObject({ search: "helmet", inStock: true });
  });

  it("omits the key entirely when the switch is off", () => {
    // Absent, not `false`: an older gateway rejects the unknown input field,
    // so the switched-off request must stay byte-identical to before.
    expect("inStock" in buildProductListFilter(fv({}))).toBe(false);
    expect(
      "inStock" in buildProductListFilter(fv({}), { categorySlug: "a" }),
    ).toBe(false);
  });

  it("gives the two states different catalog cache keys", () => {
    expect(normalizeFilterKey(buildProductListFilter(fv({})))).not.toBe(
      normalizeFilterKey(buildProductListFilter(fv({ instock: true }))),
    );
  });
});

describe("buildProductListFilter defaultSort", () => {
  it("applies branding defaultSort when URL sort is empty", () => {
    const filter = buildProductListFilter(fv({}), { defaultSort: "PRICE" });
    expect(filter.orderby).toBe("price");
    expect(filter.order).toBe("asc");
  });

  it("lets an explicit URL sort override branding default", () => {
    const filter = buildProductListFilter(fv({ sort: "TITLE" }), {
      defaultSort: "PRICE",
    });
    expect(filter.orderby).toBe("title");
    expect(filter.order).toBe("asc");
  });

  it("leaves orderby unset when neither sort nor defaultSort is set", () => {
    const filter = buildProductListFilter(fv({}));
    expect(filter.orderby).toBeUndefined();
    expect(filter.order).toBeUndefined();
  });

  it("uses CREATED_AT (newest) for /new-style default without branding", () => {
    const filter = buildProductListFilter(fv({}), {
      isNew: true,
      defaultSort: "CREATED_AT",
    });
    expect(filter.orderby).toBe("date");
    expect(filter.order).toBe("desc");
  });

  it("leaves room for search relevance when no sort or defaultSort", () => {
    const filter = buildProductListFilter(fv({}), { search: "hoodie" });
    expect(filter.search).toBe("hoodie");
    expect(filter.orderby).toBeUndefined();
  });

  it("maps featured: true onto ProductListFilter", () => {
    const filter = buildProductListFilter(fv({}), { featured: true });
    expect(filter.featured).toBe(true);
    expect(filter.onSale).toBeUndefined();
    expect(filter.isNew).toBeUndefined();
  });
});

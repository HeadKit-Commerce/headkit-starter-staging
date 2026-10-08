import { describe, expect, it } from "vitest";
import {
  collapseCatalogProducts,
  expandCatalogProducts,
  selectedColourFacetSlugs,
  partitionFullRows,
  resolveCarouselColourway,
} from "@/lib/catalog-display";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

type TestProduct = ProductSummaryFieldsFragment & {
  defaultAttributes?: Array<{ key: string; value: string }>;
  variations: Array<
    ProductSummaryFieldsFragment["variations"][number] & {
      dateModified?: string | null;
    }
  >;
};

function makeProduct(
  overrides: Partial<TestProduct> &
    Pick<ProductSummaryFieldsFragment, "id" | "slug" | "name">,
): TestProduct {
  return {
    uri: `/products/${overrides.slug}`,
    type: "VARIABLE",
    price: "10",
    regularPrice: "10",
    salePrice: "",
    onSale: false,
    isNew: false,
    stockStatus: "IN_STOCK",
    tags: [],
    image: { src: "/main.jpg", alt: "", width: 0, height: 0 },
    hoverImage: { src: "/hover.jpg", alt: "", width: 0, height: 0 },
    attributes: [],
    variations: [],
    defaultAttributes: [],
    ...overrides,
  };
}

const colourAttr = {
  id: "pa_colour",
  name: "Colour",
  slug: "pa_colour",
  type: "color",
  options: ["red", "blue"],
  visible: true,
  variation: true,
  fullOptions: [
    {
      name: "Red",
      slug: "red",
      swatchColor: "#f00",
      swatchColor2: "",
    },
    {
      name: "Blue",
      slug: "blue",
      swatchColor: "#00f",
      swatchColor2: "",
    },
  ],
};

describe("expandCatalogProducts", () => {
  it("collapses to the first swatch when showVariants is false", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        attributes: [colourAttr],
        defaultAttributes: [{ key: "pa_colour", value: "blue" }],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, false);
    expect(result).toHaveLength(1);
    expect(result[0]?.colorwaySlug).toBe("red");
    expect(result[0]?.image?.src).toBe("/red.jpg");
  });

  it("expands colourways when showVariants is true", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        attributes: [colourAttr],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }, { src: "/red-hover.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, true);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.colorwaySlug)).toEqual(["red", "blue"]);
    expect(result[0]?.image?.src).toBe("/red.jpg");
    expect(result[1]?.image?.src).toBe("/blue.jpg");
    // Red has a second variation gallery image → colourway-specific rollover.
    expect(result[0]?.hoverImage?.src).toBe("/red-hover.jpg");
    // Blue has no colourway images[1]; parent hover is not another
    // colourway's primary → keep the product gallery rollover.
    expect(result[1]?.hoverImage?.src).toBe("/hover.jpg");
  });

  it("keeps parent hoverImage when a single colourway has no variation gallery", () => {
    const undergrowth = {
      ...colourAttr,
      options: ["undergrowth"],
      fullOptions: [
        {
          name: "Undergrowth",
          slug: "undergrowth",
          swatchColor: "#3a4a2a",
          swatchColor2: "",
        },
      ],
    };
    const products = [
      makeProduct({
        id: "towel",
        slug: "monogram-face-cloth",
        name: "Monogram Face Cloth",
        image: { src: "/packshot.jpg", alt: "", width: 0, height: 0 },
        hoverImage: { src: "/lifestyle.jpg", alt: "", width: 0, height: 0 },
        attributes: [undergrowth],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/packshot.jpg" },
            images: [],
            attributes: [{ key: "pa_colour", value: "undergrowth" }],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, true);
    expect(result).toHaveLength(1);
    expect(result[0]?.colorwaySlug).toBe("undergrowth");
    expect(result[0]?.image?.src).toBe("/packshot.jpg");
    expect(result[0]?.hoverImage?.src).toBe("/lifestyle.jpg");
  });

  it("does not use parent hoverImage when it is another colourway primary", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        hoverImage: { src: "/blue.jpg", alt: "", width: 0, height: 0 },
        attributes: [colourAttr],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, true);
    expect(result[0]?.hoverImage).toBeNull();
    expect(result[1]?.hoverImage).toBeNull();
  });

  it("does not use the next colourway primary as hover", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        hoverImage: null,
        attributes: [colourAttr],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }, { src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }, { src: "/blue-hover.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, true);
    expect(result[0]?.image?.src).toBe("/red.jpg");
    expect(result[0]?.hoverImage).toBeNull();
    expect(result[1]?.hoverImage?.src).toBe("/blue-hover.jpg");
  });

  it("does not expand size-only attributes", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        attributes: [
          {
            id: "pa_size",
            name: "Size",
            slug: "pa_size",
            type: "select",
            options: ["s", "m"],
            visible: true,
            variation: true,
            fullOptions: [
              { name: "S", slug: "s", swatchColor: "", swatchColor2: "" },
              { name: "M", slug: "m", swatchColor: "", swatchColor2: "" },
            ],
          },
        ],
      }),
    ];

    const result = expandCatalogProducts(products, true);
    expect(result).toHaveLength(1);
    expect(result[0]?.colorwaySlug).toBeNull();
  });
});

describe("partitionFullRows", () => {
  const items = Array.from({ length: 14 }, (_, index) =>
    makeProduct({
      id: String(index + 1),
      slug: `p-${index + 1}`,
      name: `P${index + 1}`,
    }),
  );

  it("holds back an incomplete trailing quantum while more pages can load", () => {
    const { visible, held } = partitionFullRows(items, {
      includeRemainder: false,
    });
    expect(visible).toHaveLength(12);
    expect(held).toHaveLength(2);
  });

  it("shows the remainder once the catalog is exhausted", () => {
    const { visible, held } = partitionFullRows(items, {
      includeRemainder: true,
    });
    expect(visible).toHaveLength(14);
    expect(held).toHaveLength(0);
  });

  it("does not hold back when the list is shorter than one quantum", () => {
    const { visible, held } = partitionFullRows(items.slice(0, 5), {
      includeRemainder: false,
    });
    expect(visible).toHaveLength(5);
    expect(held).toHaveLength(0);
  });
});

describe("collapseCatalogProducts", () => {
  it("prefers an admin pin over the first swatch", () => {
    const products = [
      makeProduct({
        id: "42",
        slug: "tee",
        name: "Tee",
        attributes: [colourAttr],
        defaultAttributes: [{ key: "pa_colour", value: "red" }],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const result = collapseCatalogProducts(products, { "42": "blue" });
    expect(result).toHaveLength(1);
    expect(result[0]?.colorwaySlug).toBe("blue");
    expect(result[0]?.image?.src).toBe("/blue.jpg");
  });

  it("ignores a variation's dateModified and keeps the first swatch", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        attributes: [colourAttr],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            dateModified: "2024-01-01T00:00:00Z",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            dateModified: "2025-06-01T00:00:00Z",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    expect(resolveCarouselColourway(products[0]!)).toBe("red");
    const result = collapseCatalogProducts(products);
    expect(result[0]?.colorwaySlug).toBe("red");
  });

  it("keeps parent hoverImage on a collapsed single-colourway card", () => {
    const undergrowth = {
      ...colourAttr,
      options: ["undergrowth"],
      fullOptions: [
        {
          name: "Undergrowth",
          slug: "undergrowth",
          swatchColor: "#3a4a2a",
          swatchColor2: "",
        },
      ],
    };
    const products = [
      makeProduct({
        id: "towel",
        slug: "monogram-face-cloth",
        name: "Monogram Face Cloth",
        image: { src: "/packshot.jpg", alt: "", width: 0, height: 0 },
        hoverImage: { src: "/lifestyle.jpg", alt: "", width: 0, height: 0 },
        attributes: [undergrowth],
        variations: [
          {
            id: "v1",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/packshot.jpg" },
            images: [],
            attributes: [{ key: "pa_colour", value: "undergrowth" }],
          },
        ],
      }),
    ];

    const result = collapseCatalogProducts(products);
    expect(result[0]?.colorwaySlug).toBe("undergrowth");
    expect(result[0]?.hoverImage?.src).toBe("/lifestyle.jpg");
  });

  it("sets onSale from the shown colourway variation", () => {
    const products = [
      makeProduct({
        id: "1",
        slug: "tee",
        name: "Tee",
        onSale: true, // parent true because another colourway is on sale
        attributes: [colourAttr],
        defaultAttributes: [{ key: "pa_colour", value: "red" }],
        variations: [
          {
            id: "v1",
            price: "8",
            regularPrice: "10",
            salePrice: "8",
            onSale: true,
            stockStatus: "IN_STOCK",
            image: { src: "/red.jpg" },
            images: [{ src: "/red.jpg" }],
            attributes: [{ key: "pa_colour", value: "red" }],
          },
          {
            id: "v2",
            price: "10",
            regularPrice: "10",
            salePrice: "",
            onSale: false,
            stockStatus: "IN_STOCK",
            image: { src: "/blue.jpg" },
            images: [{ src: "/blue.jpg" }],
            attributes: [{ key: "pa_colour", value: "blue" }],
          },
        ],
      }),
    ];

    const red = collapseCatalogProducts(products);
    expect(red[0]?.onSale).toBe(true);

    const blueOnly = collapseCatalogProducts(products, { "1": "blue" });
    expect(blueOnly[0]?.onSale).toBe(false);
  });
});

describe("colour facet cards", () => {
  const products = [
    makeProduct({
      id: "1",
      slug: "tee",
      name: "Tee",
      attributes: [colourAttr],
      variations: [
        {
          id: "v1",
          price: "10",
          regularPrice: "10",
          salePrice: "",
          onSale: false,
          stockStatus: "IN_STOCK",
          image: { src: "/red.jpg" },
          images: [{ src: "/red.jpg" }],
          attributes: [{ key: "pa_colour", value: "red" }],
        },
        {
          id: "v2",
          price: "10",
          regularPrice: "10",
          salePrice: "",
          onSale: false,
          stockStatus: "IN_STOCK",
          image: { src: "/blue.jpg" },
          images: [{ src: "/blue.jpg" }],
          attributes: [{ key: "pa_colour", value: "blue" }],
        },
      ],
    }),
  ];

  it("shows the filtered colour on a collapsed card", () => {
    const result = expandCatalogProducts(products, false, ["blue"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.colorwaySlug).toBe("blue");
    expect(result[0]?.image?.src).toBe("/blue.jpg");
  });

  it("keeps only the matching colourway when variants are exploded", () => {
    expect(expandCatalogProducts(products, true, ["white"])).toHaveLength(0);
    const blue = expandCatalogProducts(products, true, ["blue"]);
    expect(blue.map((product) => product.colorwaySlug)).toEqual(["blue"]);
  });

  it("keeps every selected colour, in swatch order", () => {
    const result = expandCatalogProducts(products, true, ["blue", "red"]);
    expect(result.map((product) => product.colorwaySlug)).toEqual([
      "red",
      "blue",
    ]);
  });

  it("reads colour facet slugs and ignores other attributes", () => {
    expect(
      selectedColourFacetSlugs({
        pa_colour: ["white"],
        pa_size: ["m"],
        colour: ["navy"],
      }),
    ).toEqual(["white", "navy"]);
  });
});

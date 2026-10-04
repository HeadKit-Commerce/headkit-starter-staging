import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StoreTheme } from "@/lib/store-theme";
import { clientThemeSlice } from "@/lib/client-theme";
import { ClientThemeProvider } from "./client-theme-provider";
import { ProductCard } from "./product-card";
import { CatalogDisplayProvider } from "./catalog-display-provider";
import type {
  CatalogDisplayPrefs,
  CatalogProduct,
} from "@/lib/catalog-display";

/**
 * The colourway dots on a product card: a legal tap target, and a capped row.
 *
 * WHAT THIS COVERS, AND WHERE IT STOPS. It renders the REAL `ProductCard`
 * through the REAL `CatalogDisplayProvider` and reads the emitted markup, so it
 * holds the things that are visible in markup:
 *
 *   - no `<button>` inside the colourway `<a>` (the invalid nesting axe scored
 *     as "0 px of safe clickable space", two failing nodes per dot),
 *   - the 24 px target classes on every interactive element in the row — the
 *     dots AND the "+N" chip, because trading 32 failures for 1 is not a fix,
 *   - the cap: the platform default of 10, and a store that overrides it.
 *
 * It CANNOT see what makes those claims true on a page. It measures no box, so
 * "the dot still looks 16 px in the same place and nothing shifted" is a
 * browser claim, not this file's. It runs no axe and no Lighthouse, so
 * "target-size reports zero failing nodes" is likewise not here. It resolves no
 * CSS, so a Tailwind class that emits no rule would pass it. And it has no DOM,
 * so whether a keyboard activation follows the link is a browser claim too.
 *
 * What it is here for is the drift a source reading catches: the nesting coming
 * back, the target classes being tidied off one of the two element kinds, the
 * cap ignoring the store's setting, and the row escaping the `showSwatches`
 * gate.
 */

const STARTER_THEME: StoreTheme = {
  version: 1,
  layout: {
    navLayout: "left-logo",
    navStyle: "icons",
    heroLayout: "inset",
    homepageNav: "solid",
    productEnquiry: true,
  },
};

let theme: StoreTheme = STARTER_THEME;

const SWATCHES_ON: CatalogDisplayPrefs = {
  showVariants: true,
  showSwatches: true,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

const SWATCHES_OFF: CatalogDisplayPrefs = {
  ...SWATCHES_ON,
  showSwatches: false,
};

const COLOURS = [
  ["Black", "black", "#000000"],
  ["White", "white", "#ffffff"],
  ["Red", "red", "#ff0000"],
  ["Blue", "blue", "#0000ff"],
  ["Green", "green", "#00ff00"],
  ["Sand", "sand", "#e7d9c9"],
  ["Grey", "grey", "#808080"],
  ["Navy", "navy", "#001f3f"],
  ["Olive", "olive", "#808000"],
  ["Pink", "pink", "#ffc0cb"],
  ["Teal", "teal", "#008080"],
  ["Rust", "rust", "#b7410e"],
].map(([name, slug, swatchColor]) => ({
  name,
  slug,
  swatchColor,
  swatchColor2: "",
}));

const COLOUR_NAMES = COLOURS.map((c) => c.name).join("|");

/** A variable product carrying `count` colourways, and nothing else unusual. */
function product(count: number): CatalogProduct {
  const fullOptions = COLOURS.slice(0, count);
  return {
    id: "1",
    databaseId: 1,
    name: "Zip Hoodie",
    slug: "zip-hoodie",
    uri: "https://commerce.example.com/shop/clothing/hoodies/zip-hoodie/",
    type: "variable",
    price: "100",
    regularPrice: "100",
    onSale: false,
    stockStatus: "instock",
    image: { src: "https://cdn.example/zip.jpg" },
    images: [],
    attributes: [
      {
        id: "a1",
        name: "Colour",
        slug: "pa_color",
        type: "select",
        options: fullOptions.map((o) => o.slug),
        visible: true,
        variation: true,
        fullOptions,
      },
    ],
    defaultAttributes: [],
    variations: fullOptions.map((o, index) => ({
      id: `v${index}`,
      price: "100",
      regularPrice: "100",
      salePrice: "",
      onSale: false,
      stockStatus: "instock",
      dateModified: null,
      image: { src: `https://cdn.example/zip-${o.slug}.jpg` },
      images: [],
      attributes: [{ key: "pa_color", value: o.slug }],
    })),
    categories: [{ id: "c1", name: "Hoodies", slug: "hoodies" }],
    related: [],
    upsells: [],
    projects: [],
  } as unknown as CatalogProduct;
}

function render(count: number, prefs = SWATCHES_ON): string {
  return renderToStaticMarkup(
    <ClientThemeProvider value={clientThemeSlice(theme)}>
      <CatalogDisplayProvider prefs={prefs}>
        <ProductCard product={product(count)} />
      </CatalogDisplayProvider>
    </ClientThemeProvider>,
  );
}

/** Every anchor in the markup, as `{ href, attrs, inner }`. */
function anchors(
  html: string,
): { href: string; attrs: string; inner: string }[] {
  const out: { href: string; attrs: string; inner: string }[] = [];
  // `[\s\S]` rather than the `s` flag: this repo's tsconfig target predates it.
  const re = /<a ([^>]*?)>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    out.push({
      href: /href="([^"]*)"/.exec(attrs)?.[1] ?? "",
      attrs,
      inner: match[2] ?? "",
    });
  }
  return out;
}

const colourwayLinks = (html: string) =>
  anchors(html).filter((a) =>
    new RegExp(`aria-label="(${COLOUR_NAMES})"`).test(a.attrs),
  );

const chipLink = (html: string) =>
  anchors(html).find((a) => /aria-label="\d+ more colours"/.test(a.attrs));

beforeEach(() => {
  theme = STARTER_THEME;
});

describe("product card colourway dots — target size", () => {
  it("wraps no <button> inside the colourway link, and emits no button at all", () => {
    const html = render(3);
    expect(colourwayLinks(html)).toHaveLength(3);
    for (const link of colourwayLinks(html)) {
      expect(link.inner).not.toContain("<button");
    }
    // Nothing else on the card introduces one either, so the invalid nesting
    // cannot come back through a neighbouring change unnoticed.
    expect(html).not.toContain("<button");
  });

  it("sizes every colourway link to the 24 x 24 floor", () => {
    for (const link of colourwayLinks(render(3))) {
      expect(link.attrs).toContain("h-6");
      expect(link.attrs).toContain("w-6");
      expect(link.attrs).toContain("inline-flex");
    }
  });

  it("keeps the dot itself 16 px, so only the target grew", () => {
    const html = render(2);
    // One 16 px dot per link, drawn by `SwatchDot` as a <span>.
    expect(html.match(/<span class="[^"]*\bh-4 w-4\b/g)).toHaveLength(2);
  });

  it("marks the previewed colourway with the ring and the rest without", () => {
    const html = render(3);
    // First colourway is the card's initial selection.
    expect(html.match(/outline-primary/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/outline-transparent/g)).toHaveLength(2);
  });

  it("points each dot at its own colourway URL", () => {
    const html = render(3);
    expect(colourwayLinks(html).map((a) => a.href)).toEqual([
      "/shop/clothing/hoodies/zip-hoodie/black",
      "/shop/clothing/hoodies/zip-hoodie/white",
      "/shop/clothing/hoodies/zip-hoodie/red",
    ]);
  });
});

describe("product card colourway dots — the row cap", () => {
  it("defaults to ten dots, which is what every store renders today", () => {
    const html = render(12);
    expect(colourwayLinks(html)).toHaveLength(10);
    expect(chipLink(html)?.inner).toContain("+2");
  });

  it("shows no chip at the default cap, and none under it", () => {
    for (const count of [1, 5, 9, 10]) {
      const html = render(count);
      expect(colourwayLinks(html)).toHaveLength(count);
      expect(chipLink(html)).toBeUndefined();
    }
  });

  it("honours a store that lowers the cap in overrides/theme.json", () => {
    theme = { ...STARTER_THEME, catalog: { maxCardSwatches: 4 } };
    const html = render(6);
    // Four dots PLUS the chip, not four including it: a five-colourway card
    // still shows four, where four-including would show three and a "+2".
    expect(colourwayLinks(html)).toHaveLength(4);
    expect(chipLink(html)?.inner).toContain("+2");
  });

  it("sends the chip to the product page, where the full set lives", () => {
    const html = render(12);
    // The card's OWN destination, which is the colourway-qualified PDP for
    // whichever colour the card is previewing — not a bare product URL. That is
    // the card's existing canonical href (`productPath(product, selected)`), so
    // the chip lands exactly where the image and the title already land, and
    // that page lists every colourway.
    const titleHref = anchors(html).find((a) =>
      a.inner.includes("Zip Hoodie"),
    )?.href;
    expect(titleHref).toBe("/shop/clothing/hoodies/zip-hoodie/black");
    expect(chipLink(html)?.href).toBe(titleHref);
  });

  it("gives the chip the same 24 px floor as a dot, as a link", () => {
    const chip = chipLink(render(12));
    expect(chip?.attrs).toContain("h-6");
    expect(chip?.attrs).toContain("min-w-6");
    expect(chip?.attrs).toContain("inline-flex");
  });
});

describe("product card colourway dots — the showSwatches gate", () => {
  it("renders no dot and no chip when the store has swatches off", () => {
    const html = render(12, SWATCHES_OFF);
    expect(colourwayLinks(html)).toHaveLength(0);
    expect(chipLink(html)).toBeUndefined();
    expect(html).not.toContain("h-4 w-4");
    // The chip is inside the same gate, not beside it: a "+2" on a store that
    // shows no swatches would be the one new thing a swatch-off store sees.
    expect(html).not.toContain("more colours");
  });

  it("is the default: an unwrapped card shows nothing either", () => {
    const html = renderToStaticMarkup(<ProductCard product={product(12)} />);
    expect(colourwayLinks(html)).toHaveLength(0);
    expect(chipLink(html)).toBeUndefined();
  });
});

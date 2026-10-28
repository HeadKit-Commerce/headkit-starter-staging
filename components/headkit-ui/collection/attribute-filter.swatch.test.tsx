import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The colour dot in the catalogue filter: the three shopper-visible states, on
 * BOTH surfaces, and the read that makes any of it possible.
 *
 * THE THREE STATES ARE THE POINT, and the first of them is the common one.
 * A store answers the empty string for `swatchColor` / `swatchColor2` until its
 * HeadKit theme carries the colour fields (theme >= 0.4.73), so "no colour" is
 * not an edge case — it must be the text-only row the filter has always
 * rendered: no dot, no empty circle, no grey placeholder, nothing added to the
 * row at all. The other two states are one colour (a solid dot) and two (a
 * 90deg split, the way a product card paints a two-tone colourway).
 *
 * BOTH SURFACES: `AttributeFilter` is the one renderer for the desktop dropdown
 * and the mobile drawer — they differ only by the grid class they pass — so
 * each state is asserted under both.
 *
 * THE READ IS HALF THE FEATURE, and it is the half that fails silently. The
 * SDK's shared `getFilters` selects `slug name count`; `swatchColor` is on the
 * generated TYPE either way, so a render wired perfectly against the shared
 * read compiles, ships, and draws nothing. So the source assertions below pin
 * every facet read that feeds the bar to `getFiltersWithSwatches` — a render
 * guard alone is green under exactly that bug.
 *
 * WHAT NOTHING HERE CAN SEE. This reads emitted markup: no CSS is resolved, no
 * layout is performed and no colour is computed. So it cannot see the dot's
 * 16px box, the 8px gap to the label, that a row with no dot is pixel-identical
 * to before, or what the gradient actually paints. Those are browser
 * measurements and they are in the PR. Nor does it run axe: that the dot adds
 * no tab stop and no duplicate announcement is argued from the markup it emits
 * (no `<button>`, `aria-hidden` on the wrapper), not measured.
 */

const filterValues = {
  categories: [] as string[],
  brands: [] as string[],
  attributes: {} as Record<string, string[]>,
  instock: false,
  page: 1,
};

vi.mock("@/components/headkit-ui/collection/collection-context", () => ({
  useCollection: () => ({
    filterValues,
    setFilterValues: (): void => {},
    productFilter: {},
    isLoading: false,
  }),
}));

import { AttributeFilter } from "./attribute-filter";
import {
  FACET_DRAWER_GRID_CLASS,
  FACET_DROPDOWN_GRID_CLASS,
} from "./facet-panel";

type Option = {
  slug: string;
  name: string;
  count: number;
  swatchColor: string;
  swatchColor2: string;
};

type Attribute = Parameters<typeof AttributeFilter>[0]["attribute"];

function attribute(...options: Option[]): Attribute {
  return {
    slug: "colour",
    name: "Colour",
    options,
  } as unknown as Attribute;
}

/** Both surfaces, so every state is asserted on each of them. */
const SURFACES: Array<[string, string]> = [
  ["desktop dropdown", FACET_DROPDOWN_GRID_CLASS],
  ["mobile drawer", FACET_DRAWER_GRID_CLASS],
];

function markup(attr: Attribute, gridClassName: string): string {
  return renderToStaticMarkup(
    <AttributeFilter attribute={attr} gridClassName={gridClassName} />,
  );
}

/** The dot's own class, which is the only thing that carries it. */
const DOT = "rounded-brand-button";

const NO_COLOUR: Option = {
  slug: "beetle-green",
  name: "Beetle Green",
  count: 1,
  swatchColor: "",
  swatchColor2: "",
};
const ONE_COLOUR: Option = {
  slug: "black",
  name: "Black",
  count: 3,
  swatchColor: "#0a0a0a",
  swatchColor2: "",
};
const TWO_COLOUR: Option = {
  slug: "black-white",
  name: "Black/White",
  count: 2,
  swatchColor: "#0a0a0a",
  swatchColor2: "#ffffff",
};

describe.each(SURFACES)("colour facet dot — %s", (_name, grid) => {
  it("renders NO dot when the option carries no colour", () => {
    // The state every store is in today, and the state production will be in
    // when this merges. The row must be what it already was.
    const html = markup(attribute(NO_COLOUR), grid);
    expect(html).toContain("Beetle Green");
    expect(html).toContain("(1)");
    expect(html).not.toContain(DOT);
    // Not an empty circle, not a placeholder, not a hidden spacer.
    expect(html).not.toContain("aria-hidden");
  });

  it("is byte-identical to a build with no swatch support at all", () => {
    // The strongest form of the claim above: with no colour, the markup must
    // equal what the component emits for an option whose swatch fields are
    // ABSENT — i.e. the shape this component rendered before the dot existed.
    const withEmptyStrings = markup(attribute(NO_COLOUR), grid);
    const withoutTheFields = markup(
      attribute({
        slug: NO_COLOUR.slug,
        name: NO_COLOUR.name,
        count: NO_COLOUR.count,
      } as unknown as Option),
      grid,
    );
    expect(withEmptyStrings).toBe(withoutTheFields);
  });

  it("paints a solid dot for one colour", () => {
    const html = markup(attribute(ONE_COLOUR), grid);
    expect(html).toContain(DOT);
    expect(html).toContain("background-color:#0a0a0a");
    expect(html).not.toContain("linear-gradient");
    expect(html).toContain("Black");
  });

  it("paints a two-tone dot for two colours, the way a card does", () => {
    const html = markup(attribute(TWO_COLOUR), grid);
    expect(html).toContain(DOT);
    // `SwatchDot`'s own 90deg split — the same declaration the product card
    // paints a two-tone colourway with.
    expect(html).toContain(
      "linear-gradient(90deg, #0a0a0a, #0a0a0a 50%, #ffffff 51%)",
    );
  });

  it("draws a dot only for the options that have a colour", () => {
    // A mixed facet is the realistic state once a theme is half-populated: the
    // uncoloured rows must not gain a placeholder to keep the column tidy.
    const html = markup(attribute(NO_COLOUR, ONE_COLOUR, TWO_COLOUR), grid);
    expect(html.split(DOT)).toHaveLength(3); // two dots => two splits + 1
  });

  it("adds no interactive element and no duplicate announcement", () => {
    // `SwatchDot` exists because a `<button>` in this position scored two axe
    // `target-size` failures per dot; the facet row is a `<label>` wrapping an
    // `sr-only` checkbox, so a nested button would reintroduce exactly that.
    const html = markup(attribute(ONE_COLOUR), grid);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("tabindex");
    // `SwatchDot` carries its own `sr-only` name, which the CARD needs because
    // there the dot's link has no visible text. Here the row's visible text is
    // already the checkbox's accessible name, so that second copy would make
    // the control announce "Black Black (3)". It is still in the markup — the
    // component owns it — and what stops it being read is the wrapper: assert
    // the ORDER, which is what proves containment. One wrapper, the sr-only
    // copy inside it, the visible label after it.
    expect(html.split('aria-hidden="true"')).toHaveLength(2);
    const wrapper = html.indexOf('aria-hidden="true"');
    const srOnly = html.indexOf('class="sr-only">Black<');
    const visible = html.indexOf(">Black<", srOnly + 1);
    expect(srOnly).toBeGreaterThan(wrapper);
    expect(visible).toBeGreaterThan(srOnly);
    // And exactly one hidden copy, so the dot is the only thing hiding text.
    expect(html.split('class="sr-only">Black<')).toHaveLength(2);
  });
});

describe("the facet reads must ask for the swatch fields", () => {
  /**
   * The file's CODE, with comments stripped. These modules explain the choice
   * at length in their own headers, and a naive substring search over the whole
   * file matches the prose that says which read is NOT used.
   */
  const read = (path: string): string =>
    readFileSync(join(process.cwd(), path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

  it("reads the swatch-capable method, not the shared one, in every reader that feeds the bar", () => {
    // `lib/catalog-filters.ts` feeds /shop, /sale, /new, /featured, /search and
    // /brand/*; `getCategoryData` feeds /collections/* and /shop/*'s category
    // branch; `getCachedSearchFacets` feeds a query's scoped facets. A swatch
    // needs the fields in ALL THREE selections.
    for (const path of [
      "lib/catalog-filters.ts",
      "lib/collection-canonical.ts",
      "lib/catalog-cache.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("getFiltersWithSwatches(");
      // And the shared read must be gone from the call, not merely joined by
      // the opt-in one — two reads would double the most expensive request in
      // the storefront.
      expect(source).not.toMatch(/collections\.getFilters\(/);
    }
  });

  it("names the two readers that deliberately keep the cheaper shared read", () => {
    // `generateStaticParams` and the sitemap consume `count` only — they
    // enumerate params and emit URLs, they render no filter bar — so asking
    // for two more scalars per option buys nothing there. Pinned so the
    // asymmetry reads as a decision rather than a missed call site.
    for (const path of [
      "app/sitemap.ts",
      "app/collections/[...slug]/page.tsx",
    ]) {
      expect(read(path)).toContain(".getFilters(");
    }
  });
});

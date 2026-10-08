// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";

/**
 * The desktop facet dropdown must SCROLL, and must lay its options out wide
 * enough that a long facet list is not twice as tall as it needs to be.
 *
 * The defect this closes: the Category panel rendered every category in a
 * fixed two-column grid with no height cap. The panel lives in the Radix menu
 * viewport, which is `absolute` under the STICKY facet bar, so it is pinned —
 * measured at 1440x900 with 154 categories, the grid ran y=176 to y=2932 and
 * `window.scrollBy` moved neither number, leaving 2,032px of categories
 * unreachable by any gesture. `facet-panel.ts` carries the measurement notes
 * and the reasoning behind each class.
 *
 * WHAT THIS FILE COVERS, and where each half stops:
 *
 *  - The RENDER half drives the three real facet components in jsdom and reads
 *    the class actually on the grid element. It proves the dropdown ladder
 *    reaches the grid, that the drawer default stays two columns, and that
 *    every option label is a containing block (`relative`) — the one that makes
 *    a focused `sr-only` checkbox scroll the panel instead of the page.
 *
 *  - The SOURCE half asserts the wiring the render cannot see. Radix only
 *    mounts `NavigationMenuContent` while its item is open, and nothing in this
 *    environment can open it (the item's generated value is not addressable
 *    from outside), so the scroll container's presence inside `FilterMenuItem`
 *    and the three dropdown call sites in `filter.tsx` are read from source.
 *    A guard on the constants alone would stay green with the prop thread cut,
 *    which is exactly how the two-column grid survived; a guard on the call
 *    sites alone would stay green if the constants lost their `overflow-y`.
 *
 * WHAT NOTHING HERE CAN SEE. jsdom has no layout: no box, no computed style, no
 * scroll. That the panel ends above the fold at 900px and at 600px, that the
 * last category is reachable, that tabbing scrolls the container and not the
 * window, and that the tablet width really resolves to four columns are all
 * browser measurements — they were taken against a running dev server and are
 * recorded in the PR body, not here.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

// BrandFilter fetches its options through a server action on mount.
vi.mock("@/lib/collection-actions", () => ({
  listFilterBrands: (): Promise<{ slug: string; name: string }[]> =>
    Promise.resolve([
      { slug: "abus", name: "Abus" },
      { slug: "zipp", name: "Zipp" },
    ]),
  listCollectionProducts: (): Promise<never> => new Promise(() => {}),
}));

// The facet components read `filterValues` / `setFilterValues` only; the real
// provider drags in the router, the catalog display context and a fetch layer
// that none of these assertions is about.
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

import { CategoryFilter } from "./category-filter";
import { BrandFilter } from "./brand-filter";
import { AttributeFilter } from "./attribute-filter";
import {
  FACET_DRAWER_GRID_CLASS,
  FACET_DROPDOWN_GRID_CLASS,
  FACET_PANEL_SCROLL_CLASS,
} from "./facet-panel";

const here = join(process.cwd(), "components/headkit-ui/collection");
const read = (file: string): string =>
  readFileSync(join(here, file), "utf8").replace(/\s+/g, " ");

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(node);
  });
  return host;
}

/** The element the options are laid out on, whatever wrapper precedes it. */
function gridOf(host: HTMLElement): HTMLElement {
  const grid = host.querySelector<HTMLElement>("div[class*='grid-cols-']");
  if (!grid) throw new Error("no option grid rendered");
  return grid;
}

const CATEGORIES = [
  { slug: "helmets", name: "Helmets" },
  { slug: "locks", name: "Locks" },
];
const ATTRIBUTE = {
  slug: "colour",
  name: "Colour",
  options: [
    { slug: "black", name: "Black", count: 3 },
    { slug: "red", name: "Red", count: 1 },
  ],
} as unknown as Parameters<typeof AttributeFilter>[0]["attribute"];

describe("facet panel scroll container", () => {
  it("caps its height and scrolls, rather than clipping", () => {
    // The three properties the fix rests on, asserted by meaning rather than by
    // string equality so the value can be retuned without a false failure.
    expect(FACET_PANEL_SCROLL_CLASS).toMatch(/\bmax-h-\[[^\]]+\]/);
    expect(FACET_PANEL_SCROLL_CLASS).toContain("overflow-y-auto");
    // Chaining to the page is what makes the sticky bar scroll away mid-read.
    expect(FACET_PANEL_SCROLL_CLASS).toContain("overscroll-contain");
  });

  it("is the wrapper FilterMenuItem puts every panel's children in", () => {
    const source = read("filter-menu-item.tsx");
    expect(source).toContain(
      "<div className={FACET_PANEL_SCROLL_CLASS}>{children}</div>",
    );
    // The bare `{children}` form is the pre-fix shape; it must not come back
    // alongside the wrapper.
    expect(source).not.toMatch(/<NavigationMenuContent[^>]*>\s*\{children\}/);
  });

  it("does not reach for the shared NavigationMenuViewport", () => {
    // The site mega-menu renders through the same viewport, so capping THERE
    // would change the header dropdown too. The cap belongs to the panel.
    const shared = read("../../ui/navigation-menu.tsx");
    // Height is the open content. A popup-height var is only written by a
    // positioner, and this shell has none — an unset var is not a height.
    expect(shared).not.toContain("h-[var(--popup-height)]");
    expect(shared).not.toContain("overflow-y-auto");
    // Open content must stay in flow. An absolute content box gives the
    // panel a 0 height, the viewport clips, and clicks land on the page.
    expect(shared).not.toContain("md:absolute");
    // The shell only places the panel at the nav's left edge. Width is the
    // content's (`w-screen`, `md:w-max` so a facet panel shrinks). A `w-full`
    // shell clips that content back to the nav.
    expect(shared).toContain("absolute left-0 top-full z-30 w-max");
    expect(shared).not.toContain("absolute left-0 top-full z-30 w-full");
    expect(shared).toContain("w-screen md:w-max");
    expect(shared).not.toContain("--anchor-width");
    expect(shared).not.toContain("md:w-[var(--popup-width)]");
    expect(shared).toContain("closeOnClick = true");
  });
});

describe("facet option columns", () => {
  it("widens the dropdown beyond the drawer's two columns", () => {
    // The facet bar is `hidden md:flex`, so no dropdown renders below `md`
    // and a narrower floor would be dead classes: the ladder starts at four.
    expect(FACET_DROPDOWN_GRID_CLASS).toContain("grid-cols-4");
    expect(FACET_DROPDOWN_GRID_CLASS).toContain("lg:grid-cols-6");
    expect(FACET_DROPDOWN_GRID_CLASS).toContain("gap-6");
    expect(FACET_DROPDOWN_GRID_CLASS).not.toContain("grid-cols-2");
  });

  it("reaches the grid of all three checkbox facets", async () => {
    const category = gridOf(
      render(
        <CategoryFilter
          categories={CATEGORIES}
          gridClassName={FACET_DROPDOWN_GRID_CLASS}
        />,
      ),
    );
    const attribute = gridOf(
      render(
        <AttributeFilter
          attribute={ATTRIBUTE}
          gridClassName={FACET_DROPDOWN_GRID_CLASS}
        />,
      ),
    );
    const brandHost = render(
      <BrandFilter gridClassName={FACET_DROPDOWN_GRID_CLASS} />,
    );
    // BrandFilter renders a placeholder until `listFilterBrands` resolves;
    // flush that so the grid under test is the real one.
    await act(async () => {});

    for (const grid of [category, attribute, gridOf(brandHost)]) {
      expect(grid.className).toBe(FACET_DROPDOWN_GRID_CLASS);
    }
  });

  it("is passed to every dropdown facet and to none of the drawer ones", () => {
    const source = read("filter.tsx");
    // Three dropdown facets carry the ladder: Category, Brand, and each
    // attribute. Price is a two-input row and is not a grid at all.
    const passes = source.match(/gridClassName=\{FACET_DROPDOWN_GRID_CLASS\}/g);
    expect(passes).toHaveLength(3);
    // The drawer's own copies must keep their two columns: the sheet is a
    // fraction of the viewport and the breakpoints are viewport-wide, so a
    // shared ladder would put four columns in a phone-width drawer.
    const drawer = source.slice(source.indexOf("<SheetContent"));
    expect(drawer).not.toContain("FACET_DROPDOWN_GRID_CLASS");
  });

  it("keeps the drawer at two columns when no class is passed", () => {
    const grid = gridOf(render(<CategoryFilter categories={CATEGORIES} />));
    expect(grid.className).toBe(FACET_DRAWER_GRID_CLASS);
    expect(FACET_DRAWER_GRID_CLASS).toContain("grid-cols-2");
  });
});

describe("keyboard reachability", () => {
  it("makes every option label a containing block for its sr-only checkbox", () => {
    // Without `relative` the absolutely positioned checkbox resolves its
    // containing block to the Radix viewport OUTSIDE the scroll container, and
    // focusing it scrolls the WINDOW — measured: tabbing to the last category
    // moved scrollY 1200 to 1511 and took the pinned panel off screen while the
    // container's scrollTop stayed 0.
    const hosts = [
      render(<CategoryFilter categories={CATEGORIES} />),
      render(<AttributeFilter attribute={ATTRIBUTE} />),
    ];
    for (const host of hosts) {
      const labels = [...host.querySelectorAll("label")];
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.className).toContain("relative");
        expect(label.querySelector("input.sr-only")).not.toBeNull();
      }
    }
    // BrandFilter's labels render only after its action resolves; source is the
    // only reading available synchronously.
    expect(read("brand-filter.tsx")).toContain(
      'className="relative flex min-h-10 items-center space-x-2 cursor-pointer"',
    );
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * The Brand facet offers THE ROUTE'S OWN BRANDS, and hides its trigger when the
 * route has none.
 *
 * THE DEFECT. `BrandFilter` fetched a store-wide list (`headkit.brands.list`,
 * no category scope anywhere in the chain) from an effect, so every listing
 * page offered the same panel, and ticking a brand the category does not stock
 * landed on `/f/brand.<slug>` showing "No products found". The scoped, counted
 * list was already in `productFilter` — the payload the route awaits and the
 * sitemap already trusts — so the panel reads that and nothing else.
 *
 * WHAT THIS FILE EXERCISES. The real `Filter` under the real
 * `CollectionProvider` with the real navigation-menu primitive, so the options
 * read below are the ones a shopper opens. The module mock for
 * `@/lib/collection-actions` deliberately exports NO `listFilterBrands`: if the
 * component reached for a store-wide list again these tests would crash rather
 * than pass with a stale one.
 *
 * WHAT IT CANNOT SEE. jsdom resolves no Tailwind class and no router runs, so
 * the counted option sets on a real store at 1440 and in the 390 drawer are
 * browser claims recorded in the PR. The mobile drawer's own gate is read from
 * SOURCE: its Brand section lives inside a `Sheet` this environment does not
 * open.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/collections/bikes/mountain-bikes",
  useRouter: (): { push: () => void; replace: () => void } => ({
    push: (): void => {},
    replace: (): void => {},
  }),
}));

// No `listFilterBrands`: the Brand panel must not read a store-wide list again.
vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> => Promise.resolve({ products: [], total: 0 }),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CollectionProvider } from "@/components/headkit-ui/collection/collection-context";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import { Filter } from "@/components/headkit-ui/collection/filter";
import { brandFacetOptions } from "@/components/headkit-ui/collection/brand-filter";

const PREFS = {
  showVariants: false,
  showSwatches: false,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

let host: HTMLElement;
let root: Root;

function mount(brands: unknown): void {
  act(() => {
    root.render(
      <CatalogDisplayProvider prefs={PREFS}>
        <CollectionProvider
          initialProducts={[]}
          initialTotal={0}
          productFilter={
            {
              categories: [{ slug: "road-bikes", name: "Road Bikes" }],
              attributes: [],
              brands,
            } as never
          }
          categorySlug="mountain-bikes"
          categoryBasePath="/collections/bikes/mountain-bikes"
        >
          <Filter />
        </CollectionProvider>
      </CatalogDisplayProvider>,
    );
  });
}

function trigger(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("brandFacetOptions", () => {
  // The generated type says every field is present; the payload crosses a
  // network and a cache, so the guard is defensive and the fixtures say so.
  const payload = (brands: unknown): Parameters<typeof brandFacetOptions>[0] =>
    ({ brands }) as never;

  it("keeps only options that have both a slug and a name", () => {
    expect(
      brandFacetOptions(
        payload([
          { slug: "summit", name: "Summit", count: 2 },
          { slug: "", name: "No slug", count: 1 },
          { slug: "no-name", name: "", count: 1 },
          null,
        ]),
      ),
    ).toEqual([{ slug: "summit", name: "Summit", count: 2 }]);
  });

  it("is empty when the payload has no brands at all", () => {
    expect(brandFacetOptions(payload(undefined))).toEqual([]);
    expect(brandFacetOptions(payload([]))).toEqual([]);
  });
});

describe("the Brand facet on a listing route", () => {
  it("lists the route's own brands and nothing else", () => {
    mount([{ slug: "summit", name: "Summit", count: 2 }]);
    const brand = trigger("Brand");
    expect(brand).toBeDefined();

    act(() => {
      brand?.click();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const options = [
      ...host.querySelectorAll("[id^='headkit-nav-panel'] label"),
    ].map((l) => l.textContent?.trim());
    expect(options).toEqual(["Summit"]);
  });

  it("hides the Brand trigger when the route stocks no brand", () => {
    mount([]);
    expect(trigger("Brand")).toBeUndefined();
    // Its neighbours are untouched.
    expect(trigger("Category")).toBeDefined();
  });

  it("hides the Brand trigger when the payload carries no brand field", () => {
    mount(undefined);
    expect(trigger("Brand")).toBeUndefined();
  });

  it("gates the mobile drawer's Brand section on the same list", () => {
    // The drawer lives inside a `Sheet` this environment does not open, so the
    // wiring is read from source: one derivation, one guard, both surfaces.
    const source = readFileSync(
      join(process.cwd(), "components/headkit-ui/collection/filter.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source).toContain(
      "const showBrand = brandFacetOptions(productFilter).length > 0;",
    );
    expect(source.match(/\{showBrand && \(/g)).toHaveLength(2);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ProductFilters,
  ProductSummaryFieldsFragment,
} from "@headkit/sdk";

/**
 * `/search` filter options counted over the query's matches.
 *
 * The contract (captain, 2026-10-20): the products render immediately; the
 * filter bar shows skeleton pills while the scoped options load and swaps to
 * the real options AT MOST ONCE; Sort stays usable throughout; a failed or
 * slow (> SEARCH_FACETS_TIMEOUT_MS) read hides the filter buttons and keeps
 * the products; and the store-wide options are never shown first and then
 * replaced. This drives the REAL provider and the REAL filter bar; only the
 * server actions, the router and `fetch` are stand-ins.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/search",
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
  useRouter: () => ({ push: (): void => {}, replace: (): void => {} }),
}));

type SearchPage = {
  products: ProductSummaryFieldsFragment[];
  total: number;
  totalPages: number;
  page: number;
  matchedProductIds: number[] | null;
};

const actions = vi.hoisted(() => ({
  listSearchProducts: vi.fn(),
  listCollectionProducts: vi.fn(),
  listFilterBrands: vi.fn(),
}));
vi.mock("@/lib/collection-actions", () => actions);

import { CollectionProvider, useCollection } from "./collection-context";
import { Filter } from "./filter";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import { SEARCH_FACETS_TIMEOUT_MS } from "./search-facets";

const PREFS = {
  showVariants: false,
  showSwatches: false,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

/** The store-wide options the route renders with. They must never show on
 *  a query that has a scope. */
const STORE_WIDE = {
  categories: [{ id: "c1", slug: "everything", name: "Everything" }],
  attributes: [],
  brands: [],
  minPrice: "0",
  maxPrice: "0",
} as unknown as ProductFilters;

const SCOPED = {
  categories: [{ id: "c2", slug: "helmets", name: "Helmets" }],
  attributes: [
    {
      id: "a1",
      slug: "colour",
      name: "Colour",
      options: [{ slug: "black", name: "Black", count: 2 }],
    },
  ],
  brands: [{ slug: "giro", name: "Giro", count: 2 }],
  minPrice: "50",
  maxPrice: "300",
} as unknown as ProductFilters;

function product(name: string): ProductSummaryFieldsFragment {
  return {
    id: name,
    name,
    slug: name,
    attributes: [],
    variations: [],
  } as unknown as ProductSummaryFieldsFragment;
}

function page(matchedProductIds: number[] | null): SearchPage {
  return {
    products: [product("helmet-a"), product("helmet-b")],
    total: 2,
    totalPages: 1,
    page: 1,
    matchedProductIds,
  };
}

/** The live context, published after each commit by the probe below. */
const probe: { current: ReturnType<typeof useCollection> | null } = {
  current: null,
};
function Probe(): null {
  const ctx = useCollection();
  useEffect(() => {
    probe.current = ctx;
  });
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <CatalogDisplayProvider prefs={PREFS}>
        <CollectionProvider
          initialProducts={[]}
          initialTotal={0}
          productFilter={STORE_WIDE}
          scopedSearchFacets
        >
          <Filter />
          <Probe />
        </CollectionProvider>
      </CatalogDisplayProvider>,
    );
  });
  return host;
}

/** Let resolved promises and the effects they schedule run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const skeletons = (el: HTMLElement): number =>
  el.querySelectorAll("[data-facet-skeleton]").length;
/** Visible text, minus the skeleton pills' invisible sizing labels. */
const text = (el: HTMLElement): string => {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-facet-skeleton]").forEach((n) => n.remove());
  return copy.textContent ?? "";
};

let fetchMock: ReturnType<typeof vi.fn>;
let resolveFacets: ((body: ProductFilters) => void) | null;
let rejectFacets: ((status: number) => void) | null;

beforeEach(() => {
  window.history.replaceState(null, "", "/search?q=helmet");
  actions.listSearchProducts.mockReset();
  actions.listCollectionProducts.mockReset();
  actions.listFilterBrands.mockReset();
  actions.listFilterBrands.mockResolvedValue([]);
  actions.listCollectionProducts.mockResolvedValue(page(null));
  resolveFacets = null;
  rejectFacets = null;
  fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolveFacets = (body) =>
          resolve({ ok: true, status: 200, json: async () => body } as never);
        rejectFacets = (status) =>
          resolve({ ok: false, status, json: async () => ({}) } as never);
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  probe.current = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/search scoped filter options", () => {
  it("shows skeleton pills, then the scoped options, and never the store-wide ones", async () => {
    actions.listSearchProducts.mockResolvedValue(page([1388, 1201]));
    const el = await mount();
    await flush();

    // The term's first fetch read the matched IDs, and the filter read went
    // out with exactly those IDs.
    expect(actions.listSearchProducts).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/search-filters");
    expect(JSON.parse(String(init.body))).toEqual({
      productIds: [1388, 1201],
    });

    // Loading: pills, Sort, the mobile Filters button; no option buttons.
    expect(probe.current?.facetStatus).toBe("loading");
    expect(skeletons(el)).toBeGreaterThan(0);
    expect(text(el)).toContain("Sort");
    expect(text(el)).toContain("Filters");
    expect(text(el)).not.toContain("Category");
    expect(text(el)).not.toContain("Everything");

    await act(async () => resolveFacets?.(SCOPED));
    await flush();

    expect(probe.current?.facetStatus).toBe("ready");
    expect(skeletons(el)).toBe(0);
    expect(text(el)).toContain("Category");
    expect(text(el)).toContain("Brand");
    expect(text(el)).toContain("Colour");
    expect(probe.current?.productFilter).toBe(SCOPED);
  });

  it("asks for the IDs once per term: a sort change does not re-read them", async () => {
    actions.listSearchProducts.mockResolvedValue(page([7]));
    await mount();
    await flush();
    await act(async () => resolveFacets?.(SCOPED));
    await flush();

    await act(async () => {
      probe.current?.setFilterValues({
        ...probe.current.filterValues,
        sort: "PRICE",
      });
    });
    await flush();

    expect(actions.listCollectionProducts).toHaveBeenCalled();
    expect(actions.listSearchProducts).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(probe.current?.facetStatus).toBe("ready");
  });

  it("hides the filter buttons when the read fails, and keeps Sort", async () => {
    actions.listSearchProducts.mockResolvedValue(page([7]));
    const el = await mount();
    await flush();

    await act(async () => rejectFacets?.(502));
    await flush();

    expect(probe.current?.facetStatus).toBe("hidden");
    expect(skeletons(el)).toBe(0);
    expect(text(el)).not.toContain("Category");
    expect(text(el)).not.toContain("Brand");
    expect(text(el)).not.toContain("Filters");
    expect(text(el)).toContain("Sort");
    expect(probe.current?.products).toHaveLength(2);
  });

  it(`hides the filter buttons after ${SEARCH_FACETS_TIMEOUT_MS} ms without an answer`, async () => {
    vi.useFakeTimers();
    actions.listSearchProducts.mockResolvedValue(page([7]));
    const el = await mount();
    await flush();
    expect(probe.current?.facetStatus).toBe("loading");

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_FACETS_TIMEOUT_MS - 1);
    });
    expect(probe.current?.facetStatus).toBe("loading");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(probe.current?.facetStatus).toBe("hidden");
    expect(skeletons(el)).toBe(0);

    // A late answer must not bring them back: one swap at most.
    await act(async () => resolveFacets?.(SCOPED));
    await flush();
    expect(probe.current?.facetStatus).toBe("hidden");
  });

  it("hides the filter buttons when the term matched nothing, without a read", async () => {
    actions.listSearchProducts.mockResolvedValue({
      ...page([]),
      products: [],
      total: 0,
    });
    const el = await mount();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe.current?.facetStatus).toBe("hidden");
    expect(text(el)).not.toContain("Category");
  });

  it("keeps the route's options when the search was not served by Atlas (no ID scope)", async () => {
    actions.listSearchProducts.mockResolvedValue(page(null));
    const el = await mount();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe.current?.facetStatus).toBe("static");
    expect(probe.current?.productFilter).toBe(STORE_WIDE);
    expect(text(el)).toContain("Category");
  });

  it("hides the filter buttons when the grid fetch itself fails", async () => {
    actions.listSearchProducts.mockRejectedValue(new Error("gateway down"));
    await mount();
    await flush();

    expect(probe.current?.facetStatus).toBe("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a bare /search on the route's options", async () => {
    window.history.replaceState(null, "", "/search");
    const el = await mount();
    await flush();

    expect(actions.listSearchProducts).not.toHaveBeenCalled();
    expect(probe.current?.facetStatus).toBe("static");
    expect(text(el)).toContain("Category");
  });
});

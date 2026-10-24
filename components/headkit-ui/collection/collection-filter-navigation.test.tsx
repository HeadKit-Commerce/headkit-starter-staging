// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * A filter change that NAVIGATES pushes a filter path; one served in place
 * fetches via `listCollectionProducts` and must keep the cards the shopper
 * is reading. Destination `loading.tsx` covers cold navigations.
 */

// React 19 needs this before `act` will flush updates synchronously.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

const push = vi.fn();

/**
 * Set to hold the pushed navigation open, the way a real `router.push` is held open
 * by the destination's RSC payload.
 *
 * jsdom has no router, so a mocked `push` returns instantly and React settles the
 * transition it rides in before the 400 ms threshold can be reached — every skeleton
 * assertion would then pass for the wrong reason. The provider calls
 * `startTransition` with a concise body, so `push`'s return value IS the
 * transition's result: returning a promise here makes React keep `isPending` true
 * until it resolves, which is the only lever this environment offers.
 */
let resolveNavigation: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  // Literal, not BASE_PATH: `vi.mock` factories are hoisted above the top-level
  // consts, so reading one here is a TDZ crash.
  usePathname: (): string => "/collections/clothing",
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
  useRouter: (): {
    push: (url: string) => void | Promise<void>;
    replace: () => void;
  } => ({
    push: (url: string): void | Promise<void> => {
      push(url);
      if (!holdNavigation) return;
      return new Promise<void>((resolve) => {
        resolveNavigation = resolve;
      });
    },
    replace: (): void => {},
  }),
}));

/** Opt-in per test: most of them only care which path a change took. */
let holdNavigation = false;

/**
 * The server action, under the test's control so an in-place change can be held in
 * flight across the skeleton threshold instead of resolving instantly.
 */
let pendingFetch: {
  resolve: (value: {
    products: ProductSummaryFieldsFragment[];
    total: number;
  }) => void;
} | null = null;

vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> =>
    new Promise((resolve) => {
      pendingFetch = { resolve };
    }),
}));

// The filter sidebar needs popovers and icons this test has no opinion about; the
// filter values are driven through the context directly instead.
vi.mock("@/components/headkit-ui/collection/filter", () => ({
  Filter: (): null => null,
}));

// A card is one product name; the grid's own composition is covered elsewhere.
vi.mock("@/components/headkit-ui/product-card", () => ({
  ProductCard: ({
    product,
  }: {
    product: { name: string };
  }): React.JSX.Element => <span data-testid="card">{product.name}</span>,
}));

import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import { useCollection } from "@/components/headkit-ui/collection/collection-context";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";

const PREFS = {
  showVariants: false,
  showSwatches: false,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

function product(name: string): ProductSummaryFieldsFragment {
  return {
    id: name,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    uri: `https://commerce.example.com/product/${name}/`,
    sku: `SKU-${name}`,
    type: "simple",
    price: "100",
    regularPrice: "100",
    salePrice: "",
    onSale: false,
    isNew: false,
    stockStatus: "instock",
    shortDescription: "",
    description: "",
    seo: null,
    image: { src: "https://cdn.example/x.jpg", alt: "", width: 1, height: 1 },
    galleryImages: [],
    attributes: [],
    variations: [],
    productCategories: [],
    brands: [],
  } as unknown as ProductSummaryFieldsFragment;
}

const PAGE_ONE = [product("Alpine Jacket"), product("Harbour Pump")];

const BASE_PATH = "/collections/clothing";

/** A handle on the live context, so a filter change can be driven exactly as the
 *  real checkbox, sort menu and Load More button drive it — through the provider's
 *  own API rather than by reaching into its state. */
type Handle = ReturnType<typeof useCollection>;
let handle: Handle | null = null;

function tree(props: {
  initialProducts: ProductSummaryFieldsFragment[];
  initialTotal: number;
  initialFilterValues?: Record<string, string[]>;
}): React.JSX.Element {
  return (
    <CatalogDisplayProvider prefs={PREFS}>
      <CollectionPage
        initialProducts={props.initialProducts}
        initialTotal={props.initialTotal}
        productFilter={{ attributes: [], brands: [] } as never}
        categorySlug="clothing"
        categoryBasePath={BASE_PATH}
        {...(props.initialFilterValues
          ? { initialFilterValues: props.initialFilterValues }
          : {})}
      />
    </CatalogDisplayProvider>
  );
}

// The probe has to sit UNDER the provider, and `CollectionPage` renders a fixed
// child tree, so the pagination slot is borrowed: `ProductCount` is a context
// consumer already, and swapping it for one that also publishes the context is the
// least invasive way in. `LoadMore` is stubbed out with it — the button's own wiring
// is `pagination.tsx`'s, and what matters here is what `loadMore()` does to the grid.
vi.mock("@/components/headkit-ui/collection/pagination", () => ({
  LoadPrevious: (): null => null,
  LoadMore: (): null => null,
  ProductCount: (): React.JSX.Element => {
    const ctx = useCollection();
    handle = ctx;
    return (
      <p data-testid="count">{`total:${ctx.totalProducts} page:${ctx.currentPage}`}</p>
    );
  },
}));

function names(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-testid="card"]')].map(
    (el) => el.textContent ?? "",
  );
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  window.history.replaceState(null, "", BASE_PATH);
  holdNavigation = false;
  resolveNavigation = null;
  pendingFetch = null;
  handle = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function mount(initialFilterValues?: Record<string, string[]>): void {
  act(() => {
    root.render(
      tree({
        initialProducts: PAGE_ONE,
        initialTotal: 2,
        ...(initialFilterValues ? { initialFilterValues } : {}),
      }),
    );
  });
}

/** Let every queued effect, transition and microtask settle. */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(800);
  });
}

describe("a filter change that navigates", () => {
  it("pushes the filter path instead of fetching in place", async () => {
    mount();
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      handle?.setFilterValues({
        ...handle.filterValues,
        attributes: { pa_colour: ["black"] },
        page: 1,
      });
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toBe(`${BASE_PATH}/f/colour.black`);
    // The navigation renders the filtered set on the server; fetching it here too
    // would be the same products over the wire twice.
    expect(pendingFetch).toBeNull();
  });
});

describe("a listing update served in place", () => {
  it("keeps the cards for Load More while the fetch is in flight", async () => {
    mount();
    // A second page exists, so Load More is live.
    await act(async () => {
      handle?.setFilterValues({ ...handle.filterValues, sort: "PRICE" });
    });
    expect(
      push,
      "sort is a query parameter, not part of the filter slug: it must be served in place",
    ).not.toHaveBeenCalled();
    expect(pendingFetch).not.toBeNull();
    act(() => {
      pendingFetch?.resolve({ products: PAGE_ONE, total: 4 });
    });
    await act(async () => {});
    pendingFetch = null;

    await act(async () => {
      handle?.loadMore();
    });
    settle();
    expect(pendingFetch).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(names(host)).toEqual(["Alpine Jacket", "Harbour Pump"]);

    await act(async () => {
      pendingFetch?.resolve({ products: [product("Cadex Wheel")], total: 3 });
    });

    expect(names(host)).toEqual([
      "Alpine Jacket",
      "Harbour Pump",
      "Cadex Wheel",
    ]);
  });

  it("serves a sort change in place without navigating", async () => {
    mount();

    await act(async () => {
      handle?.setFilterValues({
        ...handle.filterValues,
        sort: "PRICE",
        page: 1,
      });
    });

    // Sort is a query parameter, not part of the filter slug, so it is served in
    // place — no navigation, and the in-grid cue owns the wait.
    expect(push).not.toHaveBeenCalled();

    settle();
    expect(pendingFetch).not.toBeNull();
    expect(names(host)).toEqual(["Alpine Jacket", "Harbour Pump"]);

    await act(async () => {
      pendingFetch?.resolve({ products: [product("Cadex Wheel")], total: 1 });
    });

    expect(names(host)).toEqual(["Cadex Wheel"]);
  });

  it("serves an in-stock toggle in place without navigating", async () => {
    mount();

    await act(async () => {
      handle?.setFilterValues({
        ...handle.filterValues,
        instock: true,
        page: 1,
      });
    });

    expect(push).not.toHaveBeenCalled();
    settle();
  });
});

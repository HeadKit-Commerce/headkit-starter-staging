// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * A filter change served in place keeps the previous cards on screen until the
 * new ones arrive, and the only other cue is a skeleton row under the last
 * card — below the fold on a long page. The grid has to say it is updating
 * (and scroll there as the request STARTS), then stop saying it once the
 * results commit. The initial render must say and do nothing.
 */

// React 19 needs this before `act` will flush updates synchronously.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

/**
 * Resolves the pushed navigation. A mocked `push` returning a promise is the
 * only way to hold a transition open in jsdom, where there is no router to
 * suspend on a real payload.
 */
let resolveNavigation: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/collections/clothing",
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
  useRouter: (): {
    push: () => Promise<void>;
    replace: () => void;
  } => ({
    push: (): Promise<void> =>
      new Promise<void>((resolve) => {
        resolveNavigation = resolve;
      }),
    replace: (): void => {},
  }),
}));

let pendingFetch: {
  resolve: (value: {
    products: ProductSummaryFieldsFragment[];
    total: number;
  }) => void;
  reject: (reason: Error) => void;
} | null = null;

vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> =>
    new Promise((resolve, reject) => {
      pendingFetch = { resolve, reject };
    }),
}));

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
    sku: `SKU-${name}`,
    type: "simple",
    price: "100",
    regularPrice: "100",
    salePrice: "",
    onSale: false,
    isNew: false,
    stockStatus: "instock",
  } as unknown as ProductSummaryFieldsFragment;
}

type Handle = ReturnType<typeof useCollection>;
let handle: Handle | null = null;

// The probe has to sit UNDER the provider; `ProductCount` is a context consumer
// already, so it is the least invasive slot to borrow (see
// `collection-filter-navigation.test.tsx`).
vi.mock("@/components/headkit-ui/collection/pagination", () => ({
  LoadPrevious: (): null => null,
  LoadMore: (): null => null,
  ProductCount: (): null => {
    handle = useCollection();
    return null;
  },
}));

const scrollIntoView = vi.fn();

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  window.history.replaceState(null, "", "/collections/clothing");
  pendingFetch = null;
  resolveNavigation = null;
  handle = null;
  scrollIntoView.mockReset();
  // jsdom implements neither; the provider guards for that, so install it here
  // to observe WHEN the scroll happens.
  Element.prototype.scrollIntoView = scrollIntoView;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <CatalogDisplayProvider prefs={PREFS}>
        <CollectionPage
          initialProducts={[product("Alpine Jacket"), product("Harbour Pump")]}
          initialTotal={2}
          productFilter={{ attributes: [], brands: [] } as never}
          categorySlug="clothing"
          categoryBasePath="/collections/clothing"
        />
      </CatalogDisplayProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function notice(): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>('[role="status"]')].find((el) =>
      el.textContent?.includes("Updating products"),
    ) ?? null
  );
}

describe("the grid says it is updating", () => {
  it("says and does nothing on the initial render", () => {
    expect(notice()).toBeNull();
    expect(host.querySelector("[aria-busy]")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(pendingFetch).toBeNull();
  });

  it("shows the notice and scrolls when an in-stock toggle starts, and clears it on commit", async () => {
    await act(async () => {
      handle?.setFilterValues({
        ...handle.filterValues,
        instock: true,
        page: 1,
      });
    });

    expect(pendingFetch).not.toBeNull();
    expect(notice()).not.toBeNull();
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(notice()?.nextElementSibling?.className ?? "").toContain(
      "opacity-40",
    );
    // The request has started and the results have not committed: the scroll
    // can only have come from the request starting.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(
      [...host.querySelectorAll('[data-testid="card"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Alpine Jacket", "Harbour Pump"]);

    await act(async () => {
      pendingFetch?.resolve({ products: [product("Cadex Wheel")], total: 1 });
    });

    expect(notice()).toBeNull();
    expect(host.querySelector("[aria-busy]")).toBeNull();
  });

  it("clears the notice when the request fails, keeping the previous cards", async () => {
    await act(async () => {
      handle?.setFilterValues({ ...handle.filterValues, sort: "PRICE" });
    });
    expect(notice()).not.toBeNull();

    await act(async () => {
      pendingFetch?.reject(new Error("upstream"));
    });

    expect(notice()).toBeNull();
    expect(host.querySelector("[aria-busy]")).toBeNull();
    expect(
      [...host.querySelectorAll('[data-testid="card"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Alpine Jacket", "Harbour Pump"]);
  });

  it("shows the notice and scrolls while an attribute filter navigates, and clears it when the route lands", async () => {
    await act(async () => {
      handle?.setFilterValues({
        ...handle.filterValues,
        attributes: { pa_colour: ["black"] },
        page: 1,
      });
    });

    // A path change is not an in-place fetch: nothing in the grid changes until
    // the destination's payload arrives.
    expect(pendingFetch).toBeNull();
    expect(resolveNavigation).not.toBeNull();
    expect(notice()).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveNavigation?.();
    });

    expect(notice()).toBeNull();
    expect(host.querySelector("[aria-busy]")).toBeNull();
  });

  it("does not scroll for Load More, which appends rather than replaces", async () => {
    await act(async () => {
      handle?.loadMore();
    });
    expect(notice()).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

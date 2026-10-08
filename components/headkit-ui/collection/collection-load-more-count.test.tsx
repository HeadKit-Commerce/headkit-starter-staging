// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * Load More, and the clamp that stops the sentinel once the list is exhausted.
 *
 * `fetchProducts` reads `productsCountRef` — a synchronous mirror of
 * `products.length` — in two places: `loadMore`'s "already have them all"
 * guard, and the clamp that sets `totalProducts` to the count actually held
 * when an "after" page comes back EMPTY (the provider's total came from the
 * server and can be stale, so the empty page is the real terminator).
 *
 * That mirror used to be written in the provider's render body
 * (`productsCountRef.current = products.length`), which `react-hooks/refs`
 * reports: a render React discards would write a pre-append count back over a
 * mirror an appended page had already moved forward. It is now written by
 * `commitProducts`, the single writer of `products`, from the very list it
 * returns.
 *
 * The clamp is what makes the difference observable. A mirror still holding the
 * INITIAL count would clamp the total back to 2 with four products on screen,
 * leaving `hasMore` true against a list that has no more pages — the sentinel
 * then refires forever. The second test below is that assertion.
 *
 * jsdom, for the same reason as `collection-page.route-change.test.tsx`: the
 * claim is literally about state and a ref surviving across renders. Keep the
 * workspace default (`node`) for anything expressible as a pure step.
 */

// React 19 needs this before `act` will flush updates synchronously.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/search",
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
  useRouter: (): { push: () => void; replace: () => void } => ({
    push: (): void => {},
    replace: (): void => {},
  }),
}));

const { listCollectionProducts } = vi.hoisted(() => ({
  listCollectionProducts:
    vi.fn<
      () => Promise<{ products: ProductSummaryFieldsFragment[]; total: number }>
    >(),
}));

vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> => listCollectionProducts(),
}));

import {
  CollectionProvider,
  useCollection,
} from "@/components/headkit-ui/collection/collection-context";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import type { CatalogDisplayPrefs } from "@/lib/catalog-display";

const PREFS: CatalogDisplayPrefs = {
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

/**
 * Reads the provider through the same context the real pagination does, and
 * exposes `loadMore` as a button, so nothing here reaches into provider state.
 */
function Probe(): React.JSX.Element {
  const { products, totalProducts, hasMore, loadMore } = useCollection();
  return (
    <div>
      <p data-testid="state">{`count:${products.length} total:${totalProducts} hasMore:${hasMore}`}</p>
      <button type="button" data-testid="more" onClick={loadMore}>
        more
      </button>
    </div>
  );
}

function mount(): {
  host: HTMLElement;
  unmount: () => void;
  state: () => string;
  clickMore: () => Promise<void>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <CatalogDisplayProvider prefs={PREFS}>
        <CollectionProvider
          initialProducts={[product("Evade Helmet"), product("Hale Helmet")]}
          initialTotal={84}
          productFilter={{} as never}
          itemsPerPage={2}
          search="helmet"
        >
          <Probe />
        </CollectionProvider>
      </CatalogDisplayProvider>,
    );
  });
  return {
    host,
    unmount: (): void => {
      act(() => root.unmount());
      host.remove();
    },
    state: (): string =>
      host.querySelector('[data-testid="state"]')?.textContent ?? "",
    clickMore: async (): Promise<void> => {
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="more"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
  };
}

describe("CollectionProvider — Load More and the exhausted-list clamp", () => {
  // One jsdom window serves every test in the file, and a successful page load
  // calls `history.replaceState` to put `?page=2` in the address bar. Left
  // there, the NEXT mount's query-state correction reads that page, replaces
  // `filterValues`, and the provider issues a `"middle"` fetch of its own
  // before any click — which REPLACES the list instead of appending to it. The
  // reset keeps each case's first request the one its click makes.
  beforeEach(() => {
    window.history.replaceState(null, "", "/search?q=helmet");
    listCollectionProducts.mockReset();
  });

  it("appends a page and keeps the server total", async () => {
    listCollectionProducts.mockResolvedValueOnce({
      products: [product("Align Helmet"), product("Tactic Helmet")],
      total: 84,
    });

    const h = mount();
    expect(h.state()).toBe("count:2 total:84 hasMore:true");

    await h.clickMore();
    expect(h.state()).toBe("count:4 total:84 hasMore:true");

    h.unmount();
  });

  it("clamps the total to what is held when the next page comes back empty", async () => {
    listCollectionProducts.mockResolvedValueOnce({
      products: [product("Align Helmet"), product("Tactic Helmet")],
      total: 84,
    });
    listCollectionProducts.mockResolvedValueOnce({ products: [], total: 84 });

    const h = mount();
    await h.clickMore();
    await h.clickMore();

    // 4, not 2: the clamp reads the mirror of the APPENDED list. A mirror left
    // behind at the initial count would say `total:2 hasMore:true` here, and
    // the Load More sentinel would never stop firing.
    expect(h.state()).toBe("count:4 total:4 hasMore:false");

    h.unmount();
  });

  it("stops asking once the held count reaches the total", async () => {
    listCollectionProducts.mockResolvedValueOnce({
      products: [product("Align Helmet"), product("Tactic Helmet")],
      total: 4,
    });

    const h = mount();
    await h.clickMore();
    expect(h.state()).toBe("count:4 total:4 hasMore:false");

    // `loadMore`'s guard is the mirror, not `products.length`; a stale mirror
    // would let this second click issue a request for page 3.
    await h.clickMore();
    expect(listCollectionProducts).toHaveBeenCalledTimes(1);

    h.unmount();
  });
});

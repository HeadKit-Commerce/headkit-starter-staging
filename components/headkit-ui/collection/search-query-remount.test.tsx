// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * `/search?q=helmet` → `/search?q=gloves` as the search drawer's "View more
 * results" performs it: the URL changes while the page's RSC payload — which
 * does not read `?q=` — is identical, so Next does NOT re-render the page tree.
 * Only a component that SUBSCRIBES to the router (`useSearchParams`) updates;
 * that was measured in a production build, where an effect on the remount
 * component ran once across a `router.push`.
 *
 * The `next/navigation` mock below models exactly that: `useSearchParams` is an
 * external-store subscription, and `softNavigate` moves the URL and notifies the
 * subscribers WITHOUT re-rendering the tree from the root. A test that
 * re-rendered the root on every navigation would pass against an implementation
 * that depends on a re-render, which is the shape this defect had.
 *
 * This renders the page's real composition — `SearchQueryRemount` →
 * `CollectionPage` → `CollectionProvider` → `SearchResultsHeading` +
 * `ProductGrid` — and asserts the grid and the title both follow the new query.
 * Without the remount the provider keeps the helmet grid, which is the defect.
 *
 * What it does NOT cover: Next's real router, the hold CSS, and the server read
 * behind `initialProducts`. That a soft navigation updates the grid and the
 * heading in a real browser, and that `/search` is still a finished static
 * file, are measurements recorded in the PR.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

const urlListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: (): string => "/search",
    useRouter: (): { push: () => void; replace: () => void } => ({
      push: (): void => {},
      replace: (): void => {},
    }),
    // A subscription, like the real hook: only its consumer re-renders when the
    // URL moves. The snapshot is the query string, which is stable between
    // calls, and the params object is derived from it.
    useSearchParams: (): URLSearchParams => {
      const search = useSyncExternalStore(
        (listener) => {
          urlListeners.add(listener);
          return () => urlListeners.delete(listener);
        },
        () => window.location.search,
        () => "",
      );
      return new URLSearchParams(search);
    },
  };
});

const listCollectionProducts = vi.fn(
  async (filter: {
    search?: string;
  }): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> => {
    if (filter.search === "helmet") return { products: HELMETS, total: 52 };
    if (filter.search === "gloves") return { products: GLOVES, total: 32 };
    return { products: CATALOG, total: 2678 };
  },
);
vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (...args: unknown[]) =>
    listCollectionProducts(...(args as [{ search?: string }])),
}));

vi.mock("@/components/headkit-ui/collection/filter", () => ({
  Filter: (): null => null,
}));

vi.mock("@/components/headkit-ui/product-card", () => ({
  ProductCard: ({
    product,
  }: {
    product: { name: string };
  }): React.JSX.Element => <span data-testid="card">{product.name}</span>,
}));

import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import { SearchQueryRemount } from "@/components/headkit-ui/collection/search-query-remount";
import { SearchResultsHeading } from "@/components/headkit-ui/collection/search-results-heading";
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

const CATALOG = [product("Catalog Bike")];
const HELMETS = [product("Evade Helmet"), product("Hale Helmet")];
const GLOVES = [product("Trail Gloves")];

/** The `/search` page's client tree, with the prerendered (unfiltered) page 1. */
function searchPage(): React.JSX.Element {
  return (
    <CatalogDisplayProvider prefs={PREFS}>
      <SearchQueryRemount>
        <CollectionPage
          header={<SearchResultsHeading title="Search" description="Bare" />}
          initialProducts={CATALOG}
          initialTotal={2678}
          productFilter={{} as never}
          initialPage={1}
        />
      </SearchQueryRemount>
    </CatalogDisplayProvider>
  );
}

function names(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-testid="card"]')].map(
    (el) => el.textContent ?? "",
  );
}

function heading(host: HTMLElement): string {
  const h1 = host.querySelector("h1");
  return `${h1?.textContent ?? ""} | ${h1?.nextElementSibling?.textContent ?? ""}`;
}

/** Let the fetch promise and the state it commits settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState(null, "", "/");
  listCollectionProducts.mockClear();
});

async function mountAt(url: string): Promise<HTMLElement> {
  window.history.replaceState(null, "", url);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(searchPage());
  });
  await settle();
  return host;
}

/**
 * A soft navigation: the URL moves and the router's subscribers are told. The
 * page tree is NOT re-rendered from the root — see the file header.
 */
async function softNavigate(url: string): Promise<void> {
  window.history.pushState(null, "", url);
  act(() => {
    for (const listener of urlListeners) listener();
  });
  await settle();
}

describe("/search across a soft navigation from ?q=a to ?q=b", () => {
  it("applies the new query to the grid and the title", async () => {
    const page = await mountAt("/search?q=helmet");
    expect(names(page)).toEqual(["Evade Helmet", "Hale Helmet"]);
    expect(heading(page)).toBe(
      'Search results for "helmet" | 52 products found for "helmet"',
    );

    await softNavigate("/search?q=gloves");

    expect(names(page)).toEqual(["Trail Gloves"]);
    expect(heading(page)).toBe(
      'Search results for "gloves" | 32 products found for "gloves"',
    );
    expect(listCollectionProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "gloves" }),
      1,
      24,
    );
  });

  it("does not refetch when the page re-renders on the same query", async () => {
    const page = await mountAt("/search?q=helmet");
    const calls = listCollectionProducts.mock.calls.length;

    act(() => {
      root!.render(searchPage());
    });
    await settle();

    expect(listCollectionProducts.mock.calls.length).toBe(calls);
    expect(names(page)).toEqual(["Evade Helmet", "Hale Helmet"]);
  });

  it("follows a second navigation too, and a return to the first query", async () => {
    const page = await mountAt("/search?q=helmet");
    await softNavigate("/search?q=gloves");
    await softNavigate("/search?q=helmet");

    expect(names(page)).toEqual(["Evade Helmet", "Hale Helmet"]);
    expect(heading(page)).toBe(
      'Search results for "helmet" | 52 products found for "helmet"',
    );
  });

  it("leaves the grid alone when only a non-query param moves", async () => {
    const page = await mountAt("/search?q=helmet");
    const calls = listCollectionProducts.mock.calls.length;

    // What the provider's own `history.replaceState` writes look like: `q` is
    // untouched, so this must not be read as a new search.
    await softNavigate("/search?q=helmet&sort=PRICE_ASC");

    expect(listCollectionProducts.mock.calls.length).toBe(calls);
    expect(names(page)).toEqual(["Evade Helmet", "Hale Helmet"]);
  });

  it("renders the bare page's own title with no query", async () => {
    const page = await mountAt("/search");
    expect(heading(page)).toBe("Search | Bare");
    expect(names(page)).toEqual(["Catalog Bike"]);
  });
});

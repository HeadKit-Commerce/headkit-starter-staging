import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, type ReactElement } from "react";

/**
 * Where the nested `/shop/[...slug]` route puts its boundary, per branch.
 *
 * The page passes `params` into `ShopRoute` inside Suspense and does not
 * await them itself. That is the Next.js 16 shape: URL data stays out of the
 * shared App Shell, and `prefetch={true}` can resolve the cached product
 * before the click. `loading.tsx` stays as the instant fallback. The child
 * still must not await `searchParams`: that read postpones the boundary and
 * the prerender is only the skeleton.
 *
 * The category branch has NO boundary either, for the same reason:
 * `CollectionRoute` reads no `searchParams`, so its heading and
 * page-1 grid render in the static shell. That only holds while
 * `CollectionProvider` — the client component every listing route mounts —
 * calls no `useSearchParams()`, which is itself a request-time read and turned
 * the whole route dynamic (`f`, 0-byte shell) while it was there. Both halves
 * are asserted below, because either one alone passes with the other broken.
 *
 * The 404 gate (index / unknown / no candidate) is `app/not-found-status.test.ts`;
 * metadata and `generateStaticParams` are `./page.test.ts`.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: "pk_store",
    NEXT_PUBLIC_GRAPHQL_URL: "https://graph.example.test/graphql",
    HEADKIT_PRIVATE_KEY: "sk_store",
  },
}));

vi.mock("next/cache", () => ({
  cacheTag: (): void => {},
  cacheLife: (): void => {},
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  unstable_rethrow: (): void => {},
}));

const TREE = [
  { slug: "clothing", children: [{ slug: "hoodies", children: [] }] },
  { slug: "accessories", children: [] },
];

vi.mock("@/lib/sdk", () => ({
  headkit: {
    collections: {
      getCategories: (): Promise<unknown> => Promise.resolve(TREE),
      getCategory: (): Promise<null> => Promise.resolve(null),
    },
    products: { list: (): Promise<never> => Promise.reject(new Error("off")) },
  },
}));

const { getCachedProduct } = vi.hoisted(() => ({
  getCachedProduct: vi.fn<(slug: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/product-cache", () => ({
  getCachedProduct: (slug: string): Promise<unknown> => getCachedProduct(slug),
  getProductForPage: (slug: string): Promise<unknown> => getCachedProduct(slug),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      branding: {},
      seoSettings: { allowIndexing: true, ogImageUrl: null },
      storeSettings: { name: "Test Store", domain: "shop.example" },
    }),
  getBrandingAssets: (): Promise<Record<string, never>> => Promise.resolve({}),
}));

// The flat PDP module is what this route delegates to; only the body is
// stubbed, and by identity, so the route's element type can be compared to it.
vi.mock("@/app/products/[...slug]/page", () => ({
  ProductPageBody: (): null => null,
  ProductPageContent: (): null => null,
  generateMetadata: (): Promise<Record<string, never>> => Promise.resolve({}),
}));
vi.mock("@/app/collections/[...slug]/page", () => ({
  CollectionRoute: (): null => null,
}));
vi.mock("@/components/headkit-ui/skeletons/collection-page-skeleton", () => ({
  CollectionPageSkeleton: (): null => null,
  CollectionProductsSkeleton: (): null => null,
}));

import Page, { ShopRoute } from "./page";
import { ProductPageBody } from "@/app/products/[...slug]/page";
import { ProductPageShell } from "@/app/products/[...slug]/product-page-shell";
import { CollectionRoute } from "@/app/collections/[...slug]/page";

const HOODIE = {
  id: "p1",
  name: "Blue Hoodie",
  slug: "blue-hoodie",
  uri: "https://commerce.example.com/shop/clothing/hoodies/blue-hoodie/",
  categories: [],
  attributes: [],
  variations: [],
};

function trackedSearchParams(): {
  promise: Promise<Record<string, string>>;
  awaited: () => boolean;
} {
  let awaited = false;
  const thenable = {
    then(resolve: (v: Record<string, string>) => unknown): unknown {
      awaited = true;
      return Promise.resolve({}).then(resolve);
    },
  };
  return {
    promise: thenable as unknown as Promise<Record<string, string>>,
    awaited: () => awaited,
  };
}

beforeEach(() => {
  getCachedProduct.mockReset();
  getCachedProduct.mockImplementation((slug) =>
    Promise.resolve(slug === HOODIE.slug ? HOODIE : null),
  );
});

describe("shop/[...slug] — params stay inside Suspense", () => {
  it("returns the product shell immediately and does not read the URL itself", () => {
    const searchParams = trackedSearchParams();

    const element = Page({
      params: Promise.resolve({ slug: ["clothing", "hoodies", "blue-hoodie"] }),
      searchParams: searchParams.promise,
    }) as ReactElement<{
      fallback: ReactElement;
      children: ReactElement;
    }>;

    expect(element.type).toBe(Suspense);
    expect(element.props.fallback.type).toBe(ProductPageShell);
    expect(element.props.children.type).toBe(ShopRoute);
    expect(searchParams.awaited()).toBe(false);
  });

  it("returns ProductPageBody with the verified product from the child", async () => {
    const element = (await ShopRoute({
      params: Promise.resolve({ slug: ["clothing", "hoodies", "blue-hoodie"] }),
    })) as ReactElement<{
      product: unknown;
      productSlug: string;
      colorSlug: unknown;
    }>;

    expect(element.type).toBe(ProductPageBody);
    expect(element.props.product).toBe(HOODIE);
    expect(element.props.productSlug).toBe("blue-hoodie");
    expect(element.props.colorSlug).toBeUndefined();
  });

  it("hands the colourway segment to the body", async () => {
    const element = (await ShopRoute({
      params: Promise.resolve({
        slug: ["clothing", "hoodies", "blue-hoodie", "red"],
      }),
    })) as ReactElement<{ productSlug: string; colorSlug: unknown }>;

    expect(element.type).toBe(ProductPageBody);
    expect(element.props.productSlug).toBe("blue-hoodie");
    expect(element.props.colorSlug).toBe("red");
  });
});

/**
 * The category branch renders in the static shell, and it takes BOTH of these.
 *
 * WHAT THIS COVERS: (1) the element `app/shop/[...slug]/page.tsx` returns for a
 * category path is `CollectionRoute` itself, with no `<Suspense>` wrapping it
 * and no `searchParams` handed to it; (2) the shared client provider
 * `components/headkit-ui/collection/collection-context.tsx` calls no
 * `useSearchParams()`. The second is not decoration: with the route shape
 * exactly as asserted in (1) and `useSearchParams()` back in the provider, the
 * measured result was `f` and a 0-byte prerendered shell — so (1) alone would
 * stay green through the whole regression it exists to catch.
 *
 * WHERE IT STOPS, and these gaps are real:
 *   - It reads the provider's SOURCE TEXT. It catches the call by name and
 *     nothing else: another request-time read (`cookies()`, `headers()`, an
 *     uncached fetch) anywhere in the grid's subtree fails identically and is
 *     invisible here, as is `useSearchParams` reached through an alias or a
 *     re-export. Comments are stripped before the match, naively, so a `//`
 *     inside a string literal blinds the rest of that line.
 *   - It is one route file and one provider file. The other listing routes that
 *     mount the same provider — `app/collections/[...slug]`, `app/shop`,
 *     `app/brand/[...slug]`, `app/sale`, `app/new-in`, `app/featured` — have no
 *     boundary assertion of their own; `app/collections/[...slug]` is covered
 *     only transitively, by being the module this route delegates to.
 *   - It says nothing about what the BUILD produced. Whether the route is `o`
 *     or `f`, and whether the cards actually land before the first hidden
 *     segment, is only observable on a built file:
 *     `bun run scripts/static-shell-split.ts <.next/server/app/....html | url>`.
 *   - It says nothing about the 404/308 status codes on this route; those are
 *     `app/not-found-status.test.ts` and `e2e/not-found-status.spec.ts`.
 */
describe("shop/[...slug] — the category branch renders in the static shell", () => {
  it("returns CollectionRoute directly, with no boundary above it and no searchParams", async () => {
    const searchParams = trackedSearchParams();

    const element = (await ShopRoute({
      params: Promise.resolve({ slug: ["clothing", "hoodies"] }),
      searchParams: searchParams.promise,
    })) as ReactElement<{
      searchParams?: unknown;
      params: Promise<unknown>;
    }>;

    expect(
      element.type,
      "a <Suspense> here puts the heading and every product card after the visible shell — React outlines any completed boundary over 500 bytes, and one card is ~4.3 KB",
    ).not.toBe(Suspense);
    expect(
      element.type,
      "the category branch renders CollectionRoute itself, in the route",
    ).toBe(CollectionRoute);
    expect(
      element.props.searchParams,
      "CollectionRoute takes no searchParams: awaiting one anywhere on this route turns the whole segment dynamic",
    ).toBeUndefined();
    expect(searchParams.awaited(), "never read here").toBe(false);
    await expect(element.props.params).resolves.toEqual({
      slug: ["clothing", "hoodies"],
    });
  });

  it("keeps useSearchParams out of the shared CollectionProvider", async () => {
    const source = await readFile(
      new URL(
        "../../../components/headkit-ui/collection/collection-context.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    // Vacuity guard: if the file ever moves or is renamed, an empty read would
    // make the assertion below pass for the wrong reason.
    expect(
      source,
      "read the wrong file — this guard is worthless without the provider in it",
    ).toContain("export function CollectionProvider");

    // Strip comments first: this very file's rationale, and the provider's own,
    // both spell the identifier out in prose. Naive, and that is the trade —
    // a `//` inside a string literal truncates the rest of that line.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    expect(
      /\buseSearchParams\b/.test(code),
      "CollectionProvider must not call useSearchParams(): it is a request-time read, and with it the listing routes build as dynamic (f) with a 0-byte static shell — measured, and invisible to the structural assertion above. Read query state in a mount effect instead.",
    ).toBe(false);
  });
});

describe("shop/[...slug] — the gate still decides before either branch", () => {
  it("404s a path whose candidates resolve to no product", async () => {
    await expect(
      ShopRoute({ params: Promise.resolve({ slug: ["clothing", "no-such"] }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK/);
  });

  it("404s the build-time placeholder without a lookup", async () => {
    await expect(
      ShopRoute({ params: Promise.resolve({ slug: ["__hk_static_placeholder"] }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK/);
    expect(getCachedProduct).not.toHaveBeenCalled();
  });
});

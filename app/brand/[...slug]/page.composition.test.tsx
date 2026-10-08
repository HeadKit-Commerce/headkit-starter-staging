import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, Suspense, type ReactNode } from "react";

/**
 * Brand counterpart to `app/shop/[...slug]/page.composition.test.tsx`. Walks
 * the actual server composition through both the route and grid helpers,
 * stopping at `CollectionPage` (the shared client-provider contract owns query
 * correction and is asserted by the shop test). This catches either ancestor
 * boundary and a `searchParams` read anywhere in those helpers.
 *
 * It cannot prove prerender output, HTTP status, or cache hits: the production
 * build, `scripts/static-shell-split.ts` and the JS-off browser checks cover
 * those.
 */
const { brandGet, list, filters, cacheLife, cacheTag, cacheLifeForProfile } =
  vi.hoisted(() => ({
    brandGet: vi.fn(),
    list: vi.fn(),
    filters: vi.fn(),
    cacheLife: vi.fn(),
    cacheTag: vi.fn(),
    cacheLifeForProfile: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sdk", () => ({
  headkit: {
    brands: { get: brandGet },
    collections: { list, getFilters: filters },
  },
}));
vi.mock("next/cache", () => ({ cacheLife, cacheTag }));
vi.mock("@/lib/cache-profile", () => ({ cacheLifeForProfile }));
vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  unstable_rethrow: (): void => {},
}));
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({ branding: { defaultCollectionSort: "PRICE" } }),
}));
vi.mock("@/lib/make-metadata", () => ({
  makeSeoMetadata: vi.fn(),
  storefrontUrl: vi.fn(),
}));
vi.mock("@/components/headkit-ui/brand/brand-header", () => ({
  BrandHeader: () => null,
}));
vi.mock("@/components/headkit-ui/collection/collection-page", () => ({
  CollectionPage: () => null,
}));

import Page, { BrandPageContent } from "./page";
import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";

const products = [{ id: "one", slug: "one", name: "One" }];
const facets = { attributes: [], categories: [] };

beforeEach(() => {
  vi.clearAllMocks();
  brandGet.mockImplementation(async (slug: string) => {
    // Bind the finite lifetime and both purge tags to the existence read,
    // rather than merely finding a "days" call somewhere in the composition.
    // `cacheLife("days")` is deliberate here and must never become
    // `cacheLifeForProfile`: this read feeds the route's 404 gate.
    expect(cacheLife.mock.lastCall).toEqual(["days"]);
    expect(cacheTag.mock.lastCall).toEqual([
      `headkit:brand:${slug}`,
      "headkit:brands",
    ]);
    return { slug, name: "Acme", description: null, thumbnail: null };
  });
  list.mockResolvedValue({ products, total: 30 });
  filters.mockResolvedValue(facets);
});

async function grids(node: ReactNode): Promise<Record<string, unknown>[]> {
  if (Array.isArray(node)) return (await Promise.all(node.map(grids))).flat();
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  expect(node.type, "no boundary may wrap the brand's cached grid").not.toBe(
    Suspense,
  );
  if (node.type === CollectionPage) return [node.props];
  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => ReactNode | Promise<ReactNode>;
    return grids(await component(node.props));
  }
  return grids(node.props.children as ReactNode);
}

/**
 * A `searchParams` prop that throws the moment anything awaits it. The route no
 * longer declares one, so this is passed as an extra prop purely to prove no
 * helper reaches for it.
 */
function queryThatMustNotBeRead(): Promise<Record<string, string>> {
  return {
    then: () => {
      throw new Error("searchParams read above the static grid");
    },
  } as unknown as Promise<Record<string, string>>;
}

describe("brand page-one static shell", () => {
  it("composes the real brand-scoped cached grid without boundaries or query reads", async () => {
    const result = await grids(
      await Page({
        params: Promise.resolve({ slug: ["acme"] }),
        searchParams: queryThatMustNotBeRead(),
      } as Parameters<typeof Page>[0]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      initialProducts: products,
      initialTotal: 30,
      initialPage: 1,
      brandSlug: "acme",
      productFilter: facets,
    });
    // Real `buildProductListFilter` + `getCachedCatalogPage`: the route still
    // uses the dashboard default order and the cache shared with the client
    // actions, and asks for page 1 in every case.
    expect(list).toHaveBeenCalledExactlyOnceWith(
      { brand: "acme", orderby: "price", order: "asc" },
      1,
      24,
    );
    expect(filters).toHaveBeenCalledExactlyOnceWith();
    expect(cacheTag.mock.calls).toContainEqual([
      "headkit:brand:acme",
      "headkit:brands",
    ]);
    // The shared, store-wide facet entry from #536 — keyed on nothing, so one
    // read serves every brand.
    expect(cacheTag.mock.calls).toContainEqual(["catalog:filters"]);
    expect(cacheTag.mock.calls).toContainEqual([
      "headkit:brand:acme",
      "headkit:products",
      "headkit:catalog",
      expect.stringMatching(/^catalog:[a-f0-9]{16}$/),
    ]);
    expect(cacheLife).toHaveBeenCalledWith("days");
  });

  it.each(["unknown", "__hk_static_placeholder"])(
    "rejects %s before any grid read",
    async (slug) => {
      brandGet.mockResolvedValue(null);
      // `Page` is the sync shell. `notFound()` lives in `BrandPageContent`,
      // above every boundary, which is what sets 404 with no `loading.tsx`.
      await expect(
        BrandPageContent({
          params: Promise.resolve({ slug: [slug] }),
          searchParams: queryThatMustNotBeRead(),
        } as Parameters<typeof BrandPageContent>[0]),
      ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(list).not.toHaveBeenCalled();
      expect(filters).not.toHaveBeenCalled();
      if (slug === "__hk_static_placeholder")
        expect(brandGet).not.toHaveBeenCalled();
    },
  );

  it("propagates transport failures instead of treating them as a missing brand", async () => {
    const failure = new Error("commerce unavailable");
    brandGet.mockRejectedValue(failure);
    await expect(
      BrandPageContent({
        params: Promise.resolve({ slug: ["acme"] }),
        searchParams: queryThatMustNotBeRead(),
      } as Parameters<typeof BrandPageContent>[0]),
    ).rejects.toBe(failure);
    expect(list).not.toHaveBeenCalled();
  });
});

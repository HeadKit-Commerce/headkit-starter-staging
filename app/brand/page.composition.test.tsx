import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, Suspense, type ReactNode } from "react";

/**
 * The brand INDEX's two contracts, both of which it broke until 2026-10-01.
 *
 *  1. It renders EVERY brand the endpoint has, not page 1. It called
 *     `sdk.brands.list()` with no arguments, and the SDK's `perPage` default is
 *     24: measured on the Bike Society rehearsal store, `/brand` served 24 of
 *     the 110 brands `sitemap.xml` advertised, with no page control and no sign
 *     anything was missing.
 *  2. It renders them OUTSIDE every `<Suspense>`. The route wrapped fully
 *     cached content in a boundary, and React outlines any completed boundary
 *     over 12,800 bytes into a hidden segment — so all 24 cards sat after
 *     `<div hidden id="S:0">` and a JS-off shopper saw the skeleton alone.
 *
 * Plus the third: when the walk cannot prove it has them all, the page SAYS so.
 *
 * It cannot prove prerender output, HTTP status or cache hits — the production
 * build, `scripts/static-shell-split.ts` and an HTTP read cover those. The walk
 * itself is `lib/brand-list.test.ts`; parity with the sitemap is
 * `app/product-url-emitter-parity.test.ts`.
 */
const { brandsList, cacheTag, cacheLifeForProfile } = vi.hoisted(() => ({
  brandsList: vi.fn(),
  cacheTag: vi.fn(),
  cacheLifeForProfile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sdk", () => ({ headkit: { brands: { list: brandsList } } }));
vi.mock("next/cache", () => ({ cacheTag, cacheLife: vi.fn() }));
vi.mock("@/lib/cache-profile", () => ({ cacheLifeForProfile }));
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({ storeSettings: { domain: "shop.example.com" } }),
}));
vi.mock("@/lib/make-metadata", () => ({ storefrontUrl: vi.fn() }));
vi.mock("@/components/headkit-ui/brand/brand-header", () => ({
  BrandHeader: () => null,
}));
vi.mock("@/components/headkit-ui/brand/brand-page", () => ({
  BrandPage: () => null,
}));

import Page, { instant } from "./page";
import { BrandPage } from "@/components/headkit-ui/brand/brand-page";

/** The measured store: 110 brands at 100 per page. */
const ALL_SLUGS = Array.from({ length: 110 }, (_, i) => `brand-${i}`);

function pageOf(slugs: string[], page: number, perPage: number) {
  return {
    brands: slugs
      .slice((page - 1) * perPage, page * perPage)
      .map((slug) => ({ id: slug, name: slug, slug })),
    total: slugs.length,
    totalPages: Math.max(1, Math.ceil(slugs.length / perPage)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `perPage` defaults to the SDK's own 24 when the caller passes nothing, so a
  // route that reverts to a bare `sdk.brands.list()` fails here as "24 of 110"
  // rather than as a destructuring crash.
  brandsList.mockImplementation(
    async (args?: { page?: number; perPage?: number }) =>
      pageOf(ALL_SLUGS, args?.page ?? 1, args?.perPage ?? 24),
  );
});

/**
 * Walks the real server composition, failing on any `<Suspense>` on the way,
 * and returns the props of every `BrandPage` reached.
 */
async function grids(node: ReactNode): Promise<Record<string, unknown>[]> {
  if (Array.isArray(node)) return (await Promise.all(node.map(grids))).flat();
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  expect(node.type, "no boundary may wrap the brand index's grid").not.toBe(
    Suspense,
  );
  if (node.type === BrandPage) return [node.props];
  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => ReactNode | Promise<ReactNode>;
    return grids(await component(node.props));
  }
  return grids(node.props.children as ReactNode);
}

describe("brand index static shell", () => {
  it("renders every brand, past page 1, with no boundary above the grid", async () => {
    const result = await grids(Page());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ total: 110, complete: true });
    expect(
      (result[0]!.brands as { slug: string }[]).map((brand) => brand.slug),
      "the index must hold every brand, not the SDK's 24-per-page default",
    ).toEqual(ALL_SLUGS);
  });

  it("never asks for the SDK's default page size", async () => {
    await grids(Page());
    for (const call of brandsList.mock.calls) {
      expect(call[0]).toMatchObject({ perPage: 100 });
    }
    expect(brandsList).toHaveBeenCalledTimes(2);
  });

  it("tells the grid it is incomplete when the walk could not finish", async () => {
    brandsList.mockImplementation(
      async (args?: { page?: number; perPage?: number }) => {
        const page = args?.page ?? 1;
        if (page > 1) throw new Error("origin refused");
        return pageOf(ALL_SLUGS, page, args?.perPage ?? 100);
      },
    );

    const result = await grids(Page());

    expect(result[0]).toMatchObject({ total: 110, complete: false });
    expect(result[0]!.brands).toHaveLength(100);
  });

  it("binds the brand purge tag to the cached walk", async () => {
    await grids(Page());
    expect(cacheTag.mock.calls).toEqual([["headkit:brands"]]);
    // One entry, not one per page: `max` only ever refreshes on that tag.
    expect(cacheLifeForProfile.mock.calls).toEqual([["weeks", "max"]]);
  });

  it("declares itself instant — the shell holds the whole page", () => {
    expect(instant).toBe(true);
  });
});

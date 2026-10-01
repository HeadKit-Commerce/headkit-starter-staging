import { describe, expect, it, vi } from "vitest";

/**
 * The brand walk's terminator rules and its one job: knowing when it does NOT
 * have every brand.
 *
 * The defect this guards is not "the loop is wrong" but "the surface looked
 * finished while holding a subset" — `/brand` served 24 of 110 brands with no
 * control and no notice (Bike Society rehearsal, 2026-10-01). So `complete` is
 * asserted in both directions on every shape below, including the ones where
 * the brands collected are perfectly usable.
 *
 * What it does NOT cover: that `app/brand/page.tsx` renders the notice (its
 * composition test), that the index and the sitemap name the same brands
 * (`app/product-url-emitter-parity.test.ts`), or anything about the real
 * endpoint's page size — `'maximum' => 100` lives in the theme's PHP.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sdk", () => ({ headkit: { brands: { list: vi.fn() } } }));

import {
  BRAND_MAX_PAGES,
  BRAND_PER_PAGE,
  collectAllBrands,
} from "./brand-list";
import type { BrandSummaryFieldsFragment } from "@headkit/sdk";

function brand(slug: string): BrandSummaryFieldsFragment {
  return {
    id: slug,
    name: slug,
    slug,
    description: "",
    thumbnail: "",
    uri: `/brand/${slug}`,
    count: 1,
  };
}

/** A fake endpoint holding `slugs`, paged at `perPage`. */
function endpoint(slugs: string[], perPage = BRAND_PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(slugs.length / perPage));
  return vi.fn(async (page: number) => ({
    brands: slugs.slice((page - 1) * perPage, page * perPage).map(brand),
    total: slugs.length,
    totalPages,
  }));
}

describe("collectAllBrands", () => {
  it("asks for the largest page the endpoint accepts", async () => {
    const fetchPage = endpoint(["a"]);
    await collectAllBrands(fetchPage);
    // Not 24 (the SDK default that caused the bug) and not >100 (the theme
    // rejects it with rest_invalid_param rather than clamping).
    expect(BRAND_PER_PAGE).toBe(100);
    expect(fetchPage).toHaveBeenCalledWith(1);
  });

  it("walks past page 1 and reports complete", async () => {
    // The measured store: 110 brands, two pages. Page 1 alone is the bug.
    const slugs = Array.from({ length: 110 }, (_, i) => `brand-${i}`);
    const fetchPage = endpoint(slugs);

    const walk = await collectAllBrands(fetchPage);

    expect(walk.brands.map((b) => b.slug)).toEqual(slugs);
    expect(walk.total).toBe(110);
    expect(walk.complete).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops on the endpoint's totalPages without asking for a page past it", async () => {
    const fetchPage = endpoint(["a", "b"]);
    await collectAllBrands(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page", async () => {
    // totalPages lies high; the empty page is the terminator.
    const fetchPage = vi.fn(async (page: number) => ({
      brands: page === 1 ? [brand("a")] : [],
      total: 1,
      totalPages: 99,
    }));

    const walk = await collectAllBrands(fetchPage);

    expect(walk.brands.map((b) => b.slug)).toEqual(["a"]);
    expect(walk.complete).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does NOT treat a short page as the last one", async () => {
    // Page 1 returns fewer rows than it could. Only the endpoint knows whether
    // it dropped one, so the walk keeps going — treating this as the end is how
    // a paginated walk quietly truncates.
    const fetchPage = vi.fn(async (page: number) => ({
      brands: page === 1 ? [brand("a")] : [brand("b")],
      total: 2,
      totalPages: 2,
    }));

    const walk = await collectAllBrands(fetchPage);

    expect(walk.brands.map((b) => b.slug)).toEqual(["a", "b"]);
    expect(walk.complete).toBe(true);
  });

  it("keeps what a mid-walk failure already collected, and says it is incomplete", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page > 1) throw new Error("origin refused");
      return { brands: [brand("a")], total: 110, totalPages: 2 };
    });

    const walk = await collectAllBrands(fetchPage);

    expect(walk.brands.map((b) => b.slug)).toEqual(["a"]);
    expect(walk.total).toBe(110);
    expect(walk.complete).toBe(false);
  });

  it("reports incomplete when the endpoint serves fewer brands than it claims to hold", async () => {
    // A provider-side cap: totalPages says 1, total says 110. The walk has a
    // real terminator and still cannot account for 109 brands, so the surface
    // must not look finished.
    const fetchPage = vi.fn(async () => ({
      brands: [brand("a")],
      total: 110,
      totalPages: 1,
    }));

    const walk = await collectAllBrands(fetchPage);

    expect(walk.brands).toHaveLength(1);
    expect(walk.complete).toBe(false);
  });

  it("is complete on a store with no brands at all", async () => {
    const walk = await collectAllBrands(
      vi.fn(async () => ({ brands: [], total: 0, totalPages: 1 })),
    );
    expect(walk.brands).toEqual([]);
    expect(walk.total).toBe(0);
    // Nothing was dropped — an empty store must not accuse the endpoint.
    expect(walk.complete).toBe(true);
  });

  it("yields nothing and reports incomplete when page 1 fails", async () => {
    const walk = await collectAllBrands(
      vi.fn(async () => {
        throw new Error("unreachable");
      }),
    );
    expect(walk.brands).toEqual([]);
    expect(walk.total).toBeNull();
    expect(walk.complete).toBe(false);
  });

  it("is bounded: a provider reporting a huge totalPages cannot spin forever", async () => {
    // The implausible-brand-count case, and the one that actually runs long: a
    // FINITE but absurd `totalPages` passes the `Number.isFinite` terminator,
    // so only the page bound stops it. The walk makes exactly that many reads
    // and says it is incomplete. (A non-finite `totalPages` terminates on page
    // 1 instead — the test below.)
    const fetchPage = vi.fn(async () => ({
      brands: [brand("a")],
      total: 1_000_000_000,
      totalPages: 1_000_000_000,
    }));

    const walk = await collectAllBrands(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(BRAND_MAX_PAGES);
    expect(walk.brands).toHaveLength(BRAND_MAX_PAGES);
    expect(walk.complete).toBe(false);
  });

  it("treats a non-finite totalPages as a terminator when the count agrees", async () => {
    const fetchPage = vi.fn(async () => ({
      brands: [brand("a")],
      total: 1,
      totalPages: Number.NaN,
    }));

    const walk = await collectAllBrands(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(walk.complete).toBe(true);
  });
});

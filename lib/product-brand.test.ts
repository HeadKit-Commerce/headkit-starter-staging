import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PDP brand logo is a per-brand read at build, like the brand route's
 * header. During `next build` it comes from the CDN-cached brand LIST
 * (`lib/brand-prerender.ts`); at runtime it stays on `brands.get`.
 */
const { brandGet, brandList, envState } = vi.hoisted(() => ({
  brandGet: vi.fn(),
  brandList: vi.fn(),
  envState: { NEXT_PHASE: undefined as string | undefined },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sdk", () => ({
  headkit: { brands: { get: brandGet, list: brandList } },
}));
vi.mock("@/lib/env", () => ({ env: envState }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/cache-profile", () => ({ cacheLifeForProfile: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn() },
  errorFields: () => ({}),
}));

import { getCachedProductBrand } from "./product-brand";

const listed = (slug: string, imageSrc?: string) => ({
  id: slug,
  slug,
  name: `Brand ${slug}`,
  description: "",
  thumbnail: `https://cdn.example/${slug}-thumb.png`,
  uri: `/brand/${slug}`,
  count: 1,
  image: imageSrc ? { src: imageSrc, alt: slug, width: 1, height: 1 } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  envState.NEXT_PHASE = undefined;
});

describe("getCachedProductBrand", () => {
  it("reads brands.get at runtime", async () => {
    brandGet.mockResolvedValue({
      name: "Zipp",
      slug: "zipp",
      thumbnail: "t.png",
      image: { src: "i.png" },
    });
    await expect(getCachedProductBrand("zipp")).resolves.toEqual({
      name: "Zipp",
      slug: "zipp",
      logoUrl: "i.png",
    });
    expect(brandList).not.toHaveBeenCalled();
  });

  describe("during the production build", () => {
    beforeEach(() => {
      envState.NEXT_PHASE = "phase-production-build";
      brandList.mockResolvedValue({
        brands: [
          listed("acme", "https://cdn.example/acme.png"),
          listed("zipp"),
        ],
        page: 1,
        perPage: 100,
        total: 2,
        totalPages: 1,
      });
    });

    it("resolves name and logo from the list without brands.get", async () => {
      await expect(getCachedProductBrand("acme")).resolves.toEqual({
        name: "Brand acme",
        slug: "acme",
        logoUrl: "https://cdn.example/acme.png",
      });
      // No image on the list row: the thumbnail is the logo, as on the detail.
      await expect(getCachedProductBrand("zipp")).resolves.toMatchObject({
        logoUrl: "https://cdn.example/zipp-thumb.png",
      });
      expect(brandGet).not.toHaveBeenCalled();
    });

    it("answers null for a brand the completed list omits", async () => {
      await expect(getCachedProductBrand("gone")).resolves.toBeNull();
      expect(brandGet).not.toHaveBeenCalled();
    });

    it("degrades to no logo when the list read fails", async () => {
      brandList.mockRejectedValue(new Error("commerce unavailable"));
      await expect(getCachedProductBrand("acme")).resolves.toBeNull();
      expect(brandGet).not.toHaveBeenCalled();
    });
  });
});

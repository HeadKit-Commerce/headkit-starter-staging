import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";

/**
 * `ProductStock` reads `getProductStock` (expire 300 seconds, still inside
 * the prerender) and hands every variation to `LiveAvailability`. Quote
 * checkout returns before that read. It must not read `getCachedProduct`.
 */

const { getProductStock, getBranding } = vi.hoisted(() => ({
  getProductStock: vi.fn<(slug: string) => Promise<unknown>>(),
  getBranding:
    vi.fn<() => Promise<{ storeSettings: { checkoutType: string } }>>(),
}));

vi.mock("@/lib/product-cache", () => ({
  getProductStock: (slug: string): Promise<unknown> => getProductStock(slug),
  getCachedProduct: (): Promise<unknown> => {
    throw new Error("the availability line must not read the catalogue entry");
  },
}));
vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<{ storeSettings: { checkoutType: string } }> =>
    getBranding(),
}));
vi.mock("@/components/headkit-ui/live-availability", () => ({
  LiveAvailability: (): null => null,
}));
vi.mock("@/lib/product-brand", () => ({
  resolveDisplayBrand: (
    brands: ReadonlyArray<{ slug: string; name: string }> | null | undefined,
  ) => brands?.[0] ?? null,
}));

import { ProductStock } from "./product-stock";
import { LiveAvailability } from "@/components/headkit-ui/live-availability";

const PRODUCT = {
  slug: "acme-hoodie",
  stockStatus: "instock",
  stockQuantity: 7,
  brands: [{ slug: "acme", name: "Acme" }],
  attributes: [{ slug: "pa_color", type: "color", fullOptions: [] }],
  variations: [
    {
      id: 11,
      stockStatus: "outofstock",
      stockQuantity: 0,
      attributes: [
        { key: "pa_color", value: "red" },
        { key: "pa_size", value: "l" },
      ],
    },
    {
      id: 12,
      stockStatus: "instock",
      stockQuantity: 4,
      attributes: [
        { key: "pa_color", value: "red" },
        { key: "pa_size", value: "m" },
      ],
    },
  ],
};

beforeEach(() => {
  getProductStock.mockReset();
  getBranding.mockReset();
  getBranding.mockResolvedValue({ storeSettings: { checkoutType: "custom" } });
});

describe("ProductStock", () => {
  it("reads the five-minute stock entry and passes every variation through", async () => {
    getProductStock.mockResolvedValue(PRODUCT);

    const element = (await ProductStock({
      productSlug: "acme-hoodie",
    })) as ReactElement<{
      snapshot: { variations: unknown[]; brandSlug: string };
    }>;

    expect(getProductStock).toHaveBeenCalledWith("acme-hoodie");
    expect(element.type).toBe(LiveAvailability);
    expect(element.props.snapshot.brandSlug).toBe("acme");
    expect(element.props.snapshot.variations).toEqual([
      {
        id: 11,
        stockStatus: "outofstock",
        stockQuantity: 0,
        attributes: [
          { key: "pa_color", value: "red" },
          { key: "pa_size", value: "l" },
        ],
      },
      {
        id: 12,
        stockStatus: "instock",
        stockQuantity: 4,
        attributes: [
          { key: "pa_color", value: "red" },
          { key: "pa_size", value: "m" },
        ],
      },
    ]);
  });

  it("skips the stock read when checkout is quote", async () => {
    getBranding.mockResolvedValue({ storeSettings: { checkoutType: "quote" } });

    await expect(
      ProductStock({ productSlug: "acme-hoodie" }),
    ).resolves.toBeNull();
    expect(getProductStock).not.toHaveBeenCalled();
  });

  it("renders nothing for a miss, and never throws on a failed read", async () => {
    getProductStock.mockResolvedValueOnce(null);
    await expect(ProductStock({ productSlug: "gone" })).resolves.toBeNull();

    getProductStock.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      ProductStock({ productSlug: "acme-hoodie" }),
      "a provider outage during a post-action refresh must not trip the route error boundary",
    ).resolves.toBeNull();
  });

  it("keeps a five-minute prerenderable lifetime on its own entry", () => {
    const source = readFileSync(
      new URL("../../lib/product-cache.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("function getProductStock(");
    expect(
      start,
      "getProductStock is declared in product-cache",
    ).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + 1);
    const fn = source.slice(start, next === -1 ? undefined : next);
    expect(fn).toContain('"use cache: remote"');
    expect(fn).toContain("stale: 300");
    expect(fn).toContain("revalidate: 60");
    expect(fn).toContain("expire: 300");
    expect(fn).not.toContain('cacheLife("seconds")');
    expect(fn).not.toContain("getCachedProduct(");
    expect(fn).not.toContain("getLiveProductStock");
  });
});

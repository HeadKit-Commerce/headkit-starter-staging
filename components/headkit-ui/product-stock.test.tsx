import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * `ProductStock` is the PDP's dynamic hole. It reads `getLiveProductStock`
 * (`cacheLife("seconds")`, excluded from the prerender) and hands every
 * variation to `LiveAvailability`, which matches the selected variation.
 * It must not read `getCachedProduct`: that entry is the static product and
 * would bake stock into the shell.
 */

const { getLiveProductStock, getCachedProduct } = vi.hoisted(() => ({
  getLiveProductStock: vi.fn<(slug: string) => Promise<unknown>>(),
  getCachedProduct: vi.fn<(slug: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/product-cache", () => ({
  getLiveProductStock: (slug: string): Promise<unknown> =>
    getLiveProductStock(slug),
  getCachedProduct: (slug: string): Promise<unknown> => getCachedProduct(slug),
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
  getLiveProductStock.mockReset();
  getCachedProduct.mockReset();
  getCachedProduct.mockRejectedValue(
    new Error("the stock line must not read the cached product"),
  );
});

describe("ProductStock", () => {
  it("reads the live stock entry and passes every variation through", async () => {
    getLiveProductStock.mockResolvedValue(PRODUCT);

    const element = (await ProductStock({
      productSlug: "acme-hoodie",
    })) as ReactElement<{
      snapshot: { variations: unknown[]; brandSlug: string };
    }>;

    expect(getLiveProductStock).toHaveBeenCalledWith("acme-hoodie");
    expect(getCachedProduct).not.toHaveBeenCalled();
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

  it("renders nothing for a miss, and never throws on a failed read", async () => {
    getLiveProductStock.mockResolvedValueOnce(null);
    await expect(ProductStock({ productSlug: "gone" })).resolves.toBeNull();

    getLiveProductStock.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      ProductStock({ productSlug: "acme-hoodie" }),
      "a provider outage during a post-action refresh must not trip the route error boundary",
    ).resolves.toBeNull();
  });
});

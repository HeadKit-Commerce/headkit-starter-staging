import { beforeEach, describe, expect, it, vi } from "vitest";

const getProductForPage =
  vi.fn<
    (
      slug: string,
      options?: { shopifyPreviewKey?: string },
    ) => Promise<{ slug: string } | null>
  >();

vi.mock("@/lib/product-cache", () => ({
  getProductForPage: (
    slug: string,
    options?: { shopifyPreviewKey?: string },
  ): Promise<{ slug: string } | null> => getProductForPage(slug, options),
}));

const commerce = vi.hoisted(() => ({
  domain: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
  env: {
    get SHOPIFY_STORE_DOMAIN() {
      return commerce.domain;
    },
  },
}));

import {
  SHOPIFY_PREVIEW_SLUG_PREFIX,
  resolveShopifyPreviewProductPath,
  shopifyPreviewKeyFromSearchParams,
  shopifyPreviewKeyWhenConnected,
  shopifyProductIdFromSearchParams,
} from "./shopify-preview";

beforeEach(() => {
  getProductForPage.mockReset();
  commerce.domain = undefined;
});

describe("shopifyPreviewKeyFromSearchParams", () => {
  it("returns trimmed preview_key", () => {
    expect(shopifyPreviewKeyFromSearchParams({ preview_key: " secret " })).toBe(
      " secret ",
    );
  });

  it("returns undefined when preview_key is missing", () => {
    expect(shopifyPreviewKeyFromSearchParams({})).toBeUndefined();
  });
});

describe("shopifyProductIdFromSearchParams", () => {
  it("returns trimmed shpxid", () => {
    expect(shopifyProductIdFromSearchParams({ shpxid: " 12345 " })).toBe(
      "12345",
    );
  });
});

describe("resolveShopifyPreviewProductPath", () => {
  it("loads preview product by shpxid and returns canonical PDP path", async () => {
    getProductForPage.mockResolvedValue({ slug: "velvet-tee" });

    const path = await resolveShopifyPreviewProductPath(
      "preview-secret",
      "12345",
    );

    expect(getProductForPage).toHaveBeenCalledWith(
      `${SHOPIFY_PREVIEW_SLUG_PREFIX}12345`,
      { shopifyPreviewKey: "preview-secret" },
    );
    expect(path).toBe("/products/velvet-tee?preview_key=preview-secret");
  });

  it("returns null when shpxid is missing", async () => {
    await expect(
      resolveShopifyPreviewProductPath("preview-secret", undefined),
    ).resolves.toBeNull();
    expect(getProductForPage).not.toHaveBeenCalled();
  });

  it("returns null when commerce cannot resolve the preview product", async () => {
    getProductForPage.mockResolvedValue(null);
    await expect(
      resolveShopifyPreviewProductPath("preview-secret", "999"),
    ).resolves.toBeNull();
  });
});

describe("shopifyPreviewKeyWhenConnected", () => {
  it("does not read the query when the store is not Shopify", async () => {
    let awaited = false;
    const searchParams = {
      then(
        resolve: (value: Record<string, string>) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        awaited = true;
        return Promise.resolve({ preview_key: "secret" }).then(resolve, reject);
      },
    };

    await expect(
      shopifyPreviewKeyWhenConnected(
        searchParams as unknown as Promise<Record<string, string>>,
      ),
    ).resolves.toBeUndefined();
    expect(awaited).toBe(false);
  });

  it("reads preview_key when the store is Shopify", async () => {
    commerce.domain = "preview.myshopify.com";
    await expect(
      shopifyPreviewKeyWhenConnected(
        Promise.resolve({ preview_key: "secret" }),
      ),
    ).resolves.toBe("secret");
  });
});

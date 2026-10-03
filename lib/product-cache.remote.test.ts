import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The product cache is the durable cross-instance entry. The directive is
 * `"use cache: remote"` for every store; the lifetime stays the days profile.
 * Shopify preview still short-circuits before that cache, and the read still
 * goes through the bulk prefetch and the per-slug SDK call.
 */
describe("getCachedProduct remote cache", () => {
  const src = readFileSync(
    join(import.meta.dirname, "product-cache.ts"),
    "utf8",
  );

  it("uses the remote cache with the days profile and the product tags", () => {
    const fn = src.slice(src.indexOf("export async function getCachedProduct"));
    expect(fn.startsWith("export async function getCachedProduct")).toBe(true);
    expect(fn).toContain('"use cache: remote"');
    expect(fn).toContain('cacheLifeForProfile("days", "max")');
    expect(fn).toContain("cacheTag(TAG.product(slug), TAG.products)");
    expect(fn).toContain("bulkPrefetch.get");
    expect(fn).toContain("headkit.products.get");
    expect(fn.toLowerCase()).not.toContain("mongo");
  });

  it("keeps the Shopify preview read off the cache", () => {
    const fn = src.slice(
      src.indexOf("export async function getProductForPage"),
    );
    const preview = fn.indexOf("shopifyPreviewKey");
    const cached = fn.indexOf("getCachedProduct");
    expect(preview).toBeGreaterThan(-1);
    expect(cached).toBeGreaterThan(preview);
    expect(fn).toContain("withShopifyPreviewKey");
    expect(fn).toContain("products.get");
  });
});

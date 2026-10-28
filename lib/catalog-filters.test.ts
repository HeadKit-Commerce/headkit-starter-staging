import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductFilters } from "@headkit/sdk";

/**
 * The shared store-wide facet entry: one bounded retry, and a lifetime that is
 * finite under BOTH cache profiles.
 *
 * `next/cache` is mocked, so the lifetime assertions read a `cacheLife` spy —
 * they prove which lifetime the entry DECLARES, not that Next serves it stale
 * and refreshes it on the deadline, nor that a build survives a failed fill.
 * Those are measured in the Docker stack and against a production build.
 */

const {
  cacheLife,
  cacheTag,
  getFilters,
  getFiltersWithSwatches,
  retryGetFilters,
  logInfo,
  logError,
} = vi.hoisted(() => ({
  cacheLife: vi.fn<(life: unknown) => void>(),
  cacheTag: vi.fn<(...tags: string[]) => void>(),
  // The swatch-FREE read: nothing here may call it (see the test below).
  getFilters: vi.fn<() => Promise<unknown>>(),
  getFiltersWithSwatches: vi.fn<() => Promise<unknown>>(),
  retryGetFilters: vi.fn<() => Promise<unknown>>(),
  logInfo: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
  logError: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}));

vi.mock("next/cache", () => ({
  cacheLife: (life: unknown): void => cacheLife(life),
  cacheTag: (...tags: string[]): void => cacheTag(...tags),
}));
vi.mock("@/lib/sdk", () => ({
  headkit: {
    collections: {
      getFilters: () => getFilters(),
      getFiltersWithSwatches: () => getFiltersWithSwatches(),
    },
  },
  headkitRetry: {
    collections: {
      getFilters: () => getFilters(),
      getFiltersWithSwatches: () => retryGetFilters(),
    },
  },
}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logger: { info: logInfo, error: logError },
}));

import {
  CATALOG_FACET_CACHE_LIFE,
  fetchCatalogFilters,
  getCatalogFilters,
} from "./catalog-filters";

const FACETS = { categories: [], attributes: [] } as unknown as ProductFilters;

beforeEach(() => {
  cacheLife.mockReset();
  cacheTag.mockReset();
  getFilters.mockReset();
  getFiltersWithSwatches.mockReset();
  retryGetFilters.mockReset();
  logInfo.mockReset();
  logError.mockReset();
});

describe("fetchCatalogFilters — one bounded retry", () => {
  it("reads once, through the normal client, and does not retry or log on success", async () => {
    const read = vi.fn().mockResolvedValue(FACETS);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCatalogFilters({ read, delay })).resolves.toBe(FACETS);
    expect(read).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("survives ONE injected failure: pauses, retries on the retry client, returns the second read", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("net/http: timeout awaiting headers"))
      .mockResolvedValueOnce(FACETS);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCatalogFilters({ read, delay })).resolves.toBe(FACETS);
    expect(read).toHaveBeenCalledTimes(2);
    // The two attempts are different clients: the second is a request of its
    // own, so a failure Next's fetch cache stored is not replayed back.
    expect(read.mock.calls[0]?.[0]).not.toBe(read.mock.calls[1]?.[0]);
    expect(delay).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logInfo.mock.calls[0]?.[0]).toBe("catalog_filters_retry");
    expect(logError).not.toHaveBeenCalled();
  });

  it("throws the LAST error after the retry — it never degrades to empty facets", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"));
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCatalogFilters({ read, delay })).rejects.toThrow(
      "second",
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls[0]?.[0]).toBe("catalog_filters_failed");
  });

  it("reads sdk.collections.getFiltersWithSwatches() with no arguments, first on `headkit`, then on `headkitRetry`", async () => {
    getFiltersWithSwatches.mockRejectedValueOnce(new Error("boom"));
    retryGetFilters.mockResolvedValueOnce(FACETS);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCatalogFilters({ delay })).resolves.toBe(FACETS);
    expect(getFiltersWithSwatches).toHaveBeenCalledExactlyOnceWith();
    expect(retryGetFilters).toHaveBeenCalledExactlyOnceWith();
  });

  it("never reads the swatch-free `getFilters`, which would draw no colour dot and still type-check", async () => {
    // `swatchColor` is on the generated `ProductFilterOption` type either way,
    // but `getFilters` does not SELECT it: a facet wired against it compiles
    // and is `undefined` on every option. The opt-in read is the only one that
    // carries the colours.
    getFiltersWithSwatches.mockResolvedValue(FACETS);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCatalogFilters({ delay })).resolves.toBe(FACETS);
    expect(getFilters).not.toHaveBeenCalled();
  });
});

describe("getCatalogFilters — the shared entry's lifetime", () => {
  it("keeps the finite `hours` life on the default (conservative) profile", async () => {
    getFiltersWithSwatches.mockResolvedValue(FACETS);
    await expect(getCatalogFilters()).resolves.toBe(FACETS);
    expect(cacheLife.mock.calls).toEqual([["hours"]]);
    expect(cacheTag).toHaveBeenCalledWith("catalog:filters");
  });

  it("carries a finite revalidate backstop, never `max`, on the aggressive profile", async () => {
    vi.resetModules();
    vi.stubEnv("HEADKIT_CACHE_PROFILE", "aggressive");
    try {
      const fresh = await import("./catalog-filters");
      getFiltersWithSwatches.mockResolvedValue(FACETS);
      await fresh.getCatalogFilters();
      expect(cacheLife.mock.calls).toEqual([[fresh.CATALOG_FACET_CACHE_LIFE]]);
      expect(cacheLife).not.toHaveBeenCalledWith("max");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("the backstop is a 24-hour revalidate inside a 14-day window", () => {
    expect(CATALOG_FACET_CACHE_LIFE).toEqual({
      stale: 14 * 24 * 3600,
      revalidate: 24 * 3600,
      expire: 14 * 24 * 3600,
    });
  });
});

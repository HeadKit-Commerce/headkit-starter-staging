import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BulkProductPage, BulkProductStatus } from "@headkit/sdk";
import {
  BULK_PREFETCH_DIRNAME,
  createBulkPrefetch,
  ensureBulkPrefetch,
  listBulkPrefetchedSlugs,
  readBulkPrefetchedProduct,
  type BulkPrefetchSdk,
} from "./bulk-product-prefetch";

/**
 * A recording SDK stub. `calls` is the exact sequence of SDK operations the
 * prefetch issued — the thing the "no behaviour change below the gate"
 * guarantee is asserted on.
 */
function fakeSdk(input: {
  status: Partial<BulkProductStatus>;
  total?: number;
  failPages?: readonly number[];
  statusError?: Error;
}): BulkPrefetchSdk & { calls: string[] } {
  const total = input.total ?? input.status.total ?? 0;
  // Field-by-field, then a double assertion. Workspace `BulkProductStatus`
  // requires `prerender`; the published SDK this file is also type-checked
  // against does not have that field yet. A spread of `Partial` fails the
  // first, and naming `prerender` fails the second. The prefetch only reads
  // the gate fields below.
  const status = {
    enabled: input.status.enabled ?? false,
    total,
    threshold: input.status.threshold ?? 500,
    pageSize: input.status.pageSize ?? 20,
    maxPerPage: input.status.maxPerPage ?? 25,
    reason: input.status.reason ?? "BELOW_THRESHOLD",
  } as unknown as BulkProductStatus;
  const calls: string[] = [];
  return {
    calls,
    async bulkStatus() {
      calls.push("bulkStatus");
      if (input.statusError) throw input.statusError;
      return status;
    },
    async bulkPage(page, perPage): Promise<BulkProductPage> {
      calls.push(`bulkPage(${page},${perPage})`);
      if (input.failPages?.includes(page))
        throw new Error(`origin 599 on page ${page}`);
      const products = [];
      for (let i = (page - 1) * perPage; i < page * perPage && i < total; i++) {
        products.push({
          id: String(i + 1),
          slug: `p-${i + 1}`,
          name: `P${i + 1}`,
        });
      }
      return {
        enabled: status.enabled,
        products: products as unknown as BulkProductPage["products"],
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      };
    },
  };
}

let dir: string;
beforeEach(async () => {
  dir = path.join(
    await mkdtemp(path.join(os.tmpdir(), "hk-bulk-")),
    BULK_PREFETCH_DIRNAME,
  );
});
afterEach(async () => {
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("ensureBulkPrefetch — the gate", () => {
  it("is inert outside a build: no SDK call, no directory, every lookup misses", async () => {
    const sdk = fakeSdk({
      status: { enabled: true, reason: "ENABLED" },
      total: 40,
    });
    const handle = createBulkPrefetch({ dir, sdk, isBuild: false });
    expect(await handle.get("p-1")).toBeNull();
    expect(sdk.calls).toEqual([]);
    await expect(readFile(path.join(dir, "manifest.json"))).rejects.toThrow();
  });

  it("HEADKIT_BULK_PREFETCH=0 skips even the status query", async () => {
    const sdk = fakeSdk({
      status: { enabled: true, reason: "ENABLED" },
      total: 40,
    });
    const handle = createBulkPrefetch({
      dir,
      sdk,
      isBuild: true,
      disabled: true,
    });
    expect(await handle.get("p-1")).toBeNull();
    expect(sdk.calls).toEqual([]);
  });

  it("below the threshold: ONE status query, zero bulk pages, every lookup misses", async () => {
    const sdk = fakeSdk({
      status: { enabled: false, reason: "BELOW_THRESHOLD" },
      total: 60,
    });
    const handle = createBulkPrefetch({ dir, sdk, isBuild: true });
    // Many lookups from one process — the sequence a build of a small store
    // produces — and the SDK sees exactly one operation.
    expect(await handle.get("p-1")).toBeNull();
    expect(await handle.get("p-2")).toBeNull();
    expect(await handle.get("p-3")).toBeNull();
    expect(sdk.calls).toEqual(["bulkStatus"]);
    expect(await listBulkPrefetchedSlugs(dir)).toEqual([]);
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      enabled: false,
      reason: "BELOW_THRESHOLD",
      count: 0,
    });
  });

  it("theme without the capability: same as below the threshold", async () => {
    const sdk = fakeSdk({
      status: { enabled: false, reason: "THEME_UNSUPPORTED" },
      total: 2677,
    });
    const handle = createBulkPrefetch({ dir, sdk, isBuild: true });
    expect(await handle.get("p-1")).toBeNull();
    expect(sdk.calls).toEqual(["bulkStatus"]);
  });

  it("a failed status query leaves the per-slug path untouched and unblocks waiters", async () => {
    const sdk = fakeSdk({ status: {}, statusError: new Error("gateway down") });
    const handle = createBulkPrefetch({ dir, sdk, isBuild: true });
    expect(await handle.get("p-1")).toBeNull();
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.enabled).toBe(false);
    expect(manifest.reason).toContain("status_failed");
    // A second process finds the manifest and never touches the SDK.
    const sdk2 = fakeSdk({
      status: { enabled: true, reason: "ENABLED" },
      total: 40,
    });
    const state = await ensureBulkPrefetch({ dir, sdk: sdk2, isBuild: true });
    expect(state.enabled).toBe(false);
    expect(sdk2.calls).toEqual([]);
  });
});

describe("ensureBulkPrefetch — enabled", () => {
  it("walks every page at the recommended size and serves products from the store", async () => {
    const sdk = fakeSdk({
      status: {
        enabled: true,
        reason: "ENABLED",
        pageSize: 20,
        maxPerPage: 25,
      },
      total: 47,
    });
    const handle = createBulkPrefetch({
      dir,
      sdk,
      isBuild: true,
      concurrency: 1,
    });
    const first = await handle.get("p-47");
    expect(first).toMatchObject({ slug: "p-47", name: "P47" });
    expect(sdk.calls).toEqual([
      "bulkStatus",
      "bulkPage(1,20)",
      "bulkPage(2,20)",
      "bulkPage(3,20)",
    ]);
    expect((await listBulkPrefetchedSlugs(dir)).length).toBe(47);
    // A slug the walk never saw misses — the caller's per-slug read handles it.
    expect(await handle.get("added-mid-build")).toBeNull();
    // Lookups after the fill add no SDK calls.
    await handle.get("p-1");
    expect(sdk.calls.length).toBe(4);
  });

  it("clamps the page size to the origin's cap", async () => {
    const sdk = fakeSdk({
      status: {
        enabled: true,
        reason: "ENABLED",
        pageSize: 99,
        maxPerPage: 25,
      },
      total: 30,
    });
    await ensureBulkPrefetch({ dir, sdk, isBuild: true, concurrency: 1 });
    expect(sdk.calls).toEqual([
      "bulkStatus",
      "bulkPage(1,25)",
      "bulkPage(2,25)",
    ]);
  });

  it("a failed page is skipped, recorded, and its products fall back to per-slug reads", async () => {
    const sdk = fakeSdk({
      status: {
        enabled: true,
        reason: "ENABLED",
        pageSize: 10,
        maxPerPage: 25,
      },
      total: 35,
      failPages: [2],
    });
    const log: string[] = [];
    const handle = createBulkPrefetch({
      dir,
      sdk,
      isBuild: true,
      concurrency: 2,
      log: (m) => log.push(m),
    });
    const state = await handle.ensure();
    expect(state.enabled).toBe(true);
    expect(state.manifest?.failedPages).toEqual([2]);
    expect(state.manifest?.count).toBe(25);
    expect(await handle.get("p-5")).not.toBeNull(); // page 1
    expect(await handle.get("p-15")).toBeNull(); // page 2 — falls through to products.get
    expect(await handle.get("p-35")).not.toBeNull(); // page 4
    expect(log.some((m) => m.includes("page 2/4 failed"))).toBe(true);
  });

  it("runs pages concurrently but never more than `concurrency` at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const base = fakeSdk({
      status: { enabled: true, reason: "ENABLED", pageSize: 5, maxPerPage: 25 },
      total: 50,
    });
    const sdk: BulkPrefetchSdk = {
      bulkStatus: () => base.bulkStatus(),
      async bulkPage(page, perPage) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await base.bulkPage(page, perPage);
        } finally {
          inFlight--;
        }
      },
    };
    await ensureBulkPrefetch({ dir, sdk, isBuild: true, concurrency: 3 });
    expect(peak).toBe(3);
    expect((await listBulkPrefetchedSlugs(dir)).length).toBe(50);
  });

  it("refuses a slug that is not a safe file name", async () => {
    expect(await readBulkPrefetchedProduct(dir, "../manifest")).toBeNull();
    expect(await readBulkPrefetchedProduct(dir, "a/b")).toBeNull();
  });
});

describe("ensureBulkPrefetch — several workers, one store", () => {
  it("the second process waits for the first one's manifest and issues no SDK call", async () => {
    const sdkA = fakeSdk({
      status: {
        enabled: true,
        reason: "ENABLED",
        pageSize: 10,
        maxPerPage: 25,
      },
      total: 25,
    });
    const slowA: BulkPrefetchSdk = {
      bulkStatus: () => sdkA.bulkStatus(),
      async bulkPage(page, perPage) {
        await new Promise((r) => setTimeout(r, 30));
        return sdkA.bulkPage(page, perPage);
      },
    };
    const sdkB = fakeSdk({
      status: { enabled: true, reason: "ENABLED" },
      total: 25,
    });

    const a = ensureBulkPrefetch({
      dir,
      sdk: slowA,
      isBuild: true,
      concurrency: 1,
    });
    await new Promise((r) => setTimeout(r, 10)); // A holds the lock now
    const b = ensureBulkPrefetch({ dir, sdk: sdkB, isBuild: true, pollMs: 10 });
    const [stateA, stateB] = await Promise.all([a, b]);
    expect(stateA.enabled).toBe(true);
    expect(stateB.enabled).toBe(true);
    expect(stateB.manifest?.count).toBe(25);
    expect(sdkB.calls).toEqual([]);
    expect(sdkA.calls).toEqual([
      "bulkStatus",
      "bulkPage(1,10)",
      "bulkPage(2,10)",
      "bulkPage(3,10)",
    ]);
  });

  it("gives up waiting after maxWaitMs and falls back to per-slug reads", async () => {
    await mkdir(dir, { recursive: true });
    await mkdir(path.join(dir, ".lock")); // a live filler that never finishes
    const sdk = fakeSdk({
      status: { enabled: true, reason: "ENABLED" },
      total: 25,
    });
    const log: string[] = [];
    const state = await ensureBulkPrefetch({
      dir,
      sdk,
      isBuild: true,
      pollMs: 5,
      maxWaitMs: 30,
      log: (m) => log.push(m),
    });
    expect(state.enabled).toBe(false);
    expect(sdk.calls).toEqual([]);
    expect(log.some((m) => m.includes("gave up waiting"))).toBe(true);
  });

  it("takes over a stale lock left by a dead filler", async () => {
    await mkdir(dir, { recursive: true });
    const lock = path.join(dir, ".lock");
    await mkdir(lock);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(lock, old, old);
    const sdk = fakeSdk({
      status: {
        enabled: true,
        reason: "ENABLED",
        pageSize: 25,
        maxPerPage: 25,
      },
      total: 5,
    });
    const state = await ensureBulkPrefetch({
      dir,
      sdk,
      isBuild: true,
      pollMs: 5,
      staleLockMs: 10 * 60 * 1000,
    });
    expect(state.enabled).toBe(true);
    expect(sdk.calls).toEqual(["bulkStatus", "bulkPage(1,25)"]);
  });

  it("a corrupt manifest is treated as absent rather than trusted", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "manifest.json"), "{not json", "utf8");
    const sdk = fakeSdk({
      status: { enabled: false, reason: "BELOW_THRESHOLD" },
      total: 3,
    });
    const state = await ensureBulkPrefetch({ dir, sdk, isBuild: true });
    expect(state.enabled).toBe(false);
    expect(sdk.calls).toEqual(["bulkStatus"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCT_PRERENDER_SKU_CEILING,
  paramsFromPlanPaths,
  planFromStatus,
  readProductPrerenderPlan,
} from "@/lib/product-prerender-plan";

describe("planFromStatus", () => {
  it("obeys prerender.mode even when the SKU total is on the other side of the ceiling", () => {
    expect(
      planFromStatus({
        total: 20_000,
        prerender: { mode: "all", reason: "MEASURED_FIT" },
      }),
    ).toMatchObject({ mode: "all", reason: "MEASURED_FIT", total: 20_000 });

    expect(
      planFromStatus({
        total: 12,
        prerender: { mode: "on-demand", reason: "OVER_URL_BUDGET" },
      }),
    ).toMatchObject({
      mode: "on-demand",
      reason: "OVER_URL_BUDGET",
      total: 12,
    });
  });

  it("builds a counted catalogue when on-demand carries no reason and no hot set", () => {
    expect(
      planFromStatus({
        total: 2_677,
        prerender: { mode: "on-demand" },
      }),
    ).toMatchObject({
      mode: "all",
      paths: [],
      reason: `SKU_CEILING 2677<=${PRODUCT_PRERENDER_SKU_CEILING}`,
    });
  });

  it("still obeys an explicit on-demand reason under the ceiling", () => {
    expect(
      planFromStatus({
        total: 2_677,
        prerender: { mode: "on-demand", reason: "sku_ceiling" },
      }).mode,
    ).toBe("on-demand");
  });

  it("keeps a named hot set and ignores a mode it cannot read", () => {
    expect(
      planFromStatus({
        total: 10,
        prerender: {
          mode: "on-demand",
          paths: ["/shop/apparel/trail-jacket", ""],
        },
      }).paths,
    ).toEqual(["/shop/apparel/trail-jacket"]);

    expect(
      planFromStatus({ total: 10, prerender: { mode: "maybe" } }),
    ).toMatchObject({ mode: "all" });
  });

  it("builds every URL at or under the SKU ceiling when commerce has not sent prerender", () => {
    expect(planFromStatus({ total: 2_677, enabled: true }).mode).toBe("all");
    expect(planFromStatus({ total: PRODUCT_PRERENDER_SKU_CEILING }).mode).toBe("all");
    expect(planFromStatus({ total: 0 }).mode).toBe("all");
  });

  it("builds no product HTML once the catalogue is over the ceiling", () => {
    const plan = planFromStatus({ total: PRODUCT_PRERENDER_SKU_CEILING + 1 });
    expect(plan.mode).toBe("on-demand");
    expect(plan.paths).toEqual([]);
    expect(planFromStatus({ total: 20_000 }).mode).toBe("on-demand");
  });

  it("reads the GraphQL enum and treats a failed probe as unknown size", () => {
    expect(
      planFromStatus({
        total: 20_000,
        prerender: { mode: "ALL", reason: "MEASURED_FIT" },
      }).mode,
    ).toBe("all");
    expect(
      planFromStatus({
        total: 4,
        prerender: { mode: "ON_DEMAND", paths: ["/products/felix"] },
      }),
    ).toMatchObject({ mode: "on-demand", paths: ["/products/felix"] });

    expect(
      planFromStatus({ total: 0, reason: "PROBE_FAILED" }),
    ).toMatchObject({ mode: "on-demand", reason: "PROBE_FAILED" });
  });

  it("fails closed when the payload cannot be read", () => {
    expect(planFromStatus(undefined).mode).toBe("on-demand");
    expect(planFromStatus({ enabled: false }).reason).toBe("TOTAL_UNKNOWN");
    expect(planFromStatus({ total: Number.NaN }).mode).toBe("on-demand");
  });
});

describe("readProductPrerenderPlan", () => {
  it("builds the catalogue when the SDK has no bulk status", async () => {
    await expect(readProductPrerenderPlan({})).resolves.toMatchObject({
      mode: "all",
      reason: "NO_BULK_STATUS",
    });
  });

  it("builds nothing when the status call throws", async () => {
    await expect(
      readProductPrerenderPlan({
        bulkStatus: () => Promise.reject(new Error("origin down")),
      }),
    ).resolves.toMatchObject({ mode: "on-demand", reason: "PLAN_UNAVAILABLE" });
  });

  // The SDK's `bulkStatus` is a class method that reads `this.opts`. Pulling it
  // off the client and calling it bare threw `undefined is not an object`, the
  // catch swallowed that, and every build since 2026-10-02 prerendered no
  // product page at all. This double has the same shape: it throws unless it is
  // called with the client as `this`.
  it("calls bulkStatus with the products client as `this`", async () => {
    class ProductsDouble {
      private readonly opts = { total: 2_677, enabled: true };

      async bulkStatus(): Promise<unknown> {
        // `this.opts` is what the real SDK reads. An unbound call throws here.
        return { total: this.opts.total, enabled: this.opts.enabled };
      }
    }

    await expect(
      readProductPrerenderPlan(new ProductsDouble()),
    ).resolves.toMatchObject({
      mode: "all",
      reason: `SKU_CEILING 2677<=${PRODUCT_PRERENDER_SKU_CEILING}`,
      total: 2_677,
    });
  });

  it("retries the status read once, the way the facet plan does", async () => {
    let calls = 0;
    const products = {
      bulkStatus: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("origin down"))
          : Promise.resolve({ total: 2_677, enabled: true });
      },
    };

    await expect(readProductPrerenderPlan(products)).resolves.toMatchObject({
      mode: "all",
    });
    expect(calls).toBe(2);
  });

  // The defect cost four days because `catch { … }` discarded the error, so
  // PLAN_UNAVAILABLE arrived in the build log with no cause attached.
  it("logs the cause of a failed status read during a build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await readProductPrerenderPlan({
      bulkStatus: () =>
        Promise.reject(new Error("undefined is not an object (this.opts)")),
    });

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[product-prerender]");
    expect(lines[0]).toContain("PLAN_UNAVAILABLE");
    expect(lines[0]).toContain("undefined is not an object (this.opts)");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});

describe("paramsFromPlanPaths", () => {
  it("keeps one route's paths, strips a trailing slash, and drops duplicates", () => {
    expect(
      paramsFromPlanPaths(
        [
          "/shop/apparel/trail-jacket/",
          "/shop/apparel/trail-jacket",
          "/shop/apparel/trail-jacket/black?x=1",
          "/products/felix",
          "/collections/outdoor",
        ],
        "shop",
      ),
    ).toEqual([
      { slug: ["apparel", "trail-jacket"] },
      { slug: ["apparel", "trail-jacket", "black"] },
    ]);

    expect(paramsFromPlanPaths(["/products/felix/"], "products")).toEqual([
      { slug: ["felix"] },
    ]);
  });
});

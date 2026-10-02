import { describe, expect, it } from "vitest";

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

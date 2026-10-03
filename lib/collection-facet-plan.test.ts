import { describe, expect, it } from "vitest";

import { PRODUCT_PRERENDER_SKU_CEILING } from "@/lib/product-prerender-plan";
import {
  BUILD_PAGE_CEILING,
  FACET_PRODUCT_SKU_CEILING,
  FACETS_PER_CATEGORY_DISCOVERY_CEILING,
  facetPageRoom,
  facetPlanFromStatus,
  productPagesForPlan,
  shouldDiscoverCollectionFacets,
  shouldEmitCollectionFacets,
  type FacetCataloguePlan,
} from "@/lib/collection-facet-plan";

function plan(
  partial: Partial<FacetCataloguePlan> & Pick<FacetCataloguePlan, "mode">,
): FacetCataloguePlan {
  return {
    paths: [],
    reason: "test",
    total: null,
    ...partial,
  };
}

describe("facet catalogue plan", () => {
  it("uses the same SKU ceiling as product HTML", () => {
    expect(FACET_PRODUCT_SKU_CEILING).toBe(PRODUCT_PRERENDER_SKU_CEILING);
  });

  it("builds facets for a catalogue at or under the ceiling", () => {
    expect(facetPlanFromStatus({ total: 2677, reason: "enabled" }).mode).toBe(
      "all",
    );
    expect(facetPlanFromStatus({ total: FACET_PRODUCT_SKU_CEILING }).mode).toBe(
      "all",
    );
  });

  it("does not discover facets for a catalogue over the ceiling", () => {
    const decided = facetPlanFromStatus({ total: 20_000 });
    expect(decided.mode).toBe("on-demand");
    expect(shouldDiscoverCollectionFacets(decided, 400)).toBe(false);
  });

  it("does not discover facets when the probe failed", () => {
    const decided = facetPlanFromStatus({ total: 0, reason: "PROBE_FAILED" });
    expect(shouldDiscoverCollectionFacets(decided, 12)).toBe(false);
    expect(facetPageRoom(decided, 12)).toBe(0);
  });

  it("treats a missing bulk status as a small catalogue", () => {
    const decided = facetPlanFromStatus(undefined);
    expect(decided.mode).toBe("on-demand");
    const small = plan({ mode: "all", reason: "NO_BULK_STATUS", total: null });
    expect(shouldDiscoverCollectionFacets(small, 10)).toBe(true);
    expect(shouldEmitCollectionFacets(small, 10, 500)).toBe(true);
  });
});

describe("page room", () => {
  it("estimates the measured 2,677-SKU catalogue as about 4,000 shop URLs", () => {
    const pages = productPagesForPlan(
      plan({ mode: "all", total: 2677, reason: "enabled" }),
    );
    expect(pages).toBe(4000);
  });

  it("skips discovery on that catalogue: the facet matrix does not fit", () => {
    const bike = plan({ mode: "all", total: 2677, reason: "enabled" });
    const categories = 154;
    expect(facetPageRoom(bike, categories)).toBe(
      BUILD_PAGE_CEILING - 4000 - categories,
    );
    expect(
      categories * FACETS_PER_CATEGORY_DISCOVERY_CEILING >
        facetPageRoom(bike, categories),
    ).toBe(true);
    expect(shouldDiscoverCollectionFacets(bike, categories)).toBe(false);
  });

  it("discovers facets for a small catalogue and emits the whole set", () => {
    const small = plan({ mode: "all", total: 200, reason: "enabled" });
    expect(shouldDiscoverCollectionFacets(small, 15)).toBe(true);
    expect(shouldEmitCollectionFacets(small, 15, 40)).toBe(true);
  });

  it("emits none of a discovered set that is larger than the room", () => {
    const bike = plan({ mode: "all", total: 2677, reason: "enabled" });
    // Room is 346. 687 is the measured indexable set. Not a prefix of it.
    expect(shouldEmitCollectionFacets(bike, 154, 687)).toBe(false);
    expect(shouldEmitCollectionFacets(bike, 154, 346)).toBe(true);
    expect(shouldEmitCollectionFacets(bike, 154, 347)).toBe(false);
  });

  it("obeys an explicit commerce mode", () => {
    const directed = facetPlanFromStatus({
      total: 100,
      prerender: { mode: "ON_DEMAND", reason: "operator" },
    });
    expect(directed.mode).toBe("on-demand");
    expect(shouldDiscoverCollectionFacets(directed, 4)).toBe(false);
  });
});

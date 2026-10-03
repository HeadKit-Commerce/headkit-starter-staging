/**
 * The prerender budget parser and the two families' platform defaults.
 *
 * The defaults are the load-bearing assertions here: they are what keeps this
 * change invisible to a store that sets nothing, so a change to either is a
 * change to every storefront's build and must be a deliberate one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLECTION_FACET_PARAM_BUDGET_DEFAULT,
  UNLIMITED,
  collectionFacetParamBudget,
  resolvePrerenderBudget,
} from "@/lib/prerender-budget";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The accessors read `process.env` per call, so a stub is enough. */
function withEnv(key: string, value: string): void {
  vi.stubEnv(key, value);
}

describe("the platform defaults", () => {
  it("prerenders every collection facet param, as today", () => {
    expect(COLLECTION_FACET_PARAM_BUDGET_DEFAULT).toBe(UNLIMITED);
    expect(collectionFacetParamBudget()).toBe(UNLIMITED);
  });
});

describe("resolvePrerenderBudget", () => {
  it("falls back to the family default when unset or empty", () => {
    expect(resolvePrerenderBudget(undefined, 7)).toBe(7);
    expect(resolvePrerenderBudget("", 7)).toBe(7);
  });

  it("reads a decimal count, zero included", () => {
    expect(resolvePrerenderBudget("0", UNLIMITED)).toBe(0);
    expect(resolvePrerenderBudget("500", 0)).toBe(500);
  });

  it("reads `unlimited` as no cap", () => {
    expect(resolvePrerenderBudget("unlimited", 0)).toBe(UNLIMITED);
  });

  it("falls back rather than throwing on a value it cannot read", () => {
    // A store's env is edited by hand; a typo must not fail the build, and the
    // safe direction is the family's own default.
    expect(resolvePrerenderBudget("lots", 12)).toBe(12);
    expect(resolvePrerenderBudget("-5", 12)).toBe(12);
  });
});

describe("the env keys", () => {
  it("cuts the collection facet family to none at 0", () => {
    withEnv("HEADKIT_PRERENDER_COLLECTION_FACETS", "0");
    expect(collectionFacetParamBudget()).toBe(0);
  });

  it("accepts a finite cap on either family", () => {
    withEnv("HEADKIT_PRERENDER_COLLECTION_FACETS", "250");
    expect(collectionFacetParamBudget()).toBe(250);
  });
});

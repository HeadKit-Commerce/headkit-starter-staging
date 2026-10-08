import { describe, expect, it } from "vitest";
import { brandingCacheOnDashboardMiss } from "@/lib/branding-cache-policy";

describe("brandingCacheOnDashboardMiss", () => {
  it("returns the empty default only while next build is prerendering", () => {
    expect(brandingCacheOnDashboardMiss("phase-production-build")).toBe(
      "default",
    );
  });

  it("throws at runtime so a failed read is not stored over a good logo", () => {
    expect(brandingCacheOnDashboardMiss(undefined)).toBe("throw");
    expect(brandingCacheOnDashboardMiss("")).toBe("throw");
    expect(brandingCacheOnDashboardMiss("phase-production-server")).toBe(
      "throw",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  brandHeaderFromSummaries,
  brandPrerenderUsesList,
  type BrandHeaderSummary,
} from "./brand-prerender";

const header = (slug: string, name = slug): BrandHeaderSummary => ({
  slug,
  name,
  description: `${name} copy`,
  thumbnail: `https://cdn.example/${slug}.png`,
  imageSrc: `https://cdn.example/${slug}-full.png`,
});

describe("brand header lookup", () => {
  const summaries = [
    header("abus"),
    header("aeroe", "Aeroe"),
    header("abus", "Dup"),
  ];

  it("returns the first match and null for a slug the walk omitted", () => {
    expect(brandHeaderFromSummaries("aeroe", summaries)?.name).toBe("Aeroe");
    expect(brandHeaderFromSummaries("abus", summaries)?.name).toBe("abus");
    expect(brandHeaderFromSummaries("zipp", summaries)).toBeNull();
    expect(brandHeaderFromSummaries("abus", [])).toBeNull();
  });
});

describe("build-phase discriminator", () => {
  it("is true only for the production build phase", () => {
    expect(brandPrerenderUsesList("phase-production-build")).toBe(true);
    expect(brandPrerenderUsesList(undefined)).toBe(false);
    expect(brandPrerenderUsesList("")).toBe(false);
    expect(brandPrerenderUsesList("phase-production-server")).toBe(false);
  });
});

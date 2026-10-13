// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HEADER_BOTTOM_PX,
  HEADER_BOTTOM_CSS_VAR,
  HEADER_REGION_ATTRIBUTE,
  HEADER_REGION_SELECTOR,
  headerBottomCssValue,
  publishHeaderBottom,
} from "@/lib/header-bottom";

/**
 * The header-bottom binding: one measurement, published once, read by
 * anything that must sit under the sticky header.
 */
describe("header-bottom binding", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(HEADER_BOTTOM_CSS_VAR);
  });

  it("publishes to the property the consumer reads", () => {
    publishHeaderBottom(110);
    expect(
      document.documentElement.style.getPropertyValue(HEADER_BOTTOM_CSS_VAR),
    ).toBe("110px");
    expect(
      headerBottomCssValue(),
      "Writer and reader must name the same property; that they do is why this module exists rather than two literals.",
    ).toBe(`var(${HEADER_BOTTOM_CSS_VAR}, ${DEFAULT_HEADER_BOTTOM_PX}px)`);
  });

  it("falls back to the nav's own height before the first publish", () => {
    expect(
      document.documentElement.style.getPropertyValue(HEADER_BOTTOM_CSS_VAR),
    ).toBe("");
    expect(
      headerBottomCssValue(),
      "A consumer rendering before the header's first measurement must start under a header-sized strip, never over the header.",
    ).toContain(`${DEFAULT_HEADER_BOTTOM_PX}px`);
  });

  it("clamps an off-screen header to 0 rather than holding a stale strip", () => {
    // The starter's header is `sticky top-0` and cannot reach this, but a store
    // layout that hides the header on scroll can — and then there is nothing left
    // to uncover, so an overlay should start at the top of the viewport.
    publishHeaderBottom(-40);
    expect(
      document.documentElement.style.getPropertyValue(HEADER_BOTTOM_CSS_VAR),
    ).toBe("0px");
  });

  it("ignores a non-finite measurement instead of writing NaNpx", () => {
    publishHeaderBottom(110);
    publishHeaderBottom(Number.NaN);
    expect(
      document.documentElement.style.getPropertyValue(HEADER_BOTTOM_CSS_VAR),
    ).toBe("110px");
  });

  it("is published by the navigation bar, and marks its own region", () => {
    const source = readFileSync(
      join(__dirname, "..", "components", "headkit-ui", "navigation-bar.tsx"),
      "utf8",
    );
    expect(
      source,
      "Nothing else measures the header. If the nav stops publishing, consumers fall back to the 80px default and drift from any preheader.",
    ).toContain("publishHeaderBottom(");
    // Both halves of the header: the preheader in normal flow and the sticky nav.
    expect(source.match(/HEADER_REGION_ATTRIBUTE\]:/g)?.length ?? 0).toBe(2);
    expect(HEADER_REGION_SELECTOR).toBe(`[${HEADER_REGION_ATTRIBUTE}]`);
  });
});

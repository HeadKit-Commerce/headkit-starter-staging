/**
 * Where the header ends, published once and read by anything that must sit under
 * it.
 *
 * The measurement itself is not new: `NavigationBar` has always taken
 * `getBoundingClientRect().bottom` off the sticky nav — on mount, on scroll and on
 * resize — to place the mobile sheet and its overlay flush under the logo bar. That
 * is the right source because it already accounts for the preheader: the nav is
 * `sticky top-0` BELOW a preheader in normal flow, so at the top of the page its
 * bottom is `preheader height + 80` and after scrolling past the preheader it is
 * `80`. A second measurement taken anywhere else would have to re-derive that, and
 * would drift the first time the header gains a row.
 *
 * WHY A CSS CUSTOM PROPERTY RATHER THAN REACT STATE. The value changes on every
 * scroll frame. Routing it through state would re-render the consumer dozens of
 * times a second; as a custom property on `<html>` the browser re-resolves the
 * `top` of anything reading it with no React work at all, which is what makes the
 * offset TRACK the header instead of freezing at its mounted value. That freeze is
 * the specific defect that sank an earlier overlay that froze its top at mount.
 *
 * The fallback in {@link headerBottomCssValue} is the nav's own default height, so
 * a consumer that renders before the first publish starts under a header-sized
 * strip rather than at 0 — never covering the header, even for one frame.
 */

/** The custom property the measurement is published as, on `<html>`. */
export const HEADER_BOTTOM_CSS_VAR = "--headkit-header-bottom";

/**
 * The sticky nav's height with no preheader (`h-20`), and the value
 * `NavigationBar` already seeds its own state with.
 */
export const DEFAULT_HEADER_BOTTOM_PX = 80;

/**
 * The `top` an overlay confined to the main content region should use.
 *
 * A string rather than a number on purpose: the point is that the browser resolves
 * it per frame from the live custom property, so no consumer re-renders to follow
 * the header.
 */
export function headerBottomCssValue(): string {
  return `var(${HEADER_BOTTOM_CSS_VAR}, ${DEFAULT_HEADER_BOTTOM_PX}px)`;
}

/**
 * Publish the header's bottom edge in CSS pixels.
 *
 * Negative input clamps to 0, which is the "the header is off-screen" answer: the
 * starter's header is `sticky top-0` and cannot reach it, but a store layout that
 * hides the header on scroll can, and then an overlay SHOULD start at the top of
 * the viewport because there is no header left to uncover.
 */
export function publishHeaderBottom(bottom: number): void {
  if (typeof document === "undefined" || !Number.isFinite(bottom)) return;
  document.documentElement.style.setProperty(
    HEADER_BOTTOM_CSS_VAR,
    `${Math.max(0, Math.round(bottom))}px`,
  );
}

/** Marks the sticky header region for layout consumers. */
export const HEADER_REGION_ATTRIBUTE = "data-headkit-header";

/** Selector form of {@link HEADER_REGION_ATTRIBUTE}, for `closest()`. */
export const HEADER_REGION_SELECTOR = `[${HEADER_REGION_ATTRIBUTE}]`;

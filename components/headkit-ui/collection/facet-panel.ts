/**
 * Shared class names for the DESKTOP/TABLET facet dropdown panels.
 *
 * Two independent defects are closed here.
 *
 * 1. **The panel had no height cap and no scroller.** `NavigationMenuContent`
 *    renders inside the navigation viewport, which is positioned under the STICKY
 *    facet bar — so the panel is pinned to the bar and scrolling the page does
 *    not move it. On a catalogue with a long category list the panel simply
 *    runs off the bottom of the window: measured at 1440x900 with 154
 *    categories, the option grid ran y=176 to y=2932 and `window.scrollBy`
 *    left both numbers unchanged, leaving 2,032 px of categories unreachable
 *    by any gesture. The clipper is the BROWSER viewport edge, not the shared
 *    viewport's own `overflow-hidden`: that element's height is
 *    `--popup-height`, which Base UI measures FROM the
 *    content, so it was exactly as tall as the content and clipped nothing.
 *    Capping the CONTENT is therefore what fixes both layers at once — the
 *    measured height clamps, so the shared viewport shrinks to match.
 *
 * 2. **The option grid was a fixed two columns.** That is also what made (1)
 *    as bad as it was: at two columns a long facet list is twice as tall as it
 *    needs to be inside a panel that spans the whole viewport width.
 *
 * `70svh` rather than a larger cap: the facet bar is sticky near the top of
 * the viewport, so the panel's top edge already sits ~150 px down. At 80vh the
 * panel would still run past the bottom of a 900 px window and reintroduce an
 * unreachable tail; 70svh keeps the whole panel on screen at 900 px and on a
 * 600 px laptop. `svh` rather than `vh` so a mobile browser's retracting URL
 * bar cannot make the cap larger than the visible area.
 *
 * `overscroll-contain` stops the scroll chaining to the page once the list
 * hits an end; it does NOT trap the page scroll, which continues to work
 * everywhere outside the panel.
 *
 * A store that wants a different shape overrides these two rules from
 * `overrides/styles.css` against the panel's own markup rather than editing
 * this file.
 */
export const FACET_PANEL_SCROLL_CLASS =
  "max-h-[70svh] overflow-y-auto overscroll-contain";

/**
 * Responsive column ladder for a checkbox facet inside a dropdown panel.
 *
 * It starts at `grid-cols-4` rather than the drawer's two: the facet bar these
 * panels hang off is `hidden md:flex`, so no dropdown ever renders below `md`
 * and a narrower floor would be dead classes.
 */
export const FACET_DROPDOWN_GRID_CLASS =
  "grid grid-cols-4 lg:grid-cols-6 gap-6";

/** Two-column default used by the mobile filter drawer. Unchanged. */
export const FACET_DRAWER_GRID_CLASS = "grid grid-cols-2 gap-4";

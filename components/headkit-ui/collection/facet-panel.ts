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
 * **The cap is a `calc()` of what sits above the panel, and the scroller does
 * NOT contain overscroll.** The panel is most of the viewport (measured at
 * 1440x900: 630px of a 900px screen), so once the option list reaches an end a
 * wheel over it has almost nowhere else to land. `overscroll-behavior: contain`
 * is the declaration whose whole purpose is to refuse scroll chaining, and with
 * it the page could not be moved by any gesture started over the panel — which
 * matters because the page scroll is what brings an over-long panel into view
 * (the bar sticks, the panel stays pinned to it, and a shopper simply scrolls).
 *
 * A viewport fraction (`70svh` was the first cap) cannot know how far down the
 * panel starts. Its top is the sticky bar's bottom edge, so the cap is
 *
 *   100svh
 *     - 5rem   the bar's top edge (`sticky top-20` in `filter.tsx`)
 *     - 5rem   the bar's own height: `py-5` around an `h-10` trigger row
 *     - 3rem   the panel's `p-4` (2rem) plus 1rem of clearance
 *
 * which ends the panel 16px clear of the fold at any window height. The bar's
 * height is a literal because the bar has no way to publish it without a
 * per-frame measurement and it is fixed by construction; change the bar's
 * padding or the panel's `p-4` and this number moves with it.
 *
 * `svh` rather than `vh` so a mobile browser's retracting URL bar cannot make
 * the cap larger than the visible area.
 *
 * A store that wants a different shape overrides these two rules from
 * `overrides/styles.css` against the panel's own markup rather than editing
 * this file.
 */
export const FACET_PANEL_SCROLL_CLASS =
  "max-h-[calc(100svh_-_13rem)] overflow-y-auto";

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

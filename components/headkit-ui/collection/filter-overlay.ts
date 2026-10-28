/**
 * The catalogue filter bar's OPEN-PANEL OVERLAY: how wide the panel is, and
 * which layer the dim and the bar sit on. The closing half lives in
 * `./filter.tsx`; this module owns the two that are pure class names.
 *
 * Three defects shared one cause each and were reported together on `/shop`,
 * `/sale` and every collection route (they render one `Filter`): the open panel
 * stopped short of the right edge, nothing dismissed it, and page content
 * painted on top of the dim.
 *
 * WIDTH — the panel is exactly as wide as the bar. The bar spans the viewport
 * (`w-full`), and the panel was the shared primitive's `md:w-max`, so it
 * shrink-wrapped its option grid: MEASURED at 1440x900 with the Category panel
 * open, a 1440px bar over a 961px panel, leaving the right third of the dim
 * unblurred and product cards visible beside it.
 *
 * WHY A VIEWPORT UNIT AND NOT `w-full`. The panel's two ancestors in
 * `components/ui/navigation-menu.tsx` (the `absolute left-0 top-full w-max`
 * shell and the `w-max` viewport) are both shrink-to-fit, so a percentage width
 * resolves against a box that is itself sized from the panel — `w-full` leaves
 * it at its content width. `w-screen` is what the primitive already uses below
 * `md`, so this restores that width at `md` and up without touching the shared
 * primitive the site header's mega-menu also renders through. The `md:` prefix
 * matters for the same reason: the desktop bar is `hidden md:flex`, so no
 * dropdown renders below it.
 *
 * STACKING — the dim has to out-rank page content and stay under the header.
 * The backdrop was `z-9` and the bar `z-10`: the needle `z-9` was threading
 * missed that page content reaches 10 too (the product-card badge wrapper, the
 * carousel arrows and slide overlays are all `z-10`). So the pair moves up two
 * and nothing else does:
 *
 *   <= 10  everything inside `<main>`
 *     11   this backdrop
 *     12   the filter bar — and with it the open panel, whose own `z-30` is
 *          local: the bar is `position: sticky` with a z-index
 *     15   the site header's mega-menu scrim — ABOVE the bar on purpose, so
 *          opening the header menu still dims the filter bar
 *     20   the header — NOT dimmed by the filter's backdrop
 *     45   the consent banner · 50 sheets and dialogs · 100 the toast viewport
 *
 * jsdom resolves no Tailwind class and lays out no box, so
 * `filter-overlay.test.tsx` pins these strings and their ordering only; the
 * measured widths and which element `elementFromPoint` returns over a dimmed
 * card are browser claims and are recorded in the PR that introduced this.
 */

/**
 * Width for a panel that hangs off the filter bar — the facet dropdowns and
 * Sort. Applied at the FILTER's own call sites, never to the shared
 * `components/ui/navigation-menu.tsx` primitive.
 */
export const FILTER_PANEL_WIDTH_CLASS = "md:w-screen";

/** The dim behind an open facet/sort panel. See the module docblock. */
export const FILTER_BACKDROP_Z_CLASS = "z-11";

/** The filter bar itself, which must sit one layer above its own backdrop. */
export const FILTER_BAR_Z_CLASS = "z-12";

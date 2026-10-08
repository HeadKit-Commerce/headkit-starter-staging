/**
 * The two per-store switches for how a link BEHAVES, and the one place each
 * variable is read or its value interpreted.
 *
 * These arrived from the Bike Society fork. They stay opt-in, because each one
 * changes how a storefront feels:
 *
 *  - `NEXT_PUBLIC_NAV_MOUSEDOWN` — start an in-app navigation on `mousedown`
 *    rather than on `click`. Off, `InstantLink` installs no mouse-down handler
 *    at all.
 *  - `NEXT_PUBLIC_NAVIGATION_SKELETON` — draw a full-page skeleton while a
 *    navigation is pending. Off, the host never mounts and no requester
 *    allocates a token.
 *
 * DEFAULT OFF, AND ONLY AN EXPLICIT ON TURNS IT ON. A store that sets nothing
 * keeps today's behaviour byte-for-byte, which is what makes this safe to land
 * on every storefront at once. The recognised on values are the ones an operator
 * would actually type — `true`, `1`, `on`, `yes`, in any case, with surrounding
 * whitespace ignored. Everything else is OFF, deliberately:
 *
 *   unset / absent  -> OFF  (the default; changing nothing changes nothing)
 *   ""              -> OFF  (Vercel stores a cleared variable as an empty
 *                            string, and "I cleared it" must read as off)
 *   "true" / "1"    -> ON   (both, because picking one would make the other a
 *                            silent no-op)
 *   "on" / "yes"    -> ON
 *   anything else   -> OFF  (a typo — `ture`, `enabled`, `TRUE ` with a stray
 *                            character — must never enable an interaction
 *                            change nobody asked for. The failure mode of an
 *                            unrecognised value is "the switch did nothing",
 *                            which is visible and cheap.)
 *
 * The fork ships the skeleton variable with the OPPOSITE default — unset there
 * means on. Same variable name, so a store moving from the fork to the platform
 * starter must set it explicitly to keep the feature.
 *
 * WHY THE VARIABLES ARE PUBLIC. Every decision these three govern happens in the
 * browser — a mouse-down handler, a link's prefetch prop, a client host — so a
 * server-only variable could not reach the code that has to obey it.
 * `NEXT_PUBLIC_` is the repo's existing convention for exactly that, and
 * `NEXT_PUBLIC_SHOPIFY_CAA_ENABLED` is the naming precedent followed here.
 *
 * THE VARIABLES ARE READ AS LITERAL MEMBER EXPRESSIONS, not through
 * `lib/env.ts`. Next inlines `process.env.NEXT_PUBLIC_*` into the client bundle
 * only where the name appears verbatim in the source, so each read is written
 * out below. They are still DECLARED in `lib/env.ts`'s client schema, which is
 * where a store operator looks for the full variable set — the same split
 * `NEXT_PUBLIC_STORE_CURRENCY` already uses (declared there, read in
 * `lib/utils.ts`).
 *
 * READ PER CALL, NOT CAPTURED AS A MODULE CONSTANT. In production the two are
 * identical — Next inlines the value at build and it cannot change for the life
 * of the process — but a constant is captured at import, so a test could only
 * influence it by ordering `vi.stubEnv` before the first import of anything that
 * transitively pulls this module in. Reading per call costs a `Set.has` on a
 * short string and lets every suite DECLARE the state it tests.
 *
 * A DASHBOARD SETTING IS THE LIKELY END STATE for all three, and swapping the
 * source is an edit to this file rather than a hunt: `getBranding`
 * (`lib/branding.ts`) is already awaited on every route, is `"use cache"` at
 * `cacheLife("days")` and is tag-purged, so one more field on it costs no
 * requests per visit. The cost is platform plumbing — dashboard-api, commerce,
 * the SDK — which is not this app's to do, so the switches start as env.
 */

const ON_VALUES: ReadonlySet<string> = new Set(["true", "1", "on", "yes"]);

/**
 * The rule, as a pure function of the raw value, so the table above is testable
 * without a build.
 */
export function isFlagOptedIn(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Does an in-app link start its navigation on `mousedown`?
 *
 * OFF (default) is today's behaviour: no mouse-down handler is installed and the
 * browser's own click drives the navigation.
 */
export function navMouseDownEnabled(): boolean {
  return isFlagOptedIn(process.env.NEXT_PUBLIC_NAV_MOUSEDOWN);
}

/**
 * Is the full-page navigation skeleton switched on for this store?
 *
 * Consumers call this BEFORE doing anything else — before mounting the host,
 * before allocating a request token — which is what keeps the "off" state free
 * of an overlay element, an rAF loop, a delay timer and a store write.
 */
export function navigationSkeletonEnabled(): boolean {
  return isFlagOptedIn(process.env.NEXT_PUBLIC_NAVIGATION_SKELETON);
}

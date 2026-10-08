import { connection } from "next/server";

/**
 * Opts ONE route into request-time `generateMetadata`.
 *
 * Under Cache Components, a `generateMetadata` that reads runtime data
 * (`searchParams`, `cookies()`, `headers()`, an uncached fetch) fails the build
 * — "Next.js encountered uncached or runtime data in `generateMetadata()`" —
 * unless the route also has a dynamic hole. Next's own remedy for that error is
 * literally this component: "Render a marker component that calls
 * `await connection()` inside `<Suspense>` on the page". It renders nothing.
 *
 * ---------------------------------------------------------------------------
 * IT MUST NEVER GO BACK IN THE ROOT LAYOUT
 * ---------------------------------------------------------------------------
 * It used to live there, so that every route got a hole at once, which is what
 * let the `robots` meta be decided per request from the Host. A request-time
 * read in the root layout postpones a hole in EVERY route in the application,
 * so no response can be served as a finished file — each is produced by a
 * runtime React resume that re-emits flight rows and inflates the payload.
 * Measured on a deployed probe, one variable at a time (Bike Society, report
 * `260915-bs-click-latency-scout` §4.2): **+1.4 s on a 27 KB page, +2.4 s on a
 * 236 KB page, +44–68 % bytes**, on every page and every RSC payload. The same
 * `<Suspense>` with a CACHED child cost nothing, so the boundary is not the
 * problem — the read inside it is.
 *
 * The host-based `robots` signal that needed it is now an `X-Robots-Tag`
 * response header (`lib/host-robots.ts`), so the layout needs no marker.
 *
 * ---------------------------------------------------------------------------
 * WHO STILL MOUNTS IT
 * ---------------------------------------------------------------------------
 * `app/products/[...slug]` alone, and only when `isShopifyStorefront` is
 * set. Its `generateMetadata` then reads `searchParams` for the Shopify Admin
 * `preview_key`. A WooCommerce connection does not mount this marker and does
 * not read that key. The route prerenders real products through
 * `ProductPageBody` with no boundary of its own, so without a marker that
 * read is a build error on a Shopify store. The cost is confined to the FLAT
 * product URL,
 * which 308s onto the canonical `/shop/…` path anyway and is not the route
 * shoppers land on.
 *
 * Before adding a second caller, check whether the route already has a dynamic
 * hole inside a `<Suspense>` — one is enough for the whole route, and `/search`
 * needs no marker for exactly that reason. Mount it as a SIBLING of the page
 * content, never as a wrapper: a boundary around content hides that content
 * from a client with JavaScript off (see `AGENTS.md`, "Cached content renders
 * OUTSIDE the boundary").
 *
 * `export const dynamic` is not an option here: Cache Components rejects it,
 * and `connection()` is the documented replacement.
 */
export async function DynamicMetadataMarker(): Promise<null> {
  await connection();
  return null;
}

/**
 * Refuses a catch-all CMS slug BEFORE any gateway read, for requests that can
 * never be a CMS page: an old WordPress asset path (`/wp-content/uploads/…`) or
 * a bot probe for one (`/favicon-96x96.png`), and raw server-wiring probes
 * (`/wp-admin/…`, `/.well-known/…`).
 *
 * `proxy.ts`'s matcher excludes any DOTTED path from the proxy, but
 * `app/[...slug]/page.tsx` still serves everything the proxy skips — so a dotted
 * path reaches the catch-all, which joins it into a raw slug and asks commerce
 * for a "page" at that path. Commerce decodes the WordPress response without
 * checking its content-type, so an image body or a 403 HTML page is handed to a
 * JSON decoder and throws: a 500 where the shopper (or crawler) should get a 404.
 *
 * Real CMS page slugs never carry a dot (`about`, `contact-us`,
 * `legal/privacy-policy`), so matching an extension on the LAST segment cannot
 * collide with one. IndexNow's `/<key>.txt` ownership file is rewritten by
 * `proxy.ts` before the catch-all runs, so refusing `.txt` here does not touch it.
 */
export const ASSET_LIKE_EXTENSION_PATTERN =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|json|xml|txt|pdf|zip|woff2?|ttf|otf|mp4|webm|mp3|wav|php)$/i;

/** A first segment that is WordPress/server wiring, never a CMS page slug. */
export const ASSET_LIKE_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  "wp-content",
  "wp-includes",
  "wp-admin",
  "wp-json",
  "wp-login.php",
  "xmlrpc.php",
  ".well-known",
  "cgi-bin",
]);

/** True when the catch-all slug can never be a CMS page and must 404 unread. */
export function isAssetLikeSlug(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  const first = segments[0]?.toLowerCase() ?? "";
  if (ASSET_LIKE_FIRST_SEGMENTS.has(first)) return true;
  const last = segments[segments.length - 1] ?? "";
  return ASSET_LIKE_EXTENSION_PATTERN.test(last);
}

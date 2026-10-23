/**
 * `experimental.serverActions.allowedOrigins` for `next.config.ts`.
 *
 * WHY THIS EXISTS. A store served on both its apex and `www` redirects one to
 * the other at the edge with a 307, POST included. A Server Action POST that
 * starts on the redirected host is replayed on the canonical one still
 * carrying the ORIGINAL host's `Origin` header, while Next reads the forwarded
 * host as the canonical one — and Next's Server Actions CSRF check refuses
 * that mismatch ("x-forwarded-host header … does not match origin header …
 * Aborting the action"). On one deployed storefront (2026-10-10) every
 * add-to-cart, cart update and checkout step failed for shoppers who arrived
 * on the apex.
 *
 * Allowing the store's own host AND its apex/`www` twin is what the check
 * accepts. The host comes from `NEXT_PUBLIC_FRONTEND_URL`, the same build-time
 * origin `lib/site-url.ts` falls back to for canonicals — `next.config.ts`
 * runs at build time, so the runtime store domain from branding is not
 * readable here. dashboard-api rewrites that env when a custom domain is
 * attached, so the allowlist follows the domain from the next build. Never
 * list literal hosts here: this file ships to every store.
 *
 * Unset or unusable input yields `undefined`, which leaves Next's default
 * (same-origin only) exactly as it was.
 */

import { normalizeSiteUrl } from "./site-url";

/** Hosts for which no apex/`www` twin is meaningful. */
function isTwinless(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.startsWith("[")
  );
}

/**
 * The Server Actions origin allowlist for a storefront origin: its host plus
 * the apex/`www` twin (`www.shop.com` ⇄ `shop.com`), port preserved.
 */
export function serverActionsAllowedOrigins(
  frontendUrl: string | null | undefined,
): string[] | undefined {
  const origin = normalizeSiteUrl(frontendUrl);
  if (!origin) return undefined;

  const { host, hostname, port } = new URL(origin);
  const hosts = [host.toLowerCase()];
  if (!isTwinless(hostname)) {
    const lower = hostname.toLowerCase();
    const twin = lower.startsWith("www.") ? lower.slice(4) : `www.${lower}`;
    if (twin.includes(".")) hosts.push(port ? `${twin}:${port}` : twin);
  }
  return hosts;
}

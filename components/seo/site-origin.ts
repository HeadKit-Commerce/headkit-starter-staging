import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getBranding } from "@/lib/branding";
import { normalizeSiteUrl, resolveSiteUrl } from "@/lib/site-url";

/**
 * The origin every shopper-facing URL in a JSON-LD graph must name.
 *
 * `NEXT_PUBLIC_FRONTEND_URL` is inlined at build time, so a custom domain
 * attached without a redeploy leaves it naming the old `*.headkit.app` host.
 * The canonical (`storefrontUrl(..., storeSettings.domain)`) and the sitemap
 * (`resolveSiteUrl(storeSettings.domain)`) both already prefer the RUNTIME
 * store domain; a JSON-LD graph built from the baked env would name a second
 * host inside the same document.
 *
 * Resolved here rather than threaded as a prop from every call site because
 * these components are rendered from a dozen routes, and a prop that any one
 * route forgets to pass silently reintroduces the stale host. Callers that
 * already hold the origin can still pass `siteUrl` explicitly — see the
 * `siteUrl` prop on each JSON-LD component.
 *
 * `getBranding()` is `"use cache: remote"` and is already awaited by
 * `app/layout.tsx` on every request, so this read is a cache hit, not an extra
 * round trip, and it does not make a cacheable route dynamic.
 *
 * Falls back to the baked env (via `resolveSiteUrl`'s default) when the store
 * has no custom domain, and to the empty string when neither is usable — the
 * same "origin unknown" degradation `storefrontUrl` uses.
 */
export async function resolveJsonLdSiteUrl(
  explicitSiteUrl?: string | null,
): Promise<string> {
  // normalize, NOT resolve: an unusable explicit value must fall through to the
  // runtime store domain, and `resolveSiteUrl` would short-circuit it to the
  // baked env instead.
  const explicit = normalizeSiteUrl(explicitSiteUrl);
  if (explicit) return explicit;
  try {
    const { storeSettings } = await getBranding();
    return resolveSiteUrl(storeSettings.domain);
  } catch (error) {
    unstable_rethrow(error);
    return resolveSiteUrl(null);
  }
}

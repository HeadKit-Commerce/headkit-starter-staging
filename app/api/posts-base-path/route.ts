import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getBranding } from "@/lib/branding";
import { env } from "@/lib/env";
import { getPostsBasePath } from "@/lib/posts-base-path";
import { resolveSiteUrl } from "@/lib/site-url";

/**
 * Lightweight JSON for `proxy.ts`: the two per-store values the proxy needs
 * before it can answer a request.
 *
 * - `base` — the WordPress Posts page slug used as the public blog base path,
 *   for the blog rewrites.
 * - `siteUrl` — the store's declared frontend origin, for the host-indexing
 *   gate that emits `X-Robots-Tag` (see `lib/host-robots.ts`).
 *
 * BOTH live on one endpoint on purpose: the proxy runs on every page request
 * and a second endpoint would be a second subrequest per request for one short
 * string. The path name predates `siteUrl`; it is kept because it is the
 * documented endpoint (`/api/posts-base-path`) and renaming it buys nothing.
 *
 * `siteUrl` is resolved exactly as `app/robots.ts` and the page metadata
 * resolve it — the RUNTIME store domain first, the baked
 * `NEXT_PUBLIC_FRONTEND_URL` only as a fallback. That order is load-bearing:
 * dashboard-api updates Mongo `Store.domain` the moment a custom domain is
 * attached but has historically not redeployed, so a build-time-only read
 * would judge the customer's new live host against the OLD rehearsal origin
 * and `noindex` the store on cutover day.
 *
 * Cacheable — neither value changes often; the proxy revalidates hourly.
 */
export async function GET(): Promise<NextResponse> {
  const [base, siteUrl] = await Promise.all([
    getPostsBasePath(),
    resolveStoreOrigin(),
  ]);
  return NextResponse.json(
    { base, siteUrl },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

/**
 * The store's declared origin, or the baked env url when branding is
 * unreadable. A branding outage must not take the blog rewrites down with
 * it, and the caller already treats an empty origin as "unknown".
 */
async function resolveStoreOrigin(): Promise<string> {
  try {
    const {
      storeSettings: { domain },
    } = await getBranding();
    return resolveSiteUrl(domain, env.NEXT_PUBLIC_FRONTEND_URL);
  } catch (error) {
    unstable_rethrow(error);
    return resolveSiteUrl(null, env.NEXT_PUBLIC_FRONTEND_URL);
  }
}

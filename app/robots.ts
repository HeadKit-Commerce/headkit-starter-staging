import type { MetadataRoute } from "next";
import { unstable_rethrow } from "next/navigation";
import { getBranding } from "@/lib/branding";
import { env } from "@/lib/env";
import { isIndexableCurrentHost } from "@/lib/indexing-decision";
import { getPostsBasePath, postsIndexPath } from "@/lib/posts-base-path";
import { resolveSiteUrl } from "@/lib/site-url";

/**
 * Disallow-everything response. Built fresh each call so no caller can mutate a
 * shared object into a permissive one. The `host` line is retained because it
 * is a canonical-host HINT, not a permission — and dropping it would change the
 * output of every store that already has indexing switched off.
 */
function disallowEverything(host: string | undefined): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
    ...(host ? { host } : {}),
  };
}

/**
 * robots.txt, decided by HOSTNAME first (MIG-03, T-15.1-08-01).
 *
 * Order matters. The host predicate is consulted on EVERY path — and
 * independently of whether the branding read succeeded. The gates default
 * OPEN when branding env is unset (`DEFAULT_BUNDLE` ships
 * `enableSitemap` / `allowIndexing` true). A thrown dashboard read is
 * fail-closed here (`seoSettings` stays null). A temporary migration host
 * must serve `Disallow: /` and advertise no sitemap whatever branding says,
 * so the decision cannot depend on branding at all. A thrown branding read
 * must not
 * short-circuit past the host read either: a path that consults no runtime
 * input is one Next can statically prerender, which would freeze a blanket
 * `Disallow: /` onto the store's own live domain until the next deploy.
 *
 * Deliberately NOT keyed on the Vercel deployment-environment variable: it
 * reads "production" for a production deployment served at ANY host, including
 * the rehearsal host this route exists to close. That variable is therefore
 * never read here — see lib/host-indexing.ts, which names it in full.
 *
 * Deployment Protection is explicitly NOT the mechanism (T-15.1-08-02). It
 * would 401 unauthenticated fetches of infrastructure paths operators need
 * while rehearsing on a protected host. /robots.txt must stay reachable
 * unauthenticated.
 *
 * Reading the Host header makes this route dynamic; it therefore carries no
 * cache directive by design.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  let storeDomain: string | null | undefined;
  // `null` = the branding read threw, so the store switch is UNKNOWN. It is not
  // an early return: the host read below has to happen on this path too.
  let seoSettings:
    | Awaited<ReturnType<typeof getBranding>>["seoSettings"]
    | null = null;
  try {
    ({
      storeSettings: { domain: storeDomain },
      seoSettings,
    } = await getBranding());
  } catch (error) {
    unstable_rethrow(error);
    seoSettings = null;
  }

  // Prefer runtime store domain over baked NEXT_PUBLIC_FRONTEND_URL so custom
  // domains stay authoritative for Host / Sitemap even before a redeploy. On the
  // degraded path `storeDomain` is unset, so this is the env fallback — still a
  // Host HINT only, never a permission.
  const host = resolveSiteUrl(storeDomain, env.NEXT_PUBLIC_FRONTEND_URL);

  // Awaited unconditionally, and before the `||`, so this render always consumes
  // request data and can never be prerendered — whatever branding did.
  const indexableHost = await isIndexableCurrentHost(host);

  // Fail closed on either input: an unknown or non-production host is a
  // temporary host, and an unreadable store switch is not an open one.
  if (!indexableHost || !seoSettings?.allowIndexing) {
    return disallowEverything(host || undefined);
  }

  // Allow the store's Posts-page slug (e.g. /insights/*) plus legacy /news/*
  // so crawlers stay green during/after the base-path rewrite.
  const postsBase = await getPostsBasePath().catch(() => "news");
  const postsAllow = postsIndexPath(postsBase);
  const postAllows =
    postsAllow === "/news" ? ["/news/*"] : [`${postsAllow}/*`, "/news/*"];

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/shop/*",
          "/brand/*",
          ...postAllows,
          "/projects/*",
          "/collections/*",
        ],
        disallow: [
          "/account/*",
          "/checkout/*",
          "/api/*",
          "/account",
          "/checkout",
          "/api",
          "/search/*",
          "/search",
          "/*/*?*",
          "/*?*",
          "*/thank-you",
          "*/error",
          "*/canceled",
          "*/forgot-password",
          "*/reset-password",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: ["/shop/*?*", "/collections?page=*", "/shop?page=*"],
        disallow: [
          "/account/*",
          "/checkout/*",
          "/api/*",
          "/account",
          "/checkout",
          "/api",
        ],
      },
    ],
    // Sitemap off = omit Sitemap line entirely (do not advertise a URL).
    ...(seoSettings.enableSitemap && host
      ? { sitemap: `${host}/sitemap.xml` }
      : {}),
    ...(host ? { host } : {}),
  };
}

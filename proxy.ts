import { NextRequest, NextResponse } from "next/server";
import { hostRobotsTag, ROBOTS_TAG_HEADER } from "@/lib/host-robots";
import {
  INDEXNOW_KEY_FILE,
  maintenanceGate,
  requestHost,
} from "@/lib/maintenance";
import {
  canonicalRedirectUrl,
  isCanonicalRedirectCandidate,
} from "@/lib/canonical-redirect-request";
import { legacyFacetRedirectPath } from "@/lib/legacy-facet-redirect";
import { getMarkdownRewritePath } from "@/lib/markdown/representation";

/** Must match `DEFAULT_POSTS_BASE_PATH` in lib/posts-base-path.ts (internal route). */
const DEFAULT_POSTS_BASE_PATH = "news";

const COOKIE_NAME = "hk-auth-token";

/** Private account routes that require authentication. */
const PRIVATE_ACCOUNT_PATHS = [
  "/account/profile",
  "/account/orders",
  "/account/wishlist",
];
/** Exact path for login/register - redirect to profile if already authenticated. */
const ACCOUNT_LOGIN_PATH = "/account";

function isPrivateAccountPath(pathname: string): boolean {
  if (pathname === ACCOUNT_LOGIN_PATH) return false;
  if (pathname.startsWith("/account/orders/")) return true;
  return PRIVATE_ACCOUNT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isAccountLoginPath(pathname: string): boolean {
  return pathname === ACCOUNT_LOGIN_PATH;
}

function isPublicAccountPath(pathname: string): boolean {
  return (
    pathname === "/account/forgot-password" ||
    pathname === "/account/reset-password"
  );
}

/**
 * Rewrite IndexNow ownership proof files to the internal key handler.
 * Must stay at the storefront root — a non-root keyLocation scopes URLs.
 */
function rewriteIndexNowKeyFile(
  request: NextRequest,
  pathname: string,
): NextResponse | null {
  const match = INDEXNOW_KEY_FILE.exec(pathname);
  const key = match?.[1];
  if (!key) return null;

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = "/api/indexnow-key";
  rewriteUrl.searchParams.set("key", key);
  return NextResponse.rewrite(rewriteUrl);
}

/** The per-store values the proxy needs, read once per request. */
interface ProxyConfig {
  /** WordPress Posts page slug used as the public blog base path. */
  postsBase: string;
  /**
   * The store's declared frontend origin, or `""` when it cannot be read.
   * `""` is the honest "this store declares no origin" value and makes the
   * robots gate fail closed, exactly as the metadata host gate used to.
   */
  siteUrl: string;
}

const UNKNOWN_CONFIG: ProxyConfig = {
  postsBase: DEFAULT_POSTS_BASE_PATH,
  siteUrl: "",
};

/**
 * Paths that never need the per-store config: Next internals, the API surface
 * (including the config endpoint itself — fetching it from here would recurse)
 * and anything with a file extension.
 *
 * Kept as ONE predicate because both consumers must skip the same set: the blog
 * rewrite has always skipped these, and the robots header is pointless on them
 * (static assets are not matched at all, and `robots.txt` disallows `/api/*`).
 */
function needsProxyConfig(pathname: string): boolean {
  return !(
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  );
}

/**
 * Read `/api/posts-base-path` — one subrequest per matched page request,
 * revalidated hourly, carrying BOTH values the proxy needs. Any failure
 * degrades to {@link UNKNOWN_CONFIG}: the blog rewrite falls back to `news` as
 * it always has, and the robots gate falls back to closed.
 */
async function readProxyConfig(request: NextRequest): Promise<ProxyConfig> {
  if (!needsProxyConfig(request.nextUrl.pathname)) return UNKNOWN_CONFIG;
  try {
    const url = new URL("/api/posts-base-path", request.url);
    const res = await fetch(url, {
      // Edge-friendly: honour Cache-Control from the route handler.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return UNKNOWN_CONFIG;
    const data = (await res.json()) as { base?: unknown; siteUrl?: unknown };
    return {
      postsBase:
        typeof data.base === "string" && data.base.length > 0
          ? data.base
          : DEFAULT_POSTS_BASE_PATH,
      siteUrl: typeof data.siteUrl === "string" ? data.siteUrl : "",
    };
  } catch {
    return UNKNOWN_CONFIG;
  }
}

/**
 * Map the store's Posts-page slug onto the internal `/news` App Router tree.
 *
 * Example (Paralel): public `/insights` and `/insights/<slug>` rewrite to
 * `/news` and `/news/<slug>` so the URL matches Settings → Reading. Legacy
 * `/news` URLs 308 to the canonical base when it differs.
 */
function rewritePostsBasePath(
  request: NextRequest,
  pathname: string,
  base: string,
): NextResponse | null {
  if (base === DEFAULT_POSTS_BASE_PATH) {
    return null;
  }

  const basePrefix = `/${base}`;
  if (pathname === basePrefix || pathname.startsWith(`${basePrefix}/`)) {
    const url = request.nextUrl.clone();
    url.pathname =
      pathname === basePrefix
        ? `/${DEFAULT_POSTS_BASE_PATH}`
        : pathname.replace(basePrefix, `/${DEFAULT_POSTS_BASE_PATH}`);
    return NextResponse.rewrite(url);
  }

  const newsPrefix = `/${DEFAULT_POSTS_BASE_PATH}`;
  if (pathname === newsPrefix || pathname.startsWith(`${newsPrefix}/`)) {
    const url = request.nextUrl.clone();
    url.pathname =
      pathname === newsPrefix
        ? basePrefix
        : pathname.replace(newsPrefix, basePrefix);
    return NextResponse.redirect(url, 308);
  }

  return null;
}

/**
 * The canonical 308 for a flat product URL, and for a flat collection URL that
 * carries a query string — issued HERE so the query survives it.
 *
 * The routes themselves cannot do this. `app/products/[...slug]/page.tsx` and
 * `app/collections/[...slug]/page.tsx` build their `Location` from `params`
 * alone because reading `searchParams` (or `headers()`) in a default export is
 * a dynamic read above every Suspense boundary, and on a route that also
 * exports `generateStaticParams` that is a build error under Cache Components —
 * the rule in "Setting a status code needs THREE conditions" in `AGENTS.md`.
 * The proxy is the layer that sees the whole URL, so it is where a campaign
 * link's `gclid` / `utm_*` / `_kx` can be carried through. A flat PRODUCT
 * URL comes here even with no query, because the product route's own 308 is
 * not a real status line for a slug it did not prerender — see
 * `isCanonicalRedirectCandidate`.
 *
 * The DECISION is not made here: `/api/canonical-redirect` calls the routes'
 * own functions. Two copies of a redirect rule is the one arrangement that can
 * loop, so there is no second copy.
 *
 * `null` on any failure — a non-200, a malformed body, a network error. The
 * route then redirects on its own, dropping the query: never a wrong
 * destination and never a loop.
 *
 * `cache: "no-store"` on purpose. The caching that matters is the `"use cache"`
 * entries the endpoint resolves through, which the routes share; a revalidating
 * fetch on top would be a second lifetime able to pin a stale redirect, and
 * these are status-code decisions.
 */
async function canonicalRedirect(
  request: NextRequest,
): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (!isCanonicalRedirectCandidate(request.method, pathname, search)) {
    return null;
  }
  try {
    const endpoint = new URL("/api/canonical-redirect", request.url);
    endpoint.searchParams.set("path", pathname);
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { redirect?: unknown };
    if (typeof data.redirect !== "string" || !data.redirect.startsWith("/")) {
      return null;
    }
    return NextResponse.redirect(
      canonicalRedirectUrl(new URL(request.url), data.redirect),
      308,
    );
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Maintenance gate (cutover gate G6) runs FIRST — before the routing rules
  // below, and in particular before `readProxyConfig`'s API fetch, so a dark
  // store never waits on the systems a cutover window is changing.
  // Mechanism, key naming, and the lift command: apps/starter/MAINTENANCE.md.
  const maintenance = await maintenanceGate(request);
  if (maintenance.response) return maintenance.response;

  // V1 facet query keys (`?brands=`, `?pa_color=`) fold into the canonical
  // `/f/<slug>` path here, ahead of the canonical lookup below: the facet then
  // rides in the PATH, where the route's own `permanentRedirect` preserves it,
  // and the request never pays a subrequest it was going to be redirected out
  // of anyway. Why this cannot live in the page at all —
  // `lib/legacy-facet-redirect.ts`.
  const legacyFacet = legacyFacetRedirectPath(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (legacyFacet) {
    return NextResponse.redirect(new URL(legacyFacet, request.url), 308);
  }

  // Canonical consolidation WITH the query string attached. Gated to the flat
  // product shape and the flat collection shape carrying a query (see
  // `lib/canonical-redirect-request.ts`), so an ordinary request never pays the
  // lookup — and it returns before `readProxyConfig`, because a request that is
  // leaving on a 308 needs neither the blog rewrite nor a robots header.
  const canonical = await canonicalRedirect(request);
  if (canonical) return canonical;

  // Answer-engine Markdown surface (vercel/shop parity): `Accept: text/markdown`
  // or a `.md` suffix rewrites onto `/md…` before blog/robots config runs.
  const markdownPath = getMarkdownRewritePath(request);
  if (markdownPath) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = markdownPath;
    return NextResponse.rewrite(rewriteUrl);
  }

  // ONE read of the per-store config, shared by the blog rewrite and the
  // host-indexing gate below, so neither costs a subrequest of its own.
  const config = await readProxyConfig(request);

  const response = route(request, config.postsBase);
  // Host-based `noindex` — the signal that used to be a per-request `robots`
  // meta and cost every route in the app its static shell. See
  // lib/host-robots.ts.
  const robotsTag = needsProxyConfig(request.nextUrl.pathname)
    ? hostRobotsTag(config.siteUrl, requestHost(request))
    : null;
  if (robotsTag) {
    response.headers.set(ROBOTS_TAG_HEADER, robotsTag);
  }
  // Only set when a config store is connected: lets an operator confirm the
  // exact key this host reads, and that the gate is armed at all, before a
  // window rather than after.
  if (maintenance.key) {
    response.headers.set("x-hk-maintenance-key", maintenance.key);
  }
  if (maintenance.state) {
    response.headers.set("x-hk-maintenance", maintenance.state);
  }
  return response;
}

function route(request: NextRequest, postsBase: string): NextResponse {
  const pathname = request.nextUrl.pathname;

  const indexNow = rewriteIndexNowKeyFile(request, pathname);
  if (indexNow) return indexNow;

  const postsRewrite = rewritePostsBasePath(request, pathname, postsBase);
  if (postsRewrite) return postsRewrite;

  if (isPublicAccountPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (isPrivateAccountPath(pathname)) {
    if (!token) {
      const url = new URL(ACCOUNT_LOGIN_PATH, request.url);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isAccountLoginPath(pathname) && token) {
    const url = new URL("/account/profile", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account",
    "/account/:path*",
    "/:key.txt",
    // Markdown mirrors (`/index.md`, `/products/foo.md`, …). The catch-all
    // below excludes dotted paths, so `.md` must be listed explicitly.
    "/index.md",
    "/:path*.md",
    // Blog base-path rewrite + legacy /news → canonical Posts-page slug.
    // Exclude Next internals and common static file extensions.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

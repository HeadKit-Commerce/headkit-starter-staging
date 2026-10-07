import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";

import type { NextConfig } from "next";

import {
  parseCgroupMemoryLimit,
  resolveBuildWorkers,
} from "./lib/build-parallelism";
import { resolvePrerenderTimeout } from "./lib/prerender-timeout";

/**
 * The container's memory limit, when the kernel exposes one (cgroup v2 first,
 * then v1). Unreadable on macOS and on any host without cgroups, which is why
 * every failure here is `undefined` rather than an error: the caller then falls
 * back to `os.totalmem()`, and a missing limit only ever costs workers, never
 * over-provisions them.
 */
function readCgroupMemoryLimit(): number | undefined {
  for (const path of [
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  ]) {
    try {
      const parsed = parseCgroupMemoryLimit(readFileSync(path, "utf8"));
      if (parsed !== undefined) return parsed;
    } catch {
      /* No cgroup at this path — try the next, then fall back. */
    }
  }
  return undefined;
}

/**
 * Image `remotePatterns` allowlist (FE-10).
 *
 * Built conditionally so an unset/empty `IMAGE_DOMAIN` never produces an
 * empty-string hostname (which crashes the Next 16 build —
 * `images.remotePatterns[n].hostname`). Specific hosts are allowlisted to
 * avoid SSRF via the image optimizer — never a `**` wildcard host.
 *
 * Always allowlisted:
 *  - `storage.googleapis.com` — GCS-served static media for the SDK/commerce
 *    catalog AND dashboard-api branding (logo/icon) assets (FE-08).
 *  - `localhost` — local WP/WC media host for local Docker dev (WP on :8090,
 *    served over http).
 *
 * Conditionally allowlisted:
 *  - `process.env.IMAGE_DOMAIN` — a deploy's configured image host; pushed
 *    ONLY when non-empty.
 */
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  { protocol: "https", hostname: "storage.googleapis.com" },
  { protocol: "http", hostname: "localhost" },
  // Local WP media is served on :8090 — an explicit-port URL does not match a
  // portless remotePattern in Next 16, so the optimizer 400s without this entry
  // (gray placeholders for every product/hero/brand image in local dev).
  { protocol: "http", hostname: "localhost", port: "8090" },
  // Shopify Storefront CDNs. Exact hosts — never a ** wildcard. Shops that
  // serve /cdn/shop/... from the myshopify domain need the subdomain pattern.
  { protocol: "https", hostname: "cdn.shopify.com" },
  { protocol: "https", hostname: "cdn.shopifycdn.net" },
  { protocol: "https", hostname: "*.myshopify.com" },
];

/**
 * `IMAGE_DOMAIN` accepts a COMMA-SEPARATED list, not just one host.
 *
 * A migrating store serves images from more than one origin at once, and this
 * is the normal case rather than an edge one. WordPress stores absolute URLs in
 * post content, so a database copied from the old site keeps pointing at the
 * OLD host — while newly-read media resolves against the new one. Dishee's home
 * carousel referenced `commerce.dishee.com.au` while every product image came
 * from the clone.
 *
 * A host missing from this allowlist does not degrade: the optimizer answers
 * 400 and the image renders broken, with `naturalWidth` 0 and a 200 on the page
 * around it. Nothing reports it. (400 = refused by this allowlist, 404 =
 * allowed through and simply absent upstream — a useful way to tell them apart
 * when diagnosing.)
 *
 * Still an explicit allowlist, never a wildcard host — the optimizer is an SSRF
 * surface, so entries stay exact hostnames.
 */
for (const rawHost of (process.env.IMAGE_DOMAIN ?? "").split(",")) {
  const hostname = rawHost.trim();
  if (hostname) remotePatterns.push({ protocol: "https", hostname });
}

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * Build-time prerender throttle (layered with the SDK's in-flight read cap).
 *
 * Prerendering the full category×colour×brand + product×colour matrix fires
 * bursts of reads at the gateway → WooCommerce REST; managed WP (Pressable)
 * rate-limits aggressively and stays 429 for longer than a few seconds,
 * exhausting the SDK retry budget.
 *
 * The SDK also caps in-flight reads per process
 * (`HEADKIT_SDK_MAX_CONCURRENT`, default 4, 0 = off) — the precise throttle on
 * what WP actually sees. That cap is per worker PROCESS, so the effective
 * global read ceiling is `HEADKIT_SDK_MAX_CONCURRENT × workers`, and it is the
 * worker count — not the page concurrency — that moves it: a worker rendering
 * two pages at once still has at most 4 reads on the wire.
 *
 * Both were hard-coded to `1` while the SDK had no proactive cap, so every
 * storefront prerendered with ONE worker whatever machine it was given. For a
 * large catalogue the cost is not a slow build but an unfinishable one: on
 * Vercel's standard 4-core/8 GB build machine one worker reached 13,116 of a
 * store's 14,615 pages in the 45-minute platform ceiling
 * (`BUILD_EXCEEDED_MAXIMUM_TIME`).
 *
 * The worker count is now derived from the build MACHINE — see
 * `lib/build-parallelism.ts`, which carries the four-build measurement it comes
 * from. Memory, not cores, is the binding resource, so an 8 GB machine still
 * resolves to one worker (today's behaviour, and the config that did not OOM)
 * while a 16 GB machine gets two.
 *
 * Page concurrency stays at 1. Raising it to 2 was measured to buy no
 * throughput — a worker's page renders are dominated by one upstream read
 * each, and the SDK's cap is per PROCESS, so two pages at once still put at
 * most 4 reads on the wire — while coinciding with the worst failure of the
 * four builds. It is left as an env lever rather than a default.
 *
 * Both stay overridable in BOTH directions: `NEXT_BUILD_CPUS=1` pins the
 * serialized build for a store whose provider cannot take the reads, and a
 * bigger build machine can be spent by raising them.
 */
const positiveIntEnv = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw ?? "");
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * The prefetch budget's build-time half.
 *
 * `partialPrefetching` and `InstantLink`'s `prefetch` default are ONE decision
 * read from ONE variable: partial prefetching is what makes an unset `prefetch`
 * cheap (a `/_tree` request plus static per-segment bundles, no runtime request),
 * so a build with the config key and without the default change — or the reverse —
 * is a state nobody measured. `lib/nav-interaction-flags.ts` owns the value table
 * and the client-side half; this is the same rule, spelled out here because
 * `next.config.ts` cannot import from `@/lib` paths that pull in client code.
 *
 * Off by default, which is the platform's behaviour today. The key itself is valid
 * on the pinned Next (>= 16.3); it used to be omitted because on 16.2.x it failed
 * `next build`'s type check, and that blocker is gone.
 */
const navPrefetchBudget = ["true", "1", "on", "yes"].includes(
  (process.env.NEXT_PUBLIC_NAV_PREFETCH_BUDGET ?? "").trim().toLowerCase(),
);

/**
 * Minimum lifetime of an OPTIMIZED image in the image cache, in seconds.
 *
 * UNSET BY DEFAULT, which means Next's own default of 14,400 s / 4 h
 * (`next/dist/shared/lib/image-config.js`). `NEXT_IMAGE_MINIMUM_CACHE_TTL` raises
 * it per store; the Bike Society fork runs 2592000 (30 days).
 *
 * Read the next paragraph before reasoning about product photos: this key does NOT
 * govern them, and the obvious worry about it is misplaced.
 *
 * The effective TTL is `Math.max(minimumCacheTTL, upstream max-age)`
 * (`next/dist/server/image-optimizer.js`). Measured on a rehearsal storefront
 * 2026-09-17: Pressable serves every `wp-content/uploads/…` asset with
 * `Cache-Control: max-age=31536000`, and the optimized response for one came back
 * `public, max-age=31536000, must-revalidate` on a deployment where this key was
 * UNSET. So every WordPress-hosted product, hero and brand image is already cached
 * for a year by the origin's own header, and no value here can shorten that.
 *
 * What it does govern is every source whose upstream sends a SHORT or absent
 * `Cache-Control`: this repo's own `/public` assets (measured `max-age=0`, so they
 * re-optimize every 4 h for nothing, since they can only change by deploying) and
 * dashboard branding on `storage.googleapis.com`. That second class is why the
 * fork chose 30 days rather than NextFaster's year, and why this is a per-store
 * value rather than a new platform default: a merchant who swaps a logo in the
 * dashboard has NO automatic purge path to the image cache, so whatever is set
 * here is the worst case they must wait out.
 *
 * There IS a manual purge path, and it is the only one:
 * `vercel cache invalidate --srcimg <path>`, or `invalidateBySrcImage()` from
 * `@vercel/functions`. Nothing in this repo or in the WordPress theme calls it —
 * the theme's purge hooks fire Next cache TAGS, which reach page entries and never
 * the image cache.
 *
 * What the browser sees is a separate question with a separate answer: on Vercel
 * the optimized response's own `max-age` tracks the UPSTREAM header, not this key
 * (measured above), so raising it pins nothing in a shopper's browser — the one
 * cache nobody can purge.
 */
const imageMinimumCacheTTL = positiveIntEnv(
  process.env.NEXT_IMAGE_MINIMUM_CACHE_TTL,
  0,
);
const buildCpus = positiveIntEnv(
  process.env.NEXT_BUILD_CPUS,
  resolveBuildWorkers({
    totalMemBytes: totalmem(),
    cgroupLimitBytes: readCgroupMemoryLimit(),
    cpus: availableParallelism(),
  }),
);
const staticGenConcurrency = positiveIntEnv(
  process.env.NEXT_STATIC_GEN_CONCURRENCY,
  1,
);

/**
 * Deployment identifier, stamped onto every JS/CSS asset request as `?dpl=`.
 *
 * Two things depend on it, and neither is available without it.
 *
 * Version skew: a browser holding the previous build's client bundle keeps
 * requesting the previous build's chunks. With a deployment id, Next detects
 * the mismatch and performs a hard navigation instead of failing the request.
 *
 * Deployment verification: a deployment reporting `state: READY` is not the
 * same claim as "the DOMAIN serves that deployment", and nothing observable
 * from outside separates them unless the served HTML carries the id. Reading
 * it off the page is the only way to assert that a sweep of a live storefront
 * describes ONE deployment rather than a mixture of two mid-rollout — which is
 * what a migration cutover is.
 *
 * `VERCEL_DEPLOYMENT_ID` is injected by Vercel at build. Off Vercel — local
 * dev, Docker, CI — both are unset, this resolves to `undefined`, the key is
 * omitted, and Next behaves exactly as it did before. Vercel's Skew Protection
 * toggle sets the same thing, but per project: doing it here makes it a
 * property of the template every store inherits, rather than a checkbox each
 * new store can be created without.
 */
const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID;

/**
 * Raised prerender budget for a store that has MEASURED its need for one.
 * Unset on every store by default, and then both keys are omitted and the
 * build keeps Next's own 60s page budget exactly as it does today.
 *
 * `lib/prerender-timeout.ts` carries why this is the only lever (the
 * `useCacheTimeout` key alone is inert in a build), how to size the number
 * from a store's own fan-out, and what a larger value costs when a page hangs
 * outside a cached function.
 */
const prerenderTimeout = resolvePrerenderTimeout(
  process.env.HEADKIT_STATIC_PAGE_GENERATION_TIMEOUT,
);

const nextConfig: NextConfig = {
  transpilePackages: ["@headkit/sdk"],
  ...(deploymentId ? { deploymentId } : {}),
  // Cache Components (already on) + Partial Prefetching unlock Instant
  // Navigations in Next.js 16.3: reusable App Shells, fewer prefetch
  // requests, Instant Insights / Navigation Inspector in dev.
  // https://nextjs.org/blog/next-16-3
  //
  // Partial Prefetching makes a default link fetch only the reusable App Shell,
  // and it is half of ONE per-store decision with `InstantLink`'s `prefetch`
  // default — see `navPrefetchBudget` above and that component's docblock, which
  // owns the rule. Off unless the store sets NEXT_PUBLIC_NAV_PREFETCH_BUDGET.
  cacheComponents: true,
  ...(navPrefetchBudget ? { partialPrefetching: true } : {}),
  ...(prerenderTimeout
    ? {
        staticPageGenerationTimeout:
          prerenderTimeout.staticPageGenerationTimeout,
      }
    : {}),
  experimental: {
    // Remind on `next dev` / `next build` when a newer stable Next.js
    // release is available. https://nextjs.org/blog/next-16-4
    agentUpgrade: "latest",
    optimizePackageImports: ["react-icons", "@headkit/sdk"],
    cpus: buildCpus,
    staticGenerationMaxConcurrency: staticGenConcurrency,
    // Report EVERY bad page in one build, not just the first one.
    //
    // Deliberate diagnostic choice — do not "clean up" as an unused
    // experimental flag. Next's default (`true`) makes the export worker
    // `process.exit(1)` on the first page that fails after its retries, so a
    // catalogue with three broken products surfaces exactly one of them per
    // run. With a 14,615-page store that build costs ~32 minutes, so each
    // additional bad row is another half-hour round trip; the most recent one
    // died at page 14,448 and told us nothing about the 167 after it.
    //
    // Set to `false`, the worker records the failure and keeps going; the
    // export then throws `Export encountered errors on N paths:` listing all
    // of them (next/dist/export/index.js). The build still FAILS on a
    // prerender error — this changes only how much of the damage one failing
    // build is allowed to report.
    prerenderEarlyExit: false,
    // The effective prerender cache-fill budget, in seconds. Next clamps it to
    // `staticPageGenerationTimeout * 0.9`, so it is written out only when that
    // key is raised, and then at the value the clamp would produce anyway —
    // stating it keeps the intended budget if Next's 0.9 factor ever moves.
    ...(prerenderTimeout
      ? { useCacheTimeout: prerenderTimeout.useCacheTimeout }
      : {}),
  },
  images: {
    // Prefer modern formats everywhere the optimizer runs (PLP cards, heroes,
    // logos). AVIF first, WebP fallback — never serve source PNG/JPEG bytes
    // when the optimizer can negotiate a smaller format.
    formats: ["image/avif", "image/webp"],
    // Next's default list ends at 3840, and that largest width becomes the
    // <img src> fallback for every `sizes` that uses vw. These storefronts
    // never paint a 4K hero; 2048 matches the largest WordPress derivative.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    // See `imageMinimumCacheTTL` above: absent unless the store sets a value, and
    // absent means Next's 4 h default.
    ...(imageMinimumCacheTTL > 0
      ? { minimumCacheTTL: imageMinimumCacheTTL }
      : {}),
    // 65 = catalog grid cards; 50 = phone hero encode and carousel cards; 75 = desktop hero.
    qualities: [50, 65, 75, 100],
    remotePatterns,
    // Next 16 blocks image URLs that resolve to a private/loopback IP (SSRF
    // protection, default false). Local WP media is on http://localhost:8090,
    // which resolves to 127.0.0.1, so the optimizer 400s ("url is not allowed")
    // in local dev. Allow it ONLY in dev — production keeps the safe default.
    // ALLOW_LOCAL_IMAGES=1 is a measurement-only escape hatch so a local
    // PRODUCTION build (Lighthouse against `next start`) can serve WP media;
    // it must never be set on a real deploy and defaults off.
    dangerouslyAllowLocalIP:
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_LOCAL_IMAGES === "1",
  },
  async redirects() {
    return [
      // /posts -> /news, the blog's one url move.
      //
      // headkit-demo served the blog at /posts; apps/starter serves it at
      // /news. This lived as two route files calling `redirect()`, and doing a
      // url move in a rendered page failed three separate ways at once:
      //
      //   `redirect()` emits 307, not 308, so the move was TEMPORARY and
      //   passed no ranking to /news — while both files documented themselves
      //   as "permanent redirect".
      //
      //   Both files awaited `params`/`searchParams` inside Suspense, and a
      //   redirect thrown inside a Suspense boundary runs AFTER the response
      //   has committed. `/posts/<slug>` therefore answered 200 with an app
      //   shell and redirected only on the client — invisible to a crawler,
      //   which is the only reader this exists for. (A rendered page CAN serve
      //   a real 308 under Cache Components, but only above every boundary —
      //   in-page, `loading.tsx` and ancestor-layout alike — and it forfeits
      //   the route's App Shell to do it; `app/collections/[...slug]/page.tsx`
      //   documents the measurements and pays that price because it has a
      //   category to look up first.)
      //
      //   The index built its query string by treating `searchParams` as a
      //   plain object; in Next 16 it is a Promise, so every request landed on
      //   `/news?displayName=searchParams`.
      //
      // A url move has nothing to fetch and nothing to render, so it belongs
      // here — before rendering, unconditionally, as a real 308. Measured on a
      // dev server: /posts, /posts/<slug> and /posts?page=2 all 308 to their
      // /news counterpart with the query intact.
      { source: "/posts", destination: "/news", permanent: true },
      { source: "/posts/:slug*", destination: "/news/:slug*", permanent: true },
      // Shopify Online Store URL shapes → HeadKit/Woo storefront paths.
      // Commerce menus/content now emit bare /{page} and /{postsBase}/…, but
      // bookmarked Admin links and any missed emitter still 404 without these.
      { source: "/pages/:path*", destination: "/:path*", permanent: true },
      {
        source: "/blogs/:blog/:article*",
        destination: "/:blog/:article*",
        permanent: true,
      },
      { source: "/blogs/:blog", destination: "/:blog", permanent: true },
      // Shopify Catalog / "All Collections" and the automatic "All products"
      // collection → HeadKit /shop (Woo shop page). Do NOT redirect
      // /collections/:slug — those are real category PLPs.
      { source: "/collections", destination: "/shop", permanent: true },
      { source: "/collections/all", destination: "/shop", permanent: true },
    ];
  },
  async rewrites() {
    return [];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Let the CDN keep `/sitemap.xml`. `app/sitemap.ts` is a metadata route
      // and cannot set its own response headers; its body already comes from
      // ONE `"use cache: remote"` entry, but without `s-maxage` every crawler
      // fetch still invoked the function (measured on one storefront:
      // `x-vercel-cache: MISS`, 1.4 MB, ~2 s per fetch). Vercel's CDN honours
      // `s-maxage` / `stale-while-revalidate` from a response's own
      // `Cache-Control`, so a Search Console fetch becomes an edge HIT.
      //
      // THE COST IS A DELIBERATE HOUR OF BLINDNESS: a tag purge invalidates
      // the cached ENTRY behind the route, not the CDN copy, so a sitemap can
      // advertise a deleted URL or omit a new one for up to an hour after the
      // purge that should have fixed it. Accepted for a sitemap, where a
      // crawler's own revisit interval is measured in hours to days. Do not
      // copy this to a shopper-facing route.
      // `app/sitemap-cache-control.test.ts` pins the exact value.
      {
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      // The vendored WordPress block stylesheet is served from `public/`
      // instead of being imported, so that only a route which actually
      // renders WordPress prose pays for it — `lib/editorial-stylesheet.ts`
      // carries the whole reason. `public/` assets get no long cache by
      // default, and this one is RENDER-BLOCKING on the routes that do use it,
      // so a revalidation round trip would land in their critical path. The
      // file name is CONTENT-ADDRESSED (`lib/editorial-stylesheet.test.ts`
      // fails if the bytes and the name disagree), which is what makes
      // `immutable` safe here.
      {
        source: "/editorial/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { headkit as sdk } from "@/lib/sdk";
import {
  makeSeoMetadata,
  seoFallbackDescription,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { cmsPlaceholderVerdict } from "@/lib/cms-placeholder-pages";
import { getPostsBasePath, postsIndexPath } from "@/lib/posts-base-path";
import { TAG } from "@/lib/cache-tags";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import { CmsPageBody } from "@/components/headkit-ui/cms-page-body";
import { ShopifyContactForm } from "@/components/shopify-contact-form";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { shopifyContactSubscribeProps } from "@/lib/shopify-contact-subscribe";
import {
  isShopifyPartnershipsSlug,
  isShopifyStorefront,
} from "@/lib/shopify-storefront";
import {
  PageWithOptionalForm,
  shopifyFormUsesSideColumn,
} from "@/overrides/page-form-layout";

/** Satisfies Cache Components: `generateStaticParams` must not return []. */
const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

/**
 * Common CMS page slugs to probe at build. Existing pages are prerendered into
 * the CDN HTML shell (FAQ-like instant paint). Without this list + with a
 * segment `loading.tsx`, Cache Components seals the skeleton as the shell and
 * every HIT flashes loading UI before streamed content — even when
 * `getPageData` is warm in `"use cache"`.
 */
const PRERENDER_PAGE_CANDIDATES = [
  "services",
  "about",
  "shipping",
  "returns",
  "privacy",
  "terms",
  "warranty",
  "care",
  "contact-us",
  "our-story",
  "delivery",
  "payment",
  "size-guide",
  "sustainability",
  "trade",
  "commercial",
] as const;

interface Props {
  params: Promise<{ slug: string[] }>;
}

/**
 * Params-safe cached CMS read. The slug is joined + passed in as a PLAIN STRING
 * by the caller (`Page`/`generateMetadata`), which read `params` OUTSIDE this
 * cached scope — a `use cache` fn must never touch `params`/`searchParams`/
 * `cookies` (threat T-09.5-15, the 50s cache-fill build hang). `content()`
 * resolves PAGE by bare slug/path (no leading slash) — the WP /content/page/
 * {slug} route + provider look up by path. Tagged `headkit:page:{slug}` (exact
 * page save) and `headkit:pages` (carousel/slide CPT + schedule boundary — WP
 * hydrates hero slides into page editorBlocks, so carousel edits must purge
 * every CMS page that may embed a hero). Finite `days` life so a missed
 * webhook self-heals in ~1 day (threat T-09.5-14).
 *
 * NULL MEANS MISS, AND ONLY MISS. `sdk.content.get` resolves null for a page
 * that does not exist and THROWS for a transport/GraphQL failure, so this must
 * not catch: a thrown read caught into null would be written into this
 * `"use cache"` entry, and the pre-commit gate above turns that null into a
 * real 404 — so one gateway blip on a cold `/about` would bake a hard 404 into
 * the route cache for `days`, self-healing only on a tag purge. Propagating
 * instead surfaces the outage as an error (uncached, self-healing on the next
 * request), which is the same invariant `app/brand/[...slug]`,
 * `app/collections/[...slug]` and `app/shop/[...slug]` state at their own
 * gates and the news/projects/client routes keep with `unstable_rethrow`.
 * `/wholesale` shares this helper and inherits it.
 *
 * ### The build-availability trade, decided deliberately
 *
 * Propagating also means a transient CMS/transport failure can FAIL
 * `next build`: `generateStaticParams` probes and returns `/about`, then a blip
 * during that page's prerender throws out of `generateMetadata` and the export
 * stops. `/wholesale` is a prerendered static route on the same helper with the
 * same exposure. That is ACCEPTED, and the reasoning is the point:
 *
 * A failed build is loud and blocks a bad deploy. The alternative — degrading
 * to `notFound()` at build — bakes a sticky 404 into the prerendered output,
 * which is EXACTLY the failure removing the blanket catch closed: one blip and
 * a real page serves 404 for up to `cacheLife("days")`, self-healing only on a
 * tag purge. A blocked deploy is recoverable in minutes; a store silently
 * 404ing its own pages is not.
 *
 * `/contact` is NOT a counter-example and the two must never be conflated. It
 * catches at the CONSUMER (`loadContactPage`) because it HAS built-in default
 * copy to fall back to, so degrading there still serves a working contact form.
 * `/[...slug]` and `/wholesale` have nothing to degrade TO — tolerating the
 * error would mean serving a WRONG page, not a degraded one.
 *
 * `ProductPageContent` in `app/products/[...slug]/page.tsx` reaches the
 * OPPOSITE conclusion on the same class of failure, deliberately and under the
 * same policy: it has a degraded body to fall back to, and its
 * `generateStaticParams` enumerates every prerendered product, so failing the
 * build there would discard the whole export over one transient blip. It
 * degrades and LOGS. The shared rule is: never bake a lie, and never be silent
 * about degrading. Read that comment beside this one.
 *
 * If this trade is ever revisited, the fix is per-consumer tolerance as
 * `/contact` does it. Never a blanket catch back inside this shared helper, and
 * never a build-phase discriminator: nothing here needs to know the phase — the
 * decision above is the same in both — and a direct `process.env` read outside
 * `lib/env.ts` is listed under "Never" in `AGENTS.md`.
 */
export async function getPageData(
  contentSlug: string,
): Promise<Awaited<ReturnType<typeof sdk.content.get>> | null> {
  "use cache";
  cacheLife("days");
  cacheTag(TAG.page(contentSlug), TAG.pages);
  return sdk.content.get(contentSlug, "PAGE");
}

/**
 * WordPress Reading → Posts page slug (e.g. "insights"). Nav often links here.
 * `proxy.ts` rewrites that slug onto the internal `/news` tree; this redirect
 * is a safety net when the proxy rewrite is skipped (base === news, or fetch
 * failure) and someone still hits the CMS catch-all for the Posts page.
 *
 * RAW, unnormalised — it is compared against the requested slug, which is also
 * raw. The redirect TARGET must never be derived from it; see
 * {@link postsLandingRedirectTarget}.
 */
async function getPostsLandingSlug(): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(TAG.posts, TAG.pages);
  const landing = await sdk.posts.getLanding().catch(() => null);
  const slug = landing?.slug?.trim();
  return slug || null;
}

/**
 * Where a request for the WordPress Posts page must be sent, or null to serve.
 *
 * This used to redirect to a hard-coded `/news`, which made it a second,
 * independent redirect-loop generator alongside the `/posts` one that
 * `RESERVED_POSTS_BASE` closes (`lib/posts-path.ts`): `proxy.ts` may be
 * simultaneously 308ing `/news` back OUT to the store's own base, so the two
 * flap against each other. Two rules keep that impossible:
 *
 *  1. the target comes from the same NORMALISED resolver the proxy's own
 *     `/api/posts-base-path` endpoint reads (`getPostsBasePath`), so a reserved
 *     slug — `posts` included — resolves to `/news` and the proxy early-returns
 *     rather than redirecting away; and
 *  2. a target equal to the requested path is a no-op, not a redirect, so this
 *     can never send a URL to itself.
 */
async function postsLandingRedirectTarget(
  contentSlug: string,
): Promise<string | null> {
  const postsLandingSlug = await getPostsLandingSlug();
  if (!postsLandingSlug || contentSlug !== postsLandingSlug) return null;
  const target = postsIndexPath(await getPostsBasePath());
  return target === `/${contentSlug}` ? null : target;
}

/**
 * Prerender known CMS pages so their HTML shell contains real content (not a
 * loading skeleton). Candidates that 404 at build are skipped; Cache Components
 * still requires ≥1 param so we fall back to a placeholder.
 */
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  try {
    const results = await Promise.all(
      PRERENDER_PAGE_CANDIDATES.map(async (slug) => {
        const page = await sdk.content.get(slug, "PAGE").catch(() => null);
        return page ? { slug: slug.split("/") } : null;
      }),
    );
    const paths = results.filter((p): p is { slug: string[] } => p !== null);
    if (paths.length > 0) return paths;
  } catch {
    /* API unreachable at build — fall through */
  }
  return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) {
    return { robots: { index: false, follow: false } };
  }
  const path = slug.join("/");
  const [page, { seoSettings, storeSettings }] = await Promise.all([
    getPageData(path),
    getBranding(),
  ]);
  if (!page) {
    return { robots: { index: false, follow: false } };
  }
  // Real Yoast SEOData wins; when absent, emit a TEMPLATED page default
  // (title + per-entity description) rather than the old noindex-only
  // parent fallback — D-04 mandates a sane SEO floor, not a suppressed page.
  return await makeSeoMetadata(page.seo ?? null, {
    title: page.title,
    description: seoFallbackDescription("page", page.title),
    // Self-referencing canonical: every CMS page (`/about`, `/legal/*`, …)
    // shipped none, and Yoast's own value names the WordPress host.
    canonical: storefrontUrl(`/${path}`, storeSettings.domain),
    siteUrl: storeSettings.domain,
    // Without this the page-level `robots` defaulted to index and OVERRODE the
    // layout's correct value, so the store's indexing switch never reached
    // any CMS page.
    allowIndexing: seoSettings.allowIndexing,
  });
}

/**
 * Blocking route (Next.js 16.3) — a missing page must answer a real 404.
 *
 * The three conditions that let this route SET that status, why `instant` is
 * not one of them, the list of gated routes and the accepted skeleton cost all
 * live in ONE place: "Setting a status code needs THREE conditions" in
 * `apps/starter/AGENTS.md`. Read it before changing the gate below, adding a
 * `loading.tsx`, or touching `generateStaticParams`.
 *
 * `instant = false` here is that section's declaration rule: this route blocks
 * on one cached read before it responds.
 *
 * @see https://nextjs.org/docs/app/guides/streaming (The HTTP contract)
 */
export const instant = false;

export const ensureStatic = "navigation";

export default async function Page({ params }: Props) {
  // Pre-commit gate: every branch that can 404 or redirect resolves HERE, while
  // the status line is still ours to set. `CmsRoute` repeats the checks because
  // it must stay correct on its own terms and it narrows `page` for TypeScript;
  // both reads are `"use cache"`, so the repeat is a cache hit, not a round
  // trip.
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) notFound();
  const contentSlug = slug.join("/");

  // Empty WordPress/WooCommerce placeholder pages — see
  // `lib/cms-placeholder-pages.ts`, which the sitemap reads from too.
  const placeholder = cmsPlaceholderVerdict(contentSlug);
  if (placeholder?.kind === "not-found") notFound();
  if (placeholder?.kind === "redirect") permanentRedirect(placeholder.to);

  const redirectTo = await postsLandingRedirectTarget(contentSlug);
  if (redirectTo) permanentRedirect(redirectTo);

  if (!(await getPageData(contentSlug))) notFound();

  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] space-y-4 px-5 py-10 md:px-10">
          <Skeleton animated={false} className="h-4 w-40" />
          <Skeleton animated={false} className="h-10 w-64 max-w-full" />
          <Skeleton animated={false} className="h-4 w-full max-w-xl" />
          <Skeleton animated={false} className="h-4 w-full max-w-lg" />
        </div>
      }
    >
      <CmsRoute params={params} />
    </Suspense>
  );
}

async function CmsRoute({ params }: Props) {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return notFound();
  const contentSlug = slug.join("/");

  const placeholder = cmsPlaceholderVerdict(contentSlug);
  if (placeholder?.kind === "not-found") return notFound();
  if (placeholder?.kind === "redirect") permanentRedirect(placeholder.to);

  // Posts page may use any WP slug (Insights, Blog, …). That page alone has no
  // post grid. `proxy.ts` normally rewrites the slug onto the internal `/news`
  // tree before this catch-all runs; if that rewrite is skipped, send visitors
  // to the resolved blog index (ENG-558). Unreachable in practice — the gate in
  // the default export above fires first — but kept so this component is
  // correct on its own terms, and sharing the resolver is what stops the two
  // copies drifting into disagreement.
  const redirectTo = await postsLandingRedirectTarget(contentSlug);
  if (redirectTo) permanentRedirect(redirectTo);

  const page = await getPageData(contentSlug);

  if (!page) return notFound();

  // BreadcrumbList JSON-LD (D-04 core type) built from the page slug/title.
  const breadcrumbItems = [
    { name: "Home", href: "/" },
    { name: page.title, href: `/${slug.join("/")}` },
  ];

  const html = page.content ?? "";
  const shopifyPartnerships =
    isShopifyStorefront(env) && isShopifyPartnershipsSlug(contentSlug);
  const subscribe = shopifyPartnerships
    ? await shopifyContactSubscribeProps()
    : null;

  // No outer px/my — CmsPageBody pads HTML/GF segments like the homepage and
  // leaves hero carousels full-bleed (`mx-5` inside MainCarousel). Outer
  // `px-5 md:px-10 my-10` previously double-inset carousels and left a gap
  // under the nav on pages like /hospitality. A customer override can place
  // the partnerships form beside the copy.
  const editorBlocks = (page.editorBlocks ?? []) as Array<{
    products?: unknown[];
    attrs?: Record<string, unknown> | null;
    queryType?: string | null;
  }>;
  const form = shopifyPartnerships ? (
    <ShopifyContactForm
      context="partnerships"
      variant="partnerships"
      subscribeEnabled={subscribe?.subscribeEnabled ?? false}
      subscribeLabel={subscribe?.subscribeLabel ?? ""}
    />
  ) : null;
  const body = (
    <CmsPageBody
      title={page.title}
      html={html}
      editorBlocks={editorBlocks}
      splitMedia={!(form && shopifyFormUsesSideColumn())}
    />
  );
  return (
    <div className="min-h-[50vh] overflow-hidden">
      <BreadcrumbJsonLD items={breadcrumbItems} />
      <PageWithOptionalForm body={body} form={form} />
    </div>
  );
}

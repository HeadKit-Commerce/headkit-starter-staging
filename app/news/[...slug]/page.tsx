import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { headkit as sdk } from "@/lib/sdk";
import { env } from "@/lib/env";
import { errorFields, logger } from "@/lib/logger";
import { FeaturedImageHeader } from "@/components/headkit-ui/post/featured-image-header";
import { PostBody } from "@/components/headkit-ui/post/post-body";
import { PostCarousel } from "@/components/headkit-ui/post/post-carousel";
import { SectionHeader } from "@/components/headkit-ui/section-header";
import { ArticleJsonLD } from "@/components/seo/article-json-ld";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import { CarouselPostJsonLD } from "@/components/seo/carousel-post-json-ld";
import {
  makeSeoMetadata,
  resolveStoreName,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import {
  getPostsBasePath,
  getPostsLanding,
  postsArticlePath,
  postsIndexPath,
} from "@/lib/posts-base-path";
import type { RawEditorBlock } from "@/lib/process-editor-blocks";

interface Props {
  params: Promise<{ slug: string[] }>;
}

/**
 * Satisfies Cache Components: `generateStaticParams` must not return [].
 * @see https://nextjs.org/docs/messages/blocking-route#generatestaticparams
 */
const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

/**
 * How many of the MOST RECENT posts are prerendered at build when
 * `HEADKIT_PRERENDER_POST_LIMIT` is unset (`lib/env.ts`). The cap is what
 * bounds the build cost: every prerendered post is exactly ONE content read
 * (`getPost` below, `"use cache"` `days`; the branding, base-path and landing
 * reads beside it are shared, and the carousels render from the payload's
 * hydrated `editorBlocks`), paced by commerce's 1.8 req/s origin bucket — so
 * 100 posts is about one minute of build time, plus one list read per 100.
 * Everything past the cap still renders on demand exactly as before.
 */
export const PRERENDER_POST_LIMIT_DEFAULT = 100;

/**
 * `headkit/v2` list endpoints cap `per_page` at 100 and 400 above it (see the
 * root AGENTS.md); a larger ask enumerates nothing, silently.
 */
const PRERENDER_POST_PAGE_SIZE = 100;

/**
 * The prerender log event. One line per build with the count ACTUALLY
 * enumerated (which is what a build log needs to say whether the cap or the
 * catalogue decided it), same shape as the `bulk_prefetch` lines beside it.
 */
const PRERENDER_LOG_EVENT = "posts_prerender";

function prerenderPostLimit(): number {
  const raw = env.HEADKIT_PRERENDER_POST_LIMIT;
  if (raw === undefined) return PRERENDER_POST_LIMIT_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : PRERENDER_POST_LIMIT_DEFAULT;
}

/**
 * A slug the route can actually resolve: it reads the LAST segment of the
 * catch-all, so a post is emitted as a single segment, and a value carrying a
 * separator would split into segments that name a different post.
 */
function isPrerenderablePostSlug(slug: string): boolean {
  return slug !== STATIC_GEN_PLACEHOLDER_SLUG && !slug.includes("/");
}

/**
 * Walk `posts.list` newest-first (the theme's default `orderby=date&order=DESC`)
 * until `limit` distinct slugs are in hand or the endpoint's own `totalPages`
 * (or an empty page) ends it. A short page is NOT a terminator — only the
 * endpoint knows whether it dropped a row.
 *
 * Any failure yields `[]`, never a throw: a store without posts, a WooCommerce
 * store with the blog disabled and a Shopify provider without a blog must all
 * still build. The 404 gate keeps working either way because the caller
 * always emits the placeholder param first.
 */
async function collectRecentPostSlugs(limit: number): Promise<string[]> {
  const slugs = new Set<string>();
  if (limit <= 0) {
    logger.info(PRERENDER_LOG_EVENT, {
      message: `[posts-prerender] off (limit ${limit}); placeholder only`,
      count: 0,
      limit,
      pages: 0,
    });
    return [];
  }
  const perPage = Math.min(limit, PRERENDER_POST_PAGE_SIZE);
  let pages = 0;
  try {
    for (let page = 1; slugs.size < limit; page++) {
      const result = await sdk.posts.list({ page, perPage });
      pages++;
      const items = result.posts ?? [];
      for (const post of items) {
        if (slugs.size >= limit) break;
        const slug = post?.slug?.trim();
        if (slug && isPrerenderablePostSlug(slug)) slugs.add(slug);
      }
      if (items.length === 0) break;
      const totalPages = result.totalPages;
      if (!Number.isFinite(totalPages) || page >= totalPages) break;
    }
  } catch (error) {
    // `errorFields` decides whether the error's message is safe to emit (it
    // is only when no bounded `code`/`status` exists); fold that verdict into
    // this line's own message instead of letting the spread overwrite it.
    const { message: safeMessage, ...fields } = errorFields(error);
    logger.error(PRERENDER_LOG_EVENT, {
      ...fields,
      message: `[posts-prerender] list read failed on page ${pages + 1}; placeholder only${
        typeof safeMessage === "string" ? `: ${safeMessage}` : ""
      }`,
      count: 0,
      limit,
      pages,
    });
    return [];
  }
  logger.info(PRERENDER_LOG_EVENT, {
    message: `[posts-prerender] enumerated ${slugs.size} of up to ${limit} most recent posts from ${pages} page${pages === 1 ? "" : "s"}`,
    count: slugs.size,
    limit,
    pages,
  });
  return [...slugs];
}

/**
 * REQUIRED for the 404 gate below to be able to set a status at all, which is
 * why the placeholder param is emitted FIRST and unconditionally, before any
 * real post.
 *
 * Measured on a Next 16.3 production build with `cacheComponents: true`: a
 * dynamic segment with NO `generateStaticParams` is served from a fully
 * POSTPONED prerendered shell (`x-nextjs-prerender: 1`,
 * `x-nextjs-postponed: 1`), so the 200 is committed by the shell before the
 * page component runs and the hoisted `notFound()` can only add a `noindex`
 * meta. Adding this made `/news/{missing}` answer 404 with no other change —
 * the sibling routes that already 404ed all declared one. A `loading.tsx` or an in-page `<Suspense>` would commit 200 before
 * this gate. Neither wraps this route. `app/not-found-status.test.ts` asserts
 * `generateStaticParams`.
 *
 * Posts used to be left un-enumerated because a post's carousels and landing
 * were uncached, so a prerender bought nothing: every view paid the same
 * dynamic reads. Since PR #467 every read on this route is cached, which moved
 * the cost to the FIRST request per post after each deploy — 4.9 s then 0.9 s
 * on the Bike Society rehearsal store, 2026-09-09 — so the most recent posts
 * are now prerendered, capped by {@link PRERENDER_POST_LIMIT_DEFAULT} so the
 * build cost stays bounded. The placeholder stays first for the gate.
 *
 * Prerendering changes nothing about invalidation: the page still renders
 * through `getPost`, tagged `headkit:post:<slug>` + `headkit:posts`, so the
 * theme's purges reach a prerendered post exactly as they reach a cached one.
 */
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  const placeholder = { slug: [STATIC_GEN_PLACEHOLDER_SLUG] };
  const slugs = await collectRecentPostSlugs(prerenderPostLimit());
  return [placeholder, ...slugs.map((slug) => ({ slug: [slug] }))];
}

async function getPost(postSlug: string) {
  "use cache";
  cacheLife("days");
  cacheTag(`headkit:post:${postSlug}`, "headkit:posts");
  return sdk.content.get(postSlug, "POST");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const postSlug = slug[slug.length - 1];
  if (!postSlug || postSlug === STATIC_GEN_PLACEHOLDER_SLUG) return {};
  try {
    const [post, { seoSettings, storeSettings }, { iconUrl }, postsBase] =
      await Promise.all([
        getPost(postSlug),
        getBranding(),
        getBrandingAssets(),
        getPostsBasePath(),
      ]);
    if (!post) return {};
    const path = postsArticlePath(postsBase, postSlug);
    return await makeSeoMetadata(post.seo, {
      title: post.title,
      ...(post.excerpt ? { description: post.excerpt } : {}),
      storeName: storeSettings.name ?? undefined,
      dashboardOgImageUrl: seoSettings.ogImageUrl ?? undefined,
      brandingIconUrl: iconUrl ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      canonical: storefrontUrl(path, storeSettings.domain),
      siteUrl: storeSettings.domain,
    });
  } catch (error) {
    unstable_rethrow(error);
    // The content component lets the same failure throw, which renders
    // `app/error.tsx` at HTTP 200 — an indexable status. Returning `{}` here
    // let that body inherit the store's indexable default, where the late
    // `notFound()` it replaced got Next's own injected `noindex`. A post
    // that EXISTS must never be offered to crawlers as an error page.
    return { robots: { index: false, follow: false } };
  }
}

/**
 * Blocking route so `notFound()` can still set a real 404: under Cache
 * Components the response commits as 200 the moment a `<Suspense>` fallback
 * renders, and a `notFound()` raised inside the boundary only earns a `noindex`
 * meta tag. The existence check therefore runs in the default export, above
 * any boundary, forfeiting this route's App Shell. What that costs, what else
 * can commit the 200 first, and why `instant` is NOT one of those things live
 * once in "Setting a status code needs THREE conditions" in
 * `apps/starter/AGENTS.md`. `instant = false` is that section's declaration
 * rule: this route blocks on a cached read before it responds.
 *
 * There is no `<Suspense>` on this route at all any more, and that is the
 * point. Every read the article needs is a `"use cache"` entry (`getPost`,
 * branding, the Posts base path and landing, the carousels from the payload's
 * hydrated `editorBlocks`), so nothing here is request-time — MEASURED on a
 * Next 16.3 production build, 2026-09-10: with the boundary removed the build
 * succeeds and a prerendered post is entirely inline. Yet with a boundary
 * around the article the very same build put the whole article in a
 * `<div hidden id="S:3">` after the shell (locally 124 visible characters in
 * the shell, 286 hidden; on the Bike Society rehearsal store 772 / 3 287),
 * because React outlines any COMPLETED boundary larger than
 * `progressiveChunkSize` (12 800 bytes; `flushSegment` in react-dom's Fizz)
 * into a hidden segment plus an inline `$RC` swap — which never runs with
 * JavaScript off. A boundary belongs next to a request-time read, and this
 * route has none. "Cached content renders OUTSIDE the boundary" in
 * `apps/starter/AGENTS.md` owns the rule; `scripts/static-shell-split.ts`
 * measures a built file.
 */
/**
 * The article is cached CMS content, so it is the static shell. There is no
 * `loading.tsx` and no `<Suspense>` around it. `notFound()` in this export
 * answers 404.
 *
 * @see https://nextjs.org/docs/app/getting-started/caching
 */
export const instant = true;
export const ensureStatic = "navigation";

export default async function Page(props: Props): Promise<ReactNode> {
  // Pre-commit gate — an unknown post slug must answer 404. The post it reads
  // is the post the article renders from: one `"use cache"` read, handed down.
  const { slug } = await props.params;
  const postSlug = slug[slug.length - 1];
  if (!postSlug || postSlug === STATIC_GEN_PLACEHOLDER_SLUG) notFound();
  const post = await getPost(postSlug);
  if (!post) notFound();

  return <NewsArticleContent post={post} postSlug={postSlug} />;
}

type NewsArticleContentProps = {
  post: NonNullable<Awaited<ReturnType<typeof getPost>>>;
  postSlug: string;
};

async function NewsArticleContent({
  post,
  postSlug,
}: NewsArticleContentProps): Promise<ReactNode> {
  // Deliberately UNCAUGHT. A thrown read here is transport/infra: it renders
  // `app/error.tsx`, is loggable, and commits no wrong content as the page,
  // where a recovering catch would have to invent a body for a post the gate
  // above just proved exists. `generateMetadata`'s catch marks that render
  // `noindex` so the error body is never offered to a crawler.
  const [{ storeSettings }, postsBase, landing] = await Promise.all([
    getBranding(),
    getPostsBasePath(),
    // Cached (`hours`, `TAG.posts` + `TAG.pages`) — an uncached read here cost
    // ~0.5 s of origin time on EVERY post view for a payload the base-path
    // entry already held.
    getPostsLanding(),
  ]);

  const related = post.relatedPosts ?? [];
  const siteName = resolveStoreName(storeSettings.name);
  const indexPath = postsIndexPath(postsBase);
  const articlePath = postsArticlePath(postsBase, postSlug);
  const postsLabel = landing?.title?.trim() || "News";

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: postsLabel, href: indexPath },
    { name: post.title, href: articlePath },
  ];

  return (
    <>
      <ArticleJsonLD
        seo={post.seo}
        siteName={siteName}
        datePublished={post.date ?? undefined}
        dateModified={post.modified ?? undefined}
        image={post.featuredImage?.src}
        url={storefrontUrl(articlePath, storeSettings.domain)}
      />
      <BreadcrumbJsonLD items={breadcrumbs} />
      {related.length > 0 && <CarouselPostJsonLD posts={related} />}

      <div>
        <FeaturedImageHeader
          title={post.title}
          image={post.featuredImage?.src ?? null}
        />

        {/* HeadKit sections (callouts, carousels) hydrate via PostBody; leftover
              HTML keeps EditorialContent so .alignwide/.alignfull still work.
              `editorBlocks` carries the products the theme already resolved
              for each product carousel — the same raw-block cast `app/page.tsx`
              uses. Without it every carousel product was re-read per request. */}
        <PostBody
          html={post.content ?? ""}
          editorBlocks={(post.editorBlocks ?? []) as RawEditorBlock[]}
        />

        {related.length > 0 && (
          <div className="overflow-hidden py-[30px] lg:pt-[60px] lg:pb-[30px]">
            <SectionHeader
              title={`Latest ${postsLabel}`}
              description="Get the latest news and updates from our blog."
              allButton="View All"
              allButtonPath={indexPath}
              className="px-5 md:px-10"
            />
            <div className="mt-5">
              <PostCarousel posts={related} postsBasePath={postsBase} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

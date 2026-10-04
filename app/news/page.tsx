import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { headkit as sdk } from "@/lib/sdk";
import { PostHeader } from "@/components/headkit-ui/post/post-header";
import { PostPage } from "@/components/headkit-ui/post/post-page";
import { EditorialGridSkeleton } from "@/components/headkit-ui/skeletons/editorial-grid-skeleton";
import { CarouselPostJsonLD } from "@/components/seo/carousel-post-json-ld";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { TAG } from "@/lib/cache-tags";
import { errorFields, logger } from "@/lib/logger";
import { postsIndexHeading } from "@/lib/posts-index-copy";
import { getPostsBasePath, postsIndexPath } from "@/lib/posts-base-path";
import { getStoreTheme } from "@/lib/store-theme";

const FALLBACK_TITLE = "News";
const FALLBACK_DESCRIPTION =
  "Stay up to date with our latest news and articles.";
const PER_PAGE = 24;

async function getNewsLanding() {
  "use cache";
  cacheLifeForProfile("hours", "max");
  // Title and body come from the CMS landing: WooCommerce Settings → Reading
  // posts page, or the Shopify Online Store page whose handle matches the
  // blog's posts base. The global fallback stays "News".
  cacheTag(TAG.page("news"), TAG.posts, TAG.pages);
  return sdk.posts.getLanding().catch(() => null);
}

function canonicalForPostsBase(
  base: string,
  storeDomain?: string | null,
): string {
  return storefrontUrl(postsIndexPath(base), storeDomain);
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const [page, { seoSettings, storeSettings }, postsBase] = await Promise.all(
      [getNewsLanding(), getBranding(), getPostsBasePath()],
    );
    const heading = postsIndexHeading(page, getStoreTheme().copy?.postsIndex);
    return await makeSeoMetadata(page?.seo ?? null, {
      title: heading.title,
      description: heading.description,
      storeName: storeSettings.name ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      canonical: canonicalForPostsBase(postsBase, storeSettings.domain),
      siteUrl: storeSettings.domain,
    });
  } catch (error) {
    unstable_rethrow(error);
    return await makeSeoMetadata(null, {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      canonical: canonicalForPostsBase("news"),
    });
  }
}

interface Props {
  searchParams: Promise<Record<string, string>>;
}

async function getPostFilters(): Promise<
  Awaited<ReturnType<typeof sdk.posts.getFilters>>
> {
  "use cache";
  cacheLifeForProfile("days", "max");
  cacheTag(TAG.posts);
  try {
    return await sdk.posts.getFilters();
  } catch (error) {
    // Same prerender rule as `loadContactPage`: the catch has to be inside
    // the cache fill. An outer `.catch()` still leaves the thrown fill in
    // Next's prerender error map and fails `next build`.
    unstable_rethrow(error);
    logger.error("posts.degraded_render", {
      read: "filters",
      recovery: `revalidateTag(${TAG.posts})`,
      ...errorFields(error),
    });
    return { categories: [] };
  }
}

const EMPTY_POSTS_PAGE = {
  posts: [],
  page: 1,
  perPage: PER_PAGE,
  total: 0,
  totalPages: 0,
};

/**
 * Durable post list read — keyed on category + page. Public content, safe for
 * remote cache (mirrors collection `getCatalogPage`).
 *
 * A transport failure resolves an empty page instead of throwing. This route
 * is prerendered (`instant = true`); a throw inside `"use cache: remote"` is
 * recorded before `PostsServer` can catch it and fails the export.
 */
async function getPostsPage(
  category: string,
  page: number,
): Promise<Awaited<ReturnType<typeof sdk.posts.list>>> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  cacheTag(TAG.posts, category ? `posts:cat:${category}` : "posts:all");
  try {
    return await sdk.posts.list({
      page,
      perPage: PER_PAGE,
      ...(category ? { category } : {}),
    });
  } catch (error) {
    unstable_rethrow(error);
    logger.error("posts.degraded_render", {
      read: "list",
      page,
      ...(category ? { category } : {}),
      recovery: `revalidateTag(${TAG.posts})`,
      ...errorFields(error),
    });
    return { ...EMPTY_POSTS_PAGE, page };
  }
}

async function PostsServer({
  searchParams,
  postsBasePath,
}: {
  searchParams: Promise<Record<string, string>>;
  postsBasePath: string;
}) {
  const sp = await searchParams;
  const activeCategory = sp.category ?? "";
  const page = sp.page ? parseInt(sp.page, 10) || 1 : 1;

  const [postsResult, postFilters] = await Promise.all([
    getPostsPage(activeCategory, page),
    getPostFilters(),
  ]);

  return (
    <>
      {postsResult.posts.length > 0 && (
        <CarouselPostJsonLD posts={postsResult.posts} />
      )}
      <PostPage
        initialPosts={postsResult.posts}
        postFilters={postFilters}
        activeCategory={activeCategory}
        postsBasePath={postsBasePath}
      />
    </>
  );
}

/**
 * The landing is cached CMS content, so the header is the static shell.
 * The list awaits `searchParams` and the page applies that filter on the
 * server, so that read stays inside one `<Suspense>`.
 *
 * @see https://nextjs.org/docs/app/getting-started/caching
 */
export const instant = true;

export default async function Page({ searchParams }: Props) {
  const [page, postsBase] = await Promise.all([
    getNewsLanding(),
    getPostsBasePath(),
  ]);
  const heading = postsIndexHeading(page, getStoreTheme().copy?.postsIndex);
  const indexPath = postsIndexPath(postsBase);

  return (
    <>
      <PostHeader
        name={heading.title}
        {...(heading.content
          ? { content: heading.content }
          : { description: heading.description })}
        breadcrumbs={[
          { name: "Home", uri: "/", current: false },
          { name: heading.title, uri: indexPath, current: true },
        ]}
      />
      <Suspense fallback={<EditorialGridSkeleton aspect="portrait" />}>
        <PostsServer searchParams={searchParams} postsBasePath={postsBase} />
      </Suspense>
    </>
  );
}

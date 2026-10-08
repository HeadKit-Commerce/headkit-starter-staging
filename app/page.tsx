import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import { headkit } from "@/lib/sdk";
import type {
  Product,
  HeroCarouselItem,
  FeaturedCategory,
  Post,
} from "@headkit/sdk";
import {
  processHomepageContent,
  firstProductCarouselSegmentIndex,
  getBlockQueryType,
  hasEditorSectionClass,
} from "@/lib/process-editor-blocks";
import {
  makeRootMetadata,
  resolveHomeTitle,
  resolveHomeDescription,
  resolveStoreName,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import {
  filterCategoriesByNonEmptySlugs,
  getNonEmptyCollectionSlugs,
} from "@/lib/hide-empty-collections";
import { collectionPathResolver } from "@/lib/collection-path";
import { MainCarousel } from "@/components/headkit-ui/main-carousel";
import { getStoreTheme } from "@/lib/store-theme";
import { collectionCardLinkText, resolveSectionCopy } from "@/lib/section-copy";
import {
  collectionSlugsForSurface,
  pickCollectionsBySlugs,
} from "@/lib/collection-surfaces";
import {
  HOMEPAGE_PENDING_HERO_CACHE_LIFE,
  homepageHeroMediaPending,
} from "@/lib/homepage-hero-media";
import { shouldShowHomepageFeaturedProducts } from "@/lib/homepage-featured";
import { BlockEditor } from "@/components/headkit-ui/block-editor";
import { EditorialContent } from "@/components/headkit-ui/editorial-content";
import {
  CAROUSEL_FIRST_ROW,
  ProductCarousel,
} from "@/components/headkit-ui/product-carousel";
import { CategoryCarousel } from "@/components/headkit-ui/category-carousel";
import { PostCarousel } from "@/components/headkit-ui/post/post-carousel";
import { SectionHeader } from "@/components/headkit-ui/section-header";
import { getPostsBasePath } from "@/lib/posts-base-path";
import { postsIndexPath } from "@/lib/posts-path";
import {
  extendHomepageCategories,
  HomeAfterFeatured,
} from "@/overrides/home-slots";

const EMPTY_COLLECTION = {
  products: [] as Product[],
  total: 0,
  page: 1,
  perPage: 8,
  totalPages: 0,
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const [{ homepage }, { seoSettings, storeSettings }, { iconUrl }] =
      await Promise.all([
        getHomepageData(),
        getBranding(),
        getBrandingAssets(),
      ]);
    const siteName = resolveStoreName(storeSettings.name);
    const yoastSeo = homepage?.page?.seo;
    const entityOg =
      (yoastSeo as { opengraphImageUrl?: string | null } | null | undefined)
        ?.opengraphImageUrl ?? null;

    return await makeRootMetadata({
      title: resolveHomeTitle({
        yoastTitle: yoastSeo?.title,
        dashboardTitle: seoSettings.title,
        storeName: storeSettings.name,
      }),
      description: resolveHomeDescription({
        yoastDescription: yoastSeo?.metaDesc,
        dashboardDescription: seoSettings.description,
      }),
      siteName,
      iconUrl,
      ogImageUrl: entityOg || seoSettings.ogImageUrl,
      allowIndexing: seoSettings.allowIndexing,
      siteUrl: storeSettings.domain,
      // Self-referencing canonical for `/`. The highest-authority URL on the
      // site had none, leaving it undefended against `?utm_*` / `?gclid` and
      // trailing-slash duplicates.
      canonical: storefrontUrl("/", storeSettings.domain),
    });
  } catch (error) {
    unstable_rethrow(error);
    // Same fail-closed rule as the root layout: an unreadable branding read
    // leaves the store's indexing switch unknown, and app/robots.ts answers
    // that failure with `Disallow: /`.
    return await makeRootMetadata({ siteName: "Store", allowIndexing: false });
  }
}

/**
 * Home cache-tag(s) (D7 / CACHE-04). Home is ONE monolithic cached entry backed
 * by a single aggregate `homepage.get()`. Primary tag: `route:home` (carousel,
 * news, featured/new/sale product, page-on-front). Also tags branding +
 * collections because HomeContent reads hide-empty branding and may filter
 * featured categories from the catalog. Also tags `posts`: Latest News is
 * inside this same entry, and a Shopify article webhook purges `headkit:posts`
 * (a WordPress post save purges `route:home` directly). Either signal expires
 * the whole homepage, which is the only way the rail can refresh.
 *
 * The former per-module `module:{carousel,news,brand,featured}` tags were
 * removed: with an indivisible `homepage.get()` bundle they could never
 * invalidate a section independently (they only ever purged the whole entry via
 * this union), so they were pure noise. True per-section revalidation needs the
 * data split first (per-module SDK methods + subgraph resolvers + WP endpoints).
 */
const HOME_TAGS: readonly string[] = [
  TAG.route("home"),
  TAG.branding,
  TAG.collections,
  TAG.posts,
];

export async function getHomepageData() {
  "use cache";
  cacheLifeForProfile("days", "max");
  cacheTag(...HOME_TAGS);

  // Split fetches so a homepage.get() failure does not null On Sale
  // collections (P2 resilience).
  const [homepageResult, onSaleResult] = await Promise.allSettled([
    headkit.homepage.get(),
    headkit.collections.list({ onSale: true }, 1, 8),
  ]);

  const homepage =
    homepageResult.status === "fulfilled" ? homepageResult.value : null;

  // Shopify file_reference URLs resolve asynchronously and there is no
  // files/update webhook. A copy-only hero fetched during that window
  // must not pin under `days` or the blank media box stays until the
  // next catalog edit or deploy.
  if (homepageHeroMediaPending(homepage)) {
    cacheLife(HOMEPAGE_PENDING_HERO_CACHE_LIFE);
  }

  return {
    homepage,
    onSaleProducts:
      onSaleResult.status === "fulfilled"
        ? onSaleResult.value
        : EMPTY_COLLECTION,
  };
}

export async function HomeContent() {
  "use cache";
  cacheLifeForProfile("days", "max");
  cacheTag(...HOME_TAGS);

  const { homepage, onSaleProducts } = await getHomepageData();
  // HomeContent is its own `'use cache'` entry wrapping the rendered
  // carousel. Shorten this life too — an inner `minutes` data entry
  // cannot evict an outer `days` prerender of the empty media box.
  if (homepageHeroMediaPending(homepage)) {
    cacheLife(HOMEPAGE_PENDING_HERO_CACHE_LIFE);
  }
  const { branding } = await getBranding();
  const theme = getStoreTheme();
  const featuredCopy = resolveSectionCopy(theme.copy, "homepageFeatured", {
    title: "Featured Products",
    allButton: "View All",
    allButtonPath: "/featured",
  });
  const homepageCardLink = collectionCardLinkText(theme.copy);
  const nonEmptySlugs = branding.hideEmptyCollections
    ? await getNonEmptyCollectionSlugs()
    : null;

  const carousels = (homepage?.carousels ??
    []) as unknown as HeroCarouselItem[];
  const featuredCategoriesRaw = (homepage?.featuredCategories ??
    []) as unknown as FeaturedCategory[];
  const featuredCategoriesFiltered = pickCollectionsBySlugs(
    nonEmptySlugs
      ? filterCategoriesByNonEmptySlugs(featuredCategoriesRaw, nonEmptySlugs)
      : featuredCategoriesRaw,
    collectionSlugsForSurface(theme.catalog, "homepage"),
  );
  // `FeaturedCategory` carries a slug and the raw WordPress permalink, neither
  // of which is a storefront path — resolve each tile's CANONICAL collection
  // path from the category tree so a nested category's tile does not link the
  // flat shape the collection route 308s away from.
  const collectionPath = await collectionPathResolver();
  const featuredCategories = extendHomepageCategories(
    featuredCategoriesFiltered.map((category) => ({
      ...category,
      uri: collectionPath(category.slug),
    })),
  );
  const { blocks: editorBlocks, segments } = processHomepageContent(
    homepage?.page?.content ?? "",
    (homepage?.page?.editorBlocks ?? []) as Array<{
      products?: unknown[];
      attrs?: Record<string, unknown> | null;
      queryType?: string | null;
    }>,
  );

  // Prefer WP queryType carousels over hardcoded On Sale when the front page
  // already includes that HeadKit pattern (avoids duplicates).
  const wpQueryTypes = new Set(
    editorBlocks
      .map((b) => getBlockQueryType(b))
      .filter((qt): qt is string => qt !== null),
  );
  const showHardcodedSale =
    !wpQueryTypes.has("on-sale") &&
    onSaleProducts !== null &&
    onSaleProducts.products.length > 0;

  // Skip hardcoded Shop by Category when WP already provides the pattern.
  // Brands are CMS-only (headkit-brand-carousel) — never append a fallback
  // "Our Brands" strip after editor content (duplicates Clients / wrong order).
  const showHardcodedCategories =
    !hasEditorSectionClass(editorBlocks, "headkit-category-carousel") &&
    featuredCategories.length > 0;
  // Prefer WP hero pattern placement over the hardcoded top carousel.
  const showHardcodedHero =
    !hasEditorSectionClass(editorBlocks, "headkit-hero-carousel") &&
    carousels.length > 0;
  const featuredProducts = (homepage?.featuredProducts ?? []) as Product[];
  const showHardcodedFeatured = shouldShowHomepageFeaturedProducts({
    featuredProducts,
    editorBlocks,
  });
  const latestPosts = (homepage?.latestPosts ?? []) as Post[];
  const showLatestPosts =
    !hasEditorSectionClass(editorBlocks, "headkit-post-carousel") &&
    latestPosts.length > 0;
  const postsBasePath = showLatestPosts ? await getPostsBasePath() : null;
  const latestNewsCopy = resolveSectionCopy(theme.copy, "homepageLatestNews", {
    title: "Latest News",
    eyebrow: "Stories, tips, and updates from our team.",
    allButton: "View All",
    allButtonPath: postsBasePath ? postsIndexPath(postsBasePath) : "/journal",
  });

  const heroLayout = theme.layout.heroLayout;

  // Exactly ONE product carousel on this page keeps a warm first row, and only
  // when the store runs the prefetch budget (`NEXT_PUBLIC_NAV_PREFETCH_BUDGET`;
  // with it off, `InstantLink` prefetches every link as it does today and this
  // choice costs nothing). The WP front page's first `headkit-product-carousel`
  // wins when it has one, because editor segments render above the platform's own
  // carousels; when it has none, the first hard-coded carousel a shopper sees takes
  // it — Featured when that is shown, otherwise On Sale.
  const warmCarouselSegment = firstProductCarouselSegmentIndex(segments);
  const warmPlatformFeaturedCarousel =
    warmCarouselSegment === -1 && showHardcodedFeatured;
  const warmPlatformSaleCarousel =
    warmCarouselSegment === -1 && !showHardcodedFeatured;

  return (
    <>
      {showHardcodedHero && (
        <MainCarousel carouselItems={carousels} heroLayout={heroLayout} />
      )}

      {/* WP front-page content in editor document order.
          Cached with HomeContent, so it is the static shell — not a Suspense hole.
          https://nextjs.org/docs/app/getting-started/caching#static-cached-and-streaming */}
      {segments.map((seg, index) => {
        if (seg.kind === "html") {
          return (
            <section
              key={`wp-html-${index}`}
              className="headkit-cms-html hk-section-content px-5 md:px-10 py-10"
            >
              <EditorialContent html={seg.html} />
            </section>
          );
        }
        return (
          <BlockEditor
            key={`wp-block-${index}`}
            blocks={[seg.block]}
            prefetchFirstProductCarouselRow={index === warmCarouselSegment}
          />
        );
      })}

      {/* Platform commerce modules (not WP page blocks) */}

      {/* Featured Products — skipped when WP already provides a product carousel */}
      {showHardcodedFeatured && (
        <section className="headkit-product-carousel overflow-x-clip py-10">
          <SectionHeader
            title={featuredCopy.title}
            description={featuredCopy.description}
            allButton={featuredCopy.allButton}
            allButtonPath={featuredCopy.allButtonPath}
            className="px-5 md:px-10"
          />
          <div className="mt-8">
            <ProductCarousel
              products={featuredProducts.slice(0, 12)}
              id="featured-products"
              prefetchCount={
                warmPlatformFeaturedCarousel ? CAROUSEL_FIRST_ROW : 0
              }
            />
          </div>
        </section>
      )}

      <HomeAfterFeatured />

      {/* On Sale — skipped when WP already provides a product-on-sale carousel */}
      {showHardcodedSale && (
        <section className="headkit-product-carousel overflow-x-clip py-10">
          <SectionHeader
            title="On Sale"
            description=""
            allButton="View All"
            allButtonPath="/sale"
            className="px-5 md:px-10"
          />
          <div className="mt-8">
            <ProductCarousel
              products={onSaleProducts.products.slice(0, 12) as Product[]}
              id="on-sale-products"
              prefetchCount={warmPlatformSaleCarousel ? CAROUSEL_FIRST_ROW : 0}
            />
          </div>
        </section>
      )}

      {/* Shop by Category — skipped when WP provides headkit-category-carousel */}
      {showHardcodedCategories && (
        <section className="headkit-category-carousel overflow-hidden py-10">
          <SectionHeader
            title="Shop by Category"
            description=""
            allButton="View All"
            allButtonPath="/shop"
            className="px-5 md:px-10"
          />
          <div className="mt-8">
            <CategoryCarousel
              categories={featuredCategories}
              {...(homepageCardLink ? { cardLinkText: homepageCardLink } : {})}
            />
          </div>
        </section>
      )}

      {showLatestPosts && postsBasePath ? (
        <section className="headkit-post-carousel overflow-hidden py-10">
          <SectionHeader
            title={latestNewsCopy.title}
            description={latestNewsCopy.description}
            allButton={latestNewsCopy.allButton}
            allButtonPath={latestNewsCopy.allButtonPath}
            className="px-5 md:px-10"
          />
          <div className="mt-8">
            <PostCarousel posts={latestPosts} postsBasePath={postsBasePath} />
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * Instant Navigation (Next.js 16.3) — sync App Shell + Suspense streaming.
 * @see https://nextjs.org/docs/app/guides/instant-navigation
 */
export const instant = true;

export default function Home() {
  // HomeContent is fully cached ('use cache') — rendering it without a
  // Suspense boundary bakes it into the prerendered shell in document order,
  // so the homepage is visible without JavaScript.
  return (
    <div className="headkit-home overflow-hidden">
      <HomeContent />
    </div>
  );
}

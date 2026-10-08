import { unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { headkit as sdk } from "@/lib/sdk";
import { TAG } from "@/lib/cache-tags";
import { getCatalogFilters } from "@/lib/catalog-filters";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import { CollectionHeader } from "@/components/headkit-ui/collection/collection-header";
import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import {
  buildProductListFilter,
  DEFAULT_FILTER_VALUES,
  type SortKeyType,
} from "@/components/headkit-ui/collection/utils";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import type { ProductCategoryDetail } from "@headkit/sdk";
import {
  filterCategoriesByNonEmptySlugs,
  getNonEmptyCollectionSlugs,
} from "@/lib/hide-empty-collections";
import { getStoreTheme } from "@/lib/store-theme";
import {
  collectionSlugsForSurface,
  pickCollectionsBySlugs,
} from "@/lib/collection-surfaces";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { seoSettings, storeSettings } = await getBranding();
    return await makeSeoMetadata(null, {
      title: "Shop",
      description: "Browse our full product catalog.",
      storeName: storeSettings.name ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      canonical: storefrontUrl("/shop", storeSettings.domain),
      siteUrl: storeSettings.domain,
    });
  } catch (error) {
    unstable_rethrow(error);
    return await makeSeoMetadata(null, {
      title: "Shop",
      canonical: storefrontUrl("/shop"),
    });
  }
}

const PER_PAGE = CATALOG_PAGE_SIZE;

/**
 * Root product categories for the Shop header carousel (same SubcategoryCarousel
 * as parent collection pages). Cached so Instant Navigation / runtime prefetch
 * can resolve it with the shared App Shell.
 */
/** WooCommerce default category — never show as a Shop carousel tile. */
function isUncategorizedCategory(cat: ProductCategoryDetail): boolean {
  const slug = cat.slug.trim().toLowerCase();
  return slug === "uncategorized" || slug === "uncategorised";
}

async function getRootCategories(): Promise<ProductCategoryDetail[]> {
  "use cache";
  // Spelled out field by field rather than named, in BOTH profiles, because
  // `cacheLife("max")` carries `stale: 5min` and would SHORTEN this entry's
  // 14-day `stale` — the opposite of what the aggressive profile is for. So
  // the aggressive side raises only `revalidate` and `expire` to `max`'s
  // values (30d / 365d) and keeps the longer `stale`.
  cacheLifeForProfile(
    {
      stale: 60 * 60 * 24 * 14,
      revalidate: 60 * 60,
      expire: 60 * 60 * 24 * 14,
    },
    {
      stale: 60 * 60 * 24 * 14,
      revalidate: 60 * 60 * 24 * 30,
      expire: 60 * 60 * 24 * 365,
    },
  );
  cacheTag(TAG.collections, TAG.branding);
  const [categories, { branding }] = await Promise.all([
    sdk.collections.getCategories(),
    getBranding(),
  ]);
  let roots = categories.filter((cat) => !isUncategorizedCategory(cat));
  if (branding.hideEmptyCollections) {
    // getCategories already hides empty by default; keep an explicit filter so
    // hand-rolled parentSlug lists stay consistent with the branding toggle.
    // null = catalog listing failed → fail open (do not blank the shop roots).
    const nonEmptySlugs = await getNonEmptyCollectionSlugs();
    if (nonEmptySlugs) {
      roots = filterCategoriesByNonEmptySlugs(roots, nonEmptySlugs);
    }
  }
  return pickCollectionsBySlugs(
    roots,
    collectionSlugsForSurface(getStoreTheme().catalog, "shop"),
  );
}

/**
 * The ONE breadcrumb trail for `/shop`: the visible crumb and the
 * `BreadcrumbList` are rendered from this array, so the two cannot drift — the
 * rule `/collections/[...slug]` already follows.
 */
const SHOP_BREADCRUMBS = [
  { name: "Home", uri: "/", current: false },
  { name: "Shop", uri: "/shop", current: true },
] as const;

/**
 * Shop header with top-level category carousel. `'use cache'` via
 * getRootCategories — safe outside Suspense under Cache Components.
 */
async function ShopHeader() {
  const rootCategories = await getRootCategories();
  // `childBasePath` is stated rather than defaulted: these children are ROOT
  // categories, whose canonical path IS the flat `/collections/{slug}`, so
  // `/collections` is the correct base here. The prop is required precisely so
  // that a caller rendering NESTED children cannot omit it and silently emit
  // the shape the collection route 308s away from.
  return (
    <CollectionHeader
      name="Shop"
      breadcrumbs={[...SHOP_BREADCRUMBS]}
      childBasePath="/collections"
      {...(rootCategories.length > 0 ? { children: rootCategories } : {})}
    />
  );
}

/**
 * Instant Navigation (Next.js 16.3): sync default export. Both the cached Shop
 * header (incl. root category carousel) and the grid commit with the App Shell
 * — this route reads no `searchParams` and has no Suspense boundary.
 */
export const instant = true;
export const ensureStatic = "navigation";

export default function Page() {
  return (
    <>
      {/*
        BreadcrumbList for /shop, built from the SAME array the visible
        breadcrumb renders, so the two cannot drift. This route has no
        <Suspense> at all, so it is in the prerendered shell and a crawler that
        runs no JavaScript sees it.
      */}
      <BreadcrumbJsonLD
        items={SHOP_BREADCRUMBS.map((crumb) => ({
          name: crumb.name,
          href: crumb.uri,
        }))}
      />
      <ShopHeader />
      <ShopProductsShell />
    </>
  );
}

/**
 * Page 1 of the catalog in the store's default order, rendered in the static
 * shell — no `<Suspense>` above it, so a JS-off shopper and a non-rendering
 * crawler see the cards.
 *
 * Both reads are `"use cache"` and nothing here awaits `searchParams`; the full
 * contract, including why a boundary cannot hold even one product card, is
 * stated once on `CollectionProductsShell`
 * (`app/collections/[...slug]/page.tsx`). `?page=`/`?sort=`/`?price_*`/
 * `?instock=`/`?categories=` are applied in the browser by
 * `CollectionProvider`'s mount effect.
 */
async function ShopProductsShell() {
  const { branding } = await getBranding();
  const filter = buildProductListFilter(
    { ...DEFAULT_FILTER_VALUES, page: 1 },
    { defaultSort: branding.defaultCollectionSort as SortKeyType },
  );
  const [productsResult, productFilter] = await Promise.all([
    getCachedCatalogPage(filter, 1, PER_PAGE, { kind: "shop" }),
    getCatalogFilters(),
  ]);
  return (
    <CollectionPage
      initialProducts={productsResult.products}
      initialTotal={productsResult.total}
      productFilter={productFilter}
      initialPage={1}
      itemsPerPage={PER_PAGE}
    />
  );
}

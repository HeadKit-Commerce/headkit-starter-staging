import type { Metadata } from "next";
import { getCatalogFilters } from "@/lib/catalog-filters";
import { CollectionHeader } from "@/components/headkit-ui/collection/collection-header";
import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import {
  buildProductListFilter,
  DEFAULT_FILTER_VALUES,
  type SortKeyType,
} from "@/components/headkit-ui/collection/utils";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import { getBranding } from "@/lib/branding";
import { storefrontUrl } from "@/lib/make-metadata";

/**
 * Canonical origin comes from the RUNTIME store domain, not the build-time
 * `NEXT_PUBLIC_FRONTEND_URL` — a custom domain attached without a redeploy
 * leaves that env naming the old `*.headkit.app` host, which would put a
 * cross-host canonical on a route `app/sitemap.ts` advertises under the
 * customer's apex (it emits every `<loc>` from `resolveSiteUrl(store.domain)`).
 *
 * `getBranding()` is `"use cache: remote"`, so reading it here costs this route
 * no static rendering: the metadata read stays cacheable exactly as the sibling
 * `app/shop/page.tsx` already does.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { storeSettings } = await getBranding();
    return {
      title: "Sale",
      alternates: {
        canonical: storefrontUrl("/sale", storeSettings.domain),
      },
    };
  } catch {
    return {
      title: "Sale",
      alternates: { canonical: storefrontUrl("/sale") },
    };
  }
}

const PER_PAGE = CATALOG_PAGE_SIZE;

/**
 * Page 1 of the cached catalogue, in the shell. This route does not await
 * `searchParams`. Query-string filters are applied in the browser by
 * `CollectionProvider`.
 *
 * @see https://nextjs.org/docs/app/getting-started/caching
 */
export const instant = true;

export default function Page() {
  return (
    <>
      <CollectionHeader
        name="Sale"
        description="Shop our sale items with great discounts!"
        breadcrumbs={[
          { name: "Home", uri: "/", current: false },
          { name: "Sale", uri: "/sale", current: true },
        ]}
        childBasePath="/collections"
      />
      <LandingProductsShell />
    </>
  );
}

async function LandingProductsShell() {
  const { branding } = await getBranding();
  const filter = buildProductListFilter(
    { ...DEFAULT_FILTER_VALUES, page: 1 },
    {
      onSale: true,
      defaultSort: branding.defaultCollectionSort as SortKeyType,
    },
  );

  const [productsResult, productFilter] = await Promise.all([
    getCachedCatalogPage(filter, 1, PER_PAGE, {
      kind: "route",
      route: "sale",
    }),
    getCatalogFilters(),
  ]);

  return (
    <CollectionPage
      initialProducts={productsResult.products}
      initialTotal={productsResult.total}
      productFilter={productFilter}
      initialPage={1}
      itemsPerPage={PER_PAGE}
      onSale
    />
  );
}

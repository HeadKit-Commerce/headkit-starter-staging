import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { headkit as sdk } from "@/lib/sdk";
import { TAG } from "@/lib/cache-tags";
import { getCatalogFilters } from "@/lib/catalog-filters";
import { collectAllBrands } from "@/lib/brand-list";
import { BrandHeader } from "@/components/headkit-ui/brand/brand-header";
import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import {
  buildProductListFilter,
  DEFAULT_FILTER_VALUES,
} from "@/components/headkit-ui/collection/utils";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import type { SortKeyType } from "@/components/headkit-ui/collection/utils";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";

/**
 * Satisfies Cache Components: `generateStaticParams` must not return [].
 * @see https://nextjs.org/docs/messages/blocking-route#generatestaticparams
 */
const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

interface Props {
  params: Promise<{ slug: string[] }>;
}

const PER_PAGE = CATALOG_PAGE_SIZE;

/**
 * Params-only brand shell (header). Durable `"use cache: remote"` so Cache
 * Components can prerender it into the HTML shell AND so the read survives
 * across serverless instances. Mirrors collections `getCategoryData`.
 *
 * Keeps a finite `cacheLife("days")` and a plain literal, never
 * `cacheLifeForProfile`: this read feeds the route's 404 gate, so pinning it
 * at `max` would pin a wrong status code until the next deploy
 * (`lib/cache-profile-call-sites.test.ts`).
 */
async function getBrandShell(brandSlug: string) {
  "use cache: remote";
  cacheLife("days");
  cacheTag(TAG.brand(brandSlug), TAG.brands);
  return { brand: await sdk.brands.get(brandSlug) };
}

/**
 * Page 1 of the brand, in the store's default order, rendered in the static
 * shell — no `<Suspense>` above it anywhere on this route, so a JS-off shopper
 * and a non-rendering crawler see the cards.
 *
 * Both reads are cached and nothing here awaits `searchParams`; awaiting it
 * opts the whole segment dynamic and leaves a 0-byte shell for every request.
 * The full contract is stated once on `CollectionProductsShell`
 * (`app/collections/[...slug]/page.tsx`); this is the brand-scoped twin of
 * `ShopProductsShell` (`app/shop/page.tsx`). `?page=` / `?sort=` /
 * `?instock=` / `?categories=` are applied in the browser by
 * `CollectionProvider`'s mount effect — none of them is canonical or in the
 * sitemap.
 */
async function BrandProductsShell({
  brandSlug,
}: {
  brandSlug: string;
}): Promise<ReactNode> {
  const { branding } = await getBranding();

  const filter = buildProductListFilter(
    {
      ...DEFAULT_FILTER_VALUES,
      brands: [brandSlug],
      page: 1,
    },
    {
      brandSlug,
      defaultSort: branding.defaultCollectionSort as SortKeyType,
    },
  );

  const [productFilter, productsResult] = await Promise.all([
    getCatalogFilters(),
    getCachedCatalogPage(filter, 1, PER_PAGE, {
      kind: "brand",
      slug: brandSlug,
    }),
  ]);

  return (
    <CollectionPage
      initialProducts={productsResult.products}
      initialTotal={productsResult.total}
      productFilter={productFilter}
      initialPage={1}
      itemsPerPage={PER_PAGE}
      brandSlug={brandSlug}
    />
  );
}

/**
 * Prerender known brand PLPs so awaiting `params` in the default export is
 * valid under Cache Components (blocking-route docs: generateStaticParams).
 *
 * PAGINATE, NEVER CAP — and this function capped until 2026-09-16.
 *
 * `perPage` maxes out at 100 because WordPress REST argument validation REJECTS
 * a larger ask (`'maximum' => 100` in `inc/rest-api/headkit-*.php`), and reading
 * ONE page was the wrong conclusion to draw from that: a store with more than
 * 100 brands silently lost every brand past the first page. The Bike Society
 * rehearsal store had 110, so 10 brand PLPs were advertised by `app/sitemap.ts`
 * — which walks the same endpoint to completion via `collectListPages` — and
 * never built. Measured there, 2026-09-16: `/brand/zipp` answered
 * `x-vercel-cache: MISS` at 4.25s while `/brand/abus` answered `PRERENDER` at
 * 1.15s. Identical defect, identical endpoint, fixed in one emitter and not the
 * other; `app/product-url-emitter-parity.test.ts` now fails if they diverge again.
 *
 * The loop itself now lives in `lib/brand-list.ts`, which `app/brand/page.tsx`
 * reads too — the brand INDEX was a THIRD reader of this endpoint and had the
 * same defect in its most basic form (no page argument at all, so 24 of 110
 * brands). That file owns the terminator rules and the page bound; keep them
 * there rather than re-deriving either here.
 *
 * A failure mid-walk keeps what was already collected rather than discarding it:
 * prerendering 100 brands beats falling back to the placeholder and prerendering
 * none.
 */
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  const { brands } = await collectAllBrands();
  const slugs = brands
    .map((brand) => brand?.slug)
    .filter((slug): slug is string => Boolean(slug));

  if (slugs.length > 0) return slugs.map((slug) => ({ slug: [slug] }));
  return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return {};
  const brandSlug = slug[slug.length - 1];
  if (!brandSlug) return {};
  try {
    const [{ brand }, { seoSettings, storeSettings }] = await Promise.all([
      getBrandShell(brandSlug),
      getBranding(),
    ]);
    if (!brand) return {};
    return await makeSeoMetadata(brand.seo, {
      title: brand.name,
      description: brand.description,
      canonical: storefrontUrl(`/brand/${brandSlug}`, storeSettings.domain),
      siteUrl: storeSettings.domain,
      allowIndexing: seoSettings.allowIndexing,
    });
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

/**
 * Brand page. The header and the page-1 grid are cached, so they are the
 * static shell. `notFound()` in this export answers 404. There is no
 * `loading.tsx`.
 *
 * @see https://nextjs.org/docs/app/getting-started/caching
 */
export const instant = true;

export default function Page(props: Props) {
  return <BrandPageContent {...props} />;
}

export async function BrandPageContent({ params }: Props) {
  // Existence check, above every boundary. There is no `loading.tsx`, so
  // `notFound()` here sets 404. `BrandRoute`
  // repeats the checks and the `"use cache"` shell read dedupes. A THROWN
  // read still propagates: only a null brand is a genuine miss.
  //
  // The build-time placeholder is a 404 HERE rather than a skipped gate: it is
  // never served from a prerender, so a runtime request for it is a junk URL
  // and must 404 before anything commits a 200.
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) notFound();
  const brandSlug = slug[slug.length - 1];
  if (!brandSlug) notFound();
  const { brand } = await getBrandShell(brandSlug);
  if (!brand) notFound();

  return <BrandRoute params={params} />;
}

async function BrandRoute({ params }: Props) {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return notFound();
  const brandSlug = slug[slug.length - 1];
  if (!brandSlug) return notFound();

  // Do NOT catch→notFound on thrown errors: transport/infra failures must not
  // bake sticky 404s into the route cache. Genuine misses use the null check.
  const { brand } = await getBrandShell(brandSlug);
  if (!brand) return notFound();

  // Thumbnail only — no WP image fallback hunt when thumb is null.
  const thumbnailUrl = brand.thumbnail?.trim() || undefined;

  return (
    <>
      <BrandHeader
        name={brand.name}
        description={brand.description}
        {...(thumbnailUrl ? { thumbnailUrl } : {})}
        breadcrumbs={[
          { name: "Home", uri: "/", current: false },
          { name: "Brands", uri: "/brand", current: false },
          { name: brand.name, uri: `/brand/${brandSlug}`, current: true },
        ]}
      />
      <BrandProductsShell brandSlug={brandSlug} />
    </>
  );
}

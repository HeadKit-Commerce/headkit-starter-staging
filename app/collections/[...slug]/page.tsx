import type { Metadata } from "next";
import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import { headkit as sdk } from "@/lib/sdk";
import { getCachedProductBrand } from "@/lib/product-brand";
import { CollectionHeader } from "@/components/headkit-ui/collection/collection-header";
import { CollectionPage } from "@/components/headkit-ui/collection/collection-page";
import {
  buildProductListFilter,
  buildBreadcrumbFromCategory,
  collectionPathFromCategory,
  encodeFilterSlug,
  decodeFilterSlug,
  isIndexableFacet,
  isColorAttrSlug,
  facetTitle,
  facetDescription,
  formatOptionName,
  DEFAULT_FILTER_VALUES,
} from "@/components/headkit-ui/collection/utils";
import { toAttributeKey } from "@/lib/color-attr-slug";
import { brandSlugsPerCategory } from "@/lib/brand-facets";
import {
  readFacetCataloguePlan,
  shouldDiscoverCollectionFacets,
  shouldEmitCollectionFacets,
} from "@/lib/collection-facet-plan";
import {
  makeSeoMetadata,
  seoFallbackDescription,
  resolveRobots,
  resolveStoreName,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import type { SortKeyType } from "@/components/headkit-ui/collection/utils";
import type { ProductFilters } from "@headkit/sdk";
import {
  filterCategoriesByNonEmptySlugs,
  getNonEmptyCollectionSlugs,
} from "@/lib/hide-empty-collections";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import { walkCategoryPaths } from "@/app/shop/shop-slug";
import {
  canonicalCollectionRedirect,
  getCategoryData,
  parseCollectionSlug,
  STATIC_GEN_PLACEHOLDER_SLUG,
} from "@/lib/collection-canonical";

interface Props {
  params: Promise<{ slug: string[] }>;
}

const PER_PAGE = CATALOG_PAGE_SIZE;

/**
 * Encode a single-color filter slug (`color.<c>`) consistently with the URL
 * router via encodeFilterSlug. `attrSlug` is the store's own colour attribute
 * slug from getFilters (prefix stripped, e.g. `colour`) — never hard-code
 * `pa_color`, a British-spelled (or otherwise non-`pa_color`) store's colour
 * attribute would silently match zero products. Returns "" for an empty color.
 */
function colorFilterSlug(attrSlug: string, color: string): string {
  if (!color) return "";
  return encodeFilterSlug({
    ...DEFAULT_FILTER_VALUES,
    attributes: { [toAttributeKey(attrSlug)]: [color] },
  });
}

/**
 * Encode a single-brand filter slug (`brand.<b>`) consistently with the URL
 * router via encodeFilterSlug. Returns "" for an empty brand.
 */
function brandFilterSlug(brand: string): string {
  if (!brand) return "";
  return encodeFilterSlug({
    ...DEFAULT_FILTER_VALUES,
    brands: [brand],
  });
}

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  try {
    const categories = await sdk.collections.getCategories();
    // The SHARED walk (`app/shop/shop-slug.ts`) — the same one `resolveShopPath`
    // and `app/sitemap.ts` use. A local copy lived here and had already drifted:
    // it did not skip WooCommerce's default category, so it prerendered
    // `/collections/uncategorised` while the shared walk excluded it. A second
    // implementation that can drift is precisely how the sitemap came to
    // advertise nested while everything else named flat.
    //
    // `includeExcluded: true` preserves that param set EXACTLY rather than
    // silently dropping a prerendered route as part of a de-duplication:
    // enumerating params to prerender is the one caller that wants the default
    // category kept, which is what the flag is for.
    const nodes = walkCategoryPaths(categories, { includeExcluded: true });
    const paths: { slug: string[] }[] = [];

    // Base category params (all categories incl. nested). Never budgeted:
    // these are the route's primary URL class.
    for (const node of nodes) {
      paths.push({ slug: node.segments });
    }

    // Facet params: the whole indexable set, or none. The decision is the
    // pages left under the 45-minute ceiling after product HTML and the base
    // categories (`lib/collection-facet-plan.ts`). It is made before
    // `getFilters`. A set that does not fit is not sliced to a walk-order
    // prefix. Unbuilt facet URLs still route. The first request fills the
    // cache; there is no `loading.tsx` skeleton in front of them.
    const facetPlan = await readFacetCataloguePlan(
      "products" in sdk ? sdk.products : undefined,
    );
    if (shouldDiscoverCollectionFacets(facetPlan, nodes.length)) {
      const facets = await facetParams(nodes);
      if (shouldEmitCollectionFacets(facetPlan, nodes.length, facets.length)) {
        paths.push(...facets);
      }
    }

    if (paths.length > 0) return paths;
  } catch {
    /* API unreachable at build — fall through */
  }
  // Cache Components requires generateStaticParams to return ≥1 param.
  return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
}

/**
 * The `/f/<slug>` facet params for a set of category nodes, colour first then
 * brand. Reads the per-category filter list, so it is only ever called when
 * the store's facet budget is non-zero.
 */
async function facetParams(
  nodes: { slug: string; segments: string[] }[],
): Promise<{ slug: string[] }[]> {
  const paths: { slug: string[] }[] = [];

  // Tier-1 category×color params: color-only, single value, no blowup.
  // Fetch each category's present colors and emit one entry per color.
  const filterResults = await Promise.all(
    nodes.map((node) =>
      sdk.collections
        .getFilters(node.slug)
        .then((f) => ({ node, filters: f }))
        .catch(() => ({ node, filters: null })),
    ),
  );

  for (const { node, filters } of filterResults) {
    if (!filters) continue;
    const colorAttr = filters.attributes?.find((a) =>
      isColorAttrSlug(a?.slug ?? ""),
    );
    const seen = new Set<string>();
    for (const option of colorAttr?.options ?? []) {
      const slug = colorFilterSlug(colorAttr?.slug ?? "", option?.slug ?? "");
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      paths.push({ slug: [...node.segments, "f", slug] });
    }
  }

  // Tier-1 category×brand params (06.1): one single-brand entry per category
  // per brand — but ONLY for pairs that actually contain a product. The
  // per-category brand list rides along on the same `getFilters` call the
  // colour facets above already made, so this costs no extra build-time read
  // while removing the empty pairs of the old blind cross-product (9,499 of
  // 10,000 on one measured store). `lib/brand-facets.ts` owns the rule and
  // `app/sitemap.ts` calls the same helper, so the two cannot drift.
  //
  // Prerendering only: an un-emitted pair still routes and still 200s on
  // demand, it just pays a cold render on first hit.
  try {
    // perPage capped at 100 — headkit/v2/brands 400s above 100 (REST max arg).
    const brandsRes = await sdk.brands.list({ perPage: 100 });
    const globalBrandSlugs = brandsRes.brands.map((b) => b?.slug ?? "");
    const perCategoryBrands = brandSlugsPerCategory(
      filterResults.map(({ filters }) => filters),
      globalBrandSlugs,
    );
    for (const [i, { node }] of filterResults.entries()) {
      const seenBrand = new Set<string>();
      for (const brandSlug of perCategoryBrands[i] ?? []) {
        const slug = brandFilterSlug(brandSlug);
        if (!slug || seenBrand.has(slug)) continue;
        seenBrand.add(slug);
        paths.push({ slug: [...node.segments, "f", slug] });
      }
    }
  } catch {
    /* brands API unreachable at build — color params still emitted */
  }

  return paths;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return {};
  const { categorySlug, filterSlug } = parseCollectionSlug(slug);
  if (!categorySlug) return {};
  try {
    const [{ category, productFilter }, { seoSettings, storeSettings }] =
      await Promise.all([getCategoryData(categorySlug), getBranding()]);
    if (!category) return {};
    const siteName = resolveStoreName(storeSettings.name);
    // Derived from the CATEGORY, never from the requested path: the route
    // resolves a category from the last slug segment, so `/collections/child`
    // and `/collections/parent/child` serve identical content. Canonicalising
    // each to itself would declare both duplicates originals; this consolidates
    // both onto the nested path `app/sitemap.ts` advertises.
    //
    // KNOWN DIVERGENCE — do NOT "fix" this by reverting to the requested path.
    // The two paths come from different ancestry sources and can disagree:
    //   - here: `category.ancestors`, the TRUE parent chain, walked term by term
    //     by the WP single-category endpoint with no filtering or paging;
    //   - `app/sitemap.ts`: `walkCategoryPaths` over the tree commerce assembles
    //     in `buildCategoryForest` from the FLAT list endpoint, which is called
    //     with no query params so WordPress applies `per_page=100` and
    //     `hide_empty=true`. A child whose parent falls outside that page (or is
    //     hidden) is PROMOTED TO A ROOT, so the sitemap emits the flat path.
    // On a store with more than ~100 categories the canonical is therefore the
    // correct URL while the sitemap entry is the defective one. The canonical
    // target still serves, so this splits signal rather than breaking a URL, and
    // the real fix belongs at the origin — commerce requesting the full list
    // (`per_page` / `hide_empty=false`) so orphans stop being promoted.
    const canonicalBasePath = collectionPathFromCategory(category);

    // Tier-1 branch: a single-color URL (e.g. /collections/<cat>/f/color.red)
    // earns its OWN indexable identity — self-canonical, facet title/desc, and
    // robots index in prod. isIndexableFacet is the single source of truth so
    // on-demand single-color pages are SEO-correct too.
    if (filterSlug) {
      const decoded = decodeFilterSlug(filterSlug);
      const filterValues = {
        ...DEFAULT_FILTER_VALUES,
        attributes: decoded.attributes,
        brands: decoded.brands,
      };
      if (isIndexableFacet(filterValues)) {
        // Tier-1 facet is exactly one of: single color OR single brand (06.1).
        // Resolve the human display label for whichever dimension is engaged.
        let facetLabel: string;
        if (decoded.brands.length === 1) {
          const brandSlug = decoded.brands[0]!;
          // The brand display name comes from the CACHED per-brand read, and
          // it has to: an uncached read here is "uncached data in
          // generateMetadata()", which under Cache Components fails the
          // prerender of every `/f/brand.*` page on the store (189 of them,
          // measured on Bike Society). It did not fail while the root layout's
          // `DynamicMetadataMarker` gave every route a dynamic hole that masked
          // it — so this was always an uncached read on the hottest metadata
          // path, just an invisible one. `app/generate-metadata-cached-reads.test.ts`
          // is what makes the class visible in 200 ms instead of a 25-minute
          // build.
          //
          // `getCachedProductBrand` is the same entry the PDP uses: one per
          // brand, tagged `TAG.brand(slug)`, `null` on failure. It adds no
          // purge class this route lacked — the same product save that fires
          // that tag already fires the catalogue tags this route's category
          // read carries — and it replaces a 100-brand list with a single-brand
          // read, which also lifts the `perPage: 100` ceiling the old code
          // documented: a brand past the 100th used to fall back to its slug.
          const brand = await getCachedProductBrand(brandSlug);
          facetLabel = brand?.name ?? formatOptionName(brandSlug);
        } else {
          const colorSlug =
            decoded.attributes.pa_color?.[0] ??
            decoded.attributes.pa_colour?.[0] ??
            "";
          // Resolve the human display label from the category's own filter
          // options; fall back to title-casing the slug.
          const colorAttr = productFilter.attributes?.find((a) =>
            isColorAttrSlug(a?.slug ?? ""),
          );
          facetLabel =
            colorAttr?.options?.find((o) => o?.slug === colorSlug)?.name ??
            formatOptionName(colorSlug);
        }
        // Absolute, from the runtime store domain — the same origin rule the
        // base-category branch below uses. A relative canonical would resolve
        // against the inherited `metadataBase`, which is built from the
        // build-time env and so names the stale host on a custom domain.
        const selfCanonical = storefrontUrl(
          `${canonicalBasePath}/f/${filterSlug}`,
          storeSettings.domain,
        );
        const title = facetTitle(category.name, facetLabel);
        const description = facetDescription(
          category.name,
          facetLabel,
          storeSettings.name,
        );
        return {
          title,
          description,
          alternates: { canonical: selfCanonical },
          // Was `{ index: isProduction, follow: isProduction }` — it consulted
          // VERCEL_ENV but never the store's own switch, so a facet URL stayed
          // indexable on a store with indexing turned off. `resolveRobots`
          // honours the setting instead. The HOST arm is no longer here: a
          // rehearsal host is closed by the `X-Robots-Tag` header `proxy.ts`
          // sets on every page response (lib/host-robots.ts), so this facet URL
          // is judged against the store's own host like every other surface —
          // robots.txt allows /collections/*, and this must not contradict it.
          robots: resolveRobots(seoSettings.allowIndexing),
          openGraph: {
            type: "website",
            title,
            description,
            url: selfCanonical,
            siteName,
            ...(category.thumbnail ? { images: [category.thumbnail] } : {}),
          },
          twitter: {
            card: "summary_large_image",
            title,
            description,
          },
        };
      }
    }

    const metadata = await makeSeoMetadata(category.seo, {
      title: category.name,
      // Templated per-entity floor when both Yoast SEO and the category's own
      // description are absent (FE-09 / D-04). Real category.seo still wins.
      description:
        category.description ||
        seoFallbackDescription("category", category.name, storeSettings.name),
      ...(storeSettings.name != null ? { storeName: storeSettings.name } : {}),
      // Base collection pages shipped NO canonical, a straight regression from
      // the V1 storefronts.
      canonical: storefrontUrl(canonicalBasePath, storeSettings.domain),
      siteUrl: storeSettings.domain,
      allowIndexing: seoSettings.allowIndexing,
    });
    // Tier-2: any other filtered URL points back to the unfiltered collection
    // as canonical (R1: base). Unfiltered category metadata is unchanged.
    if (filterSlug) {
      metadata.alternates = {
        canonical: storefrontUrl(canonicalBasePath, storeSettings.domain),
      };
    }
    return metadata;
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

/**
 * Instant Navigation (Next.js 16.3): keep the route segment sync so Partial
 * Prefetching can ship an App Shell immediately. Awaiting `params` / category
 * data in the default export blocks client navigations (blank wait on click).
 * Stream via Suspense; `'use cache'` category reads pop in early when links use
 * `prefetch={true}` (see InstantLink / SubcategoryCarousel).
 *
 * @see https://nextjs.org/docs/app/guides/instant-navigation
 */
/**
 * Flat collection URLs: 308 onto the category's nested path, or serve.
 *
 * The route resolves a category from the LAST slug segment, so
 * `/collections/child` and `/collections/parent/child` both serve it. The
 * 2026-08-22 decision makes the nested path canonical, and this is where the
 * loser is retired.
 *
 * ### The redirect must be thrown above EVERY Suspense boundary
 *
 * Under Cache Components a redirect thrown inside a Suspense boundary runs
 * after the response has committed, so the route answers 200 with a skeleton
 * and redirects only on the client — invisible to the crawler this exists for.
 * (The `/posts` → `/news` move hit exactly that; see the note on `redirects()`
 * in `next.config.ts`.) Hence the decision is awaited here rather than in
 * `CollectionRoute`, and hence this route has **no `loading.tsx`**: a
 * route-level `loading.tsx` wraps the page component in an IMPLICIT boundary,
 * which puts even the default export inside one — as does a boundary in an
 * ANCESTOR layout, which is why `app/layout.tsx` no longer wraps `{children}`
 * in a `<Suspense>`. Measured on a Next 16.3 build with `cacheComponents: true`,
 * one variable at a time — see the fuller table in
 * `app/products/[...slug]/page.tsx`:
 *
 *   with a `loading.tsx` present        → 200 + skeleton (client-side redirect)
 *   with a root-layout `<Suspense>`     → 200 + skeleton (client-side redirect)
 *   with neither                        → 308, prerendered AND at runtime
 *
 * Nothing is lost by the file's absence: this route has no Suspense boundary at
 * all any more, so its heading and first page of product cards render in the
 * static shell where a JS-off shopper and a non-rendering crawler can see them
 * (see `CollectionProductsShell`). Re-introducing either boundary silently
 * turns every flat collection URL back into a 200 duplicate AND hides the grid
 * again; `e2e/canonical-url-308.spec.ts` fails on the status code when one
 * does.
 *
 * The remaining cost is this route's App Shell — awaiting in the default export
 * forfeits Partial Prefetching here. The awaited read is `getCategoryData`,
 * which `CollectionRoute` awaits anyway and which is `'use cache'`, so it is
 * the same cache entry rather than an extra round trip, and every param in
 * `generateStaticParams` still prerenders (verified: `◐ Partial Prerender`, not
 * dynamic).
 *
 * ### The same mechanism governs `notFound()`, and it is gated here too
 *
 * A missing category answered 200 with a streamed not-found body while
 * `loading.tsx` wrapped this segment, so the existence check is resolved here
 * as well. With that file gone, `notFound()` sets 404 and `permanentRedirect`
 * sets 308. The conditions — and why `instant` is NOT one of them — live once
 * in "Setting a status code needs THREE conditions" in `apps/starter/AGENTS.md`.
 * `instant = true` stays: the prerendered document is the shell, and a click
 * paints that document rather than a skeleton.
 *
 * ### The 308 carries the path, not the query
 *
 * `searchParams` is deliberately NOT awaited: doing so would opt the whole
 * segment dynamic and leave a 0-byte shell for every request (see
 * `CollectionProductsShell`). So path-encoded facets (`/f/…`) survive the
 * redirect because they are slug segments, while a query string on a flat URL
 * is dropped. Three cases, named explicitly because they are not equally cheap:
 *
 *   - `?page=2` / `?sort=` — the shopper lands on page 1 in the default order.
 *   - `?q=` / `?price_min=` / `?instock=` — the same, unfiltered.
 *   - `?pa_color=red`, `?brands=…` — a LEGACY FACET, and the case that carries
 *     V1 link equity.
 *
 * Accepted rather than fixed: folding the facet into this redirect target needs
 * `searchParams` here, which opts the whole segment dynamic — the exact cost the
 * paragraph above refuses. The flat shape has no internal links left after this
 * change, so the traffic is external links and crawlers, and the destination is
 * the collection they asked for.
 *
 * The legacy facet's SERVER-side fold is gone with the boundary that housed it,
 * and was never visible to a crawler anyway: it lived below the boundary, so
 * `permanentRedirect` there could not set a status line and answered 200 with a
 * client-side `NEXT_REDIRECT` payload (measured live, 2026-09-15). A JS-on
 * shopper gets the same navigation from `CollectionProvider`'s mount effect,
 * which reads those query params and pushes the `/f/…` path.
 */
export const instant = true;

export default function Page(props: Props) {
  return <CollectionPageContent {...props} />;
}

export async function CollectionPageContent({ params }: Props) {
  const { slug } = await params;
  // The build-time placeholder is never served from a prerender, so a runtime
  // request for it is a junk URL and must 404 HERE. Skipping the gate for it
  // instead let it fall through to `CollectionRoute`, whose `notFound()` fires
  // below the boundary — the soft 404 this gate exists to close.
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) notFound();

  const redirectTo = await canonicalCollectionRedirect(slug);
  if (redirectTo) permanentRedirect(redirectTo);

  // Pre-commit 404 gate. `CollectionRoute` repeats the checks — it is also
  // entered from `/shop/[...slug]` — and the `"use cache"` category read
  // dedupes, so the repeat is a cache hit. What the gate resolves is then
  // RENDERED rather than re-read behind a boundary: there is no boundary on
  // this route.
  const { categorySlug } = parseCollectionSlug(slug);
  if (!categorySlug) notFound();
  // A THROWN read is transport/infra and must not bake a sticky 404 into the
  // route cache — `getCategoryData` deliberately does not catch, so it
  // propagates from here exactly as it does from `CollectionRoute`. Only the
  // null (genuinely missing) case reaches `notFound()`.
  const { category } = await getCategoryData(categorySlug);
  if (!category) notFound();

  return <CollectionRoute params={params} />;
}

/**
 * Exported so the nested `/shop/[...slug]` route renders the IDENTICAL
 * collection view for a category URL rather than duplicating it (D-15-04).
 *
 * The shop route passes the category's own segments, so `categoryBasePath`
 * stays `/collections/…`: facet links and the legacy query-facet redirect below
 * therefore target the `/collections` namespace, which serves them. Pointing
 * them at `/shop/…` would emit a permanent redirect into a path the shop
 * catch-all classifies as unknown — RESEARCH C-6 in a new shape.
 */
export async function CollectionRoute({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return notFound();
  const { categorySlug, filterSlug, categoryBasePath } =
    parseCollectionSlug(slug);
  if (!categorySlug) return notFound();

  // Do NOT catch→notFound here: the SDK returns null (never throws) for a
  // genuinely missing category, so a *thrown* error is always transport/infra
  // — e.g. a transient WooCommerce 429. Swallowing it into notFound() bakes a
  // sticky 404 into the route cache (14-day stale). Let it propagate: Next then
  // serves the last good render and retries. Genuine 404s use the null check.
  // Overlap the two cached reads. The header image cannot paint until both
  // have resolved, and they do not depend on each other.
  const categoryPromise = getCategoryData(categorySlug);
  const brandingPromise = getBranding();
  const { category, productFilter } = await categoryPromise;
  if (!category) return notFound();

  const breadcrumbs = buildBreadcrumbFromCategory(category);
  // The one path this category is canonical at — also the base its child
  // category tiles link beneath, so they name nested paths instead of the flat
  // shape this route now redirects.
  const canonicalBasePath = collectionPathFromCategory(category);
  const { branding } = await brandingPromise;
  const nonEmptySlugs = branding.hideEmptyCollections
    ? await getNonEmptyCollectionSlugs()
    : null;
  const childCategories =
    nonEmptySlugs && category.children?.length
      ? filterCategoriesByNonEmptySlugs(category.children, nonEmptySlugs)
      : (category.children ?? []);
  const hasChildren = childCategories.length > 0;
  // A parent collection's LCP is the subcategory carousel (its first card is
  // already priority). Keep the product grid lazy there. A leaf is different:
  // the square product card is taller than the short banner, so the first
  // card is the LCP element and must not be lazy. Measured on Paralel dining
  // chairs: the card was lazy, fetchpriority was absent, and it was the LCP.
  const preferHeaderLcp = hasChildren;

  return (
    <>
      <BreadcrumbJsonLD
        items={breadcrumbs.map((b) => ({
          name: b.name,
          href: b.uri,
        }))}
      />
      <CollectionHeader
        name={category.name}
        description={category.description}
        breadcrumbs={breadcrumbs}
        childBasePath={canonicalBasePath}
        {...(category.thumbnail ? { thumbnail: category.thumbnail } : {})}
        {...(childCategories.length > 0 ? { children: childCategories } : {})}
      />
      {/* No boundary: the grid renders in the static shell. See below. */}
      <CollectionProductsShell
        categorySlug={categorySlug}
        productFilter={productFilter}
        filterSlug={filterSlug}
        categoryBasePath={categoryBasePath}
        preferHeaderLcp={preferHeaderLcp}
      />
    </>
  );
}

/**
 * Page 1 of the grid, filtered by the PATH facet only, rendered in the static
 * shell — no `<Suspense>` above it anywhere on this route.
 *
 * Both of its reads (`getBranding`, `getCachedCatalogPage`) are `"use cache"`,
 * and it awaits no `searchParams`, so the whole route still prerenders. Those
 * two properties are what the shell placement costs, and neither is optional:
 *
 *   - A request-time read here (`searchParams`, `cookies()`, `headers()`, an
 *     uncached fetch) with no boundary turns the route DYNAMIC — `ƒ`, 0-byte
 *     shell — rather than failing the build. `CollectionProvider`'s
 *     `useSearchParams()` did exactly that and is why this was not possible
 *     before; it is gone, and `app/shop/[...slug]/page.composition.test.tsx`
 *     guards its absence.
 *   - A boundary here does not help: React outlines any COMPLETED boundary
 *     larger than 500 bytes into a hidden segment (`isEligibleForOutlining`,
 *     `next/dist/compiled/react-dom`, once the shell has already flushed past
 *     `progressiveChunkSize`), and one product card is ~4.3 KB. Measured: a
 *     boundary holding ZERO cards still outlined. So no number of cards fits
 *     inside one — the cached half must sit outside every boundary.
 *
 * The consequence is that this always renders page 1 in the store's default
 * order. `?page=`, `?sort=`, `?q=`, `?price_*`, `?instock=` and `?categories=`
 * are applied in the browser by `CollectionProvider`'s mount effect; none of
 * them is canonical or in the sitemap.
 * The INDEXABLE facets are unaffected — they live in the `/f/<slug>` path
 * segment, which arrives via `params`.
 */
async function CollectionProductsShell({
  categorySlug,
  productFilter,
  filterSlug,
  categoryBasePath,
  preferHeaderLcp = false,
}: {
  categorySlug: string;
  productFilter: ProductFilters;
  filterSlug: string | undefined;
  categoryBasePath: string;
  preferHeaderLcp?: boolean;
}) {
  const decoded = filterSlug ? decodeFilterSlug(filterSlug) : undefined;
  const initialFilterValues =
    decoded && Object.keys(decoded.attributes).length > 0
      ? decoded.attributes
      : undefined;
  const initialBrands =
    decoded && decoded.brands.length > 0 ? decoded.brands : undefined;

  const { branding } = await getBranding();
  const filter = buildProductListFilter(
    {
      ...DEFAULT_FILTER_VALUES,
      brands: decoded?.brands ?? [],
      attributes: decoded?.attributes ?? {},
      page: 1,
    },
    {
      categorySlug,
      defaultSort: branding.defaultCollectionSort as SortKeyType,
    },
  );

  const productsResult = await getCachedCatalogPage(filter, 1, PER_PAGE, {
    kind: "category",
    slug: categorySlug,
  });

  return (
    <CollectionPage
      initialProducts={productsResult.products}
      initialTotal={productsResult.total}
      productFilter={productFilter}
      initialPage={1}
      itemsPerPage={PER_PAGE}
      categorySlug={categorySlug}
      categoryBasePath={categoryBasePath}
      preferHeaderLcp={preferHeaderLcp}
      {...(initialFilterValues ? { initialFilterValues } : {})}
      {...(initialBrands ? { initialBrands } : {})}
    />
  );
}

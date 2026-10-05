import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import type {
  ProductFieldsFragment,
  ProductSummaryFieldsFragment,
  ProjectSummaryFieldsFragment,
} from "@headkit/sdk";
import { headkit } from "@/lib/sdk";
import {
  paramsFromPlanPaths,
  readProductPrerenderPlan,
} from "@/lib/product-prerender-plan";
import { getCachedProduct, getProductForPage } from "@/lib/product-cache";
import {
  getCachedProductBrand,
  resolveDisplayBrand,
} from "@/lib/product-brand";
import { TAG } from "@/lib/cache-tags";
import { errorFields, logger } from "@/lib/logger";
import { ProductDetail } from "@/components/headkit-ui/product-detail";
import { SwatchImageProvider } from "@/components/headkit-ui/swatch-image-provider";
import { experimentalSwatchImagesEnabled } from "@/lib/experimental-swatch-images";
import { loadSwatchImageMap } from "@/lib/swatch-visual";
import { ProductStock } from "@/components/headkit-ui/product-stock";
import { AvailabilityLineFallback } from "@/components/headkit-ui/live-availability";
import { ProductCarousel } from "@/components/headkit-ui/product-carousel";
import { ProjectCarousel } from "@/components/headkit-ui/project/project-carousel";
import { SectionHeader } from "@/components/headkit-ui/section-header";
import { ProductJsonLD } from "@/components/seo/product-json-ld";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import {
  makeSeoMetadata,
  resolveStoreName,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import { getStripeConfig } from "@/lib/stripe-config";
import {
  formatOptionName,
  isColorAttrSlug,
} from "@/components/headkit-ui/collection/utils";
import {
  collectionPathFromSegments,
  productCategorySegments,
  productPath,
} from "@/lib/canonical-path";
import {
  productRedirectTarget,
  STATIC_GEN_PLACEHOLDER_SLUG,
} from "@/lib/product-canonical";
import { ProductPageShell } from "./product-page-shell";
import { DynamicMetadataMarker } from "@/components/seo/dynamic-metadata-marker";
import { PdpBesideBundles } from "@/overrides/pdp-beside-bundles";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { env } from "@/lib/env";
import { isShopifyStorefront } from "@/lib/shopify-storefront";
import { getStoreTheme } from "@/lib/store-theme";
import { resolveSectionCopy } from "@/lib/section-copy";

/**
 * WooCommerce shop archive slug (WP product permalinks use `/shop/…`).
 * Keep PDP crumbs aligned with category/shop pages — never `/products`.
 */
const SHOP_BREADCRUMB = { name: "Shop", href: "/shop" } as const;

type Props = {
  params: Promise<{ slug: string[] }>;
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | undefined;
};

function shopifyPreviewKeyFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const raw = searchParams?.preview_key;
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw;
  }
  return undefined;
}

/** Re-export for PDP tag/life guard tests (ENG-853). */
export const getProduct = getCachedProduct;

function mapRelatedToProduct(
  r: ProductFieldsFragment["related"][number],
): ProductSummaryFieldsFragment {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    // Carry WooCommerce's own permalink so a related/upsell card resolves the
    // SAME canonical path the PDP and the sitemap do. Synthesising a flat
    // `/products/{slug}` here is what made every related link vote against the
    // indexed URL.
    uri: r.permalink,
    isNew: r.isNew,
    price: r.price,
    regularPrice: r.regularPrice,
    salePrice: r.salePrice,
    onSale: r.onSale,
    type: r.type,
    stockStatus: r.stockStatus,
    tags: r.tags ?? [],
    image: r.image
      ? {
          src: r.image.src,
          alt: r.image.alt,
          width: r.image.width,
          height: r.image.height,
        }
      : null,
    hoverImage: r.hoverImage
      ? {
          src: r.hoverImage.src,
          alt: r.hoverImage.alt,
          width: r.hoverImage.width,
          height: r.hoverImage.height,
        }
      : null,
    attributes: r.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      type: a.type,
      options: a.options,
      variation: a.variation,
      visible: a.visible,
      fullOptions: a.fullOptions,
    })),
    defaultAttributes: (r.defaultAttributes ?? []).map((a) => ({
      key: a.key,
      value: a.value,
    })),
    variations: r.variations.map((v) => ({
      id: v.id,
      price: v.price,
      regularPrice: v.regularPrice,
      salePrice: v.salePrice,
      onSale: v.onSale,
      stockStatus: v.stockStatus,
      dateModified: v.dateModified ?? null,
      image: { src: v.image.src },
      images: (v.images ?? []).map((img) => ({ src: img.src })),
      attributes: v.attributes,
    })),
  };
}

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  // Commerce decides (`lib/product-prerender-plan.ts`). On-demand skips the
  // catalogue walk: an unbuilt PDP's first request is ISR, and walking a
  // catalogue past the build ceiling is what kills the deploy.
  const plan = await readProductPrerenderPlan(headkit.products);
  if (plan.mode !== "all") {
    const seeded = paramsFromPlanPaths(plan.paths, "products");
    if (seeded.length > 0) return seeded;
    return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
  }

  const params: { slug: string[] }[] = [];

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await headkit.products.list({}, page, 100);
      for (const product of result.products) {
        params.push({ slug: [product.slug] });
        // Colourway URLs belong to the nested route. This flat route 308s
        // them, and prerendering a redirect spends the build on the redirect.
      }
      hasMore = page < result.totalPages;
      page++;
    }
  } catch {
    /* Catalog API unreachable at build — fall through to the placeholder. */
  }

  if (params.length > 0) return params;
  return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const productSlug = slug[0]!;
  const colorSlug = slug[1]; // undefined for simple/base; a color slug for a colorway URL
  const previewKey = shopifyPreviewKeyFromSearchParams(
    searchParams ? await searchParams : undefined,
  );

  // Build-time placeholder param (API was unreachable during SSG): never a real
  // product, so emit empty metadata rather than hitting the backend.
  if (productSlug === STATIC_GEN_PLACEHOLDER_SLUG) return {};

  try {
    const [product, { seoSettings, storeSettings }, { iconUrl }] =
      await Promise.all([
        getProductForPage(productSlug, { shopifyPreviewKey: previewKey }),
        getBranding(),
        getBrandingAssets(),
      ]);
    if (!product) {
      return { robots: { index: false, follow: false } };
    }

    const previewRobots = previewKey
      ? ({ robots: { index: false, follow: false } } as const)
      : ({} as const);

    const desc = product.shortDescription || product.description;
    // The canonical is the product's OWN path (nested when its permalink has
    // one), never the requested `/products/...` shape — this route 308s onto
    // that path, and a self-referential canonical here would declare the
    // redirect source an original.
    const baseCanonical = storefrontUrl(
      productPath(product),
      storeSettings.domain,
    );
    const brandingOpts = {
      storeName: storeSettings.name ?? undefined,
      dashboardOgImageUrl: seoSettings.ogImageUrl ?? undefined,
      brandingIconUrl: iconUrl ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      siteUrl: storeSettings.domain,
    } as const;

    // Base product URL (no color in path): self-canonical, index in prod (S2).
    if (!colorSlug) {
      return await makeSeoMetadata(product.seo ?? null, {
        title: product.name,
        canonical: baseCanonical,
        ...(desc ? { description: desc } : {}),
        ...brandingOpts,
        ...previewRobots,
      });
    }

    // Colorway URL: resolve the color attribute + its valid option slugs/labels.
    const colorAttr = product.attributes.find((a) => isColorAttrSlug(a.slug));
    const colorOption = colorAttr?.fullOptions.find(
      (opt) => opt.slug === colorSlug,
    );

    // Invalid color path (not a real variation option) → noindex junk URL.
    if (!colorOption) {
      return { robots: { index: false, follow: false } };
    }

    // Valid colorway: own title (Name – Color), self-canonical (S1), variant OG.
    const variation = product.variations.find((v) =>
      v.attributes.some((a) => isColorAttrSlug(a.key) && a.value === colorSlug),
    );
    const ogImage = variation?.image?.src ?? product.image?.src;

    return await makeSeoMetadata(product.seo ?? null, {
      title: `${product.name} – ${colorOption.name}`,
      canonical: storefrontUrl(
        productPath(product, colorSlug),
        storeSettings.domain,
      ),
      ...(ogImage ? { ogImage } : {}),
      ...(desc ? { description: desc } : {}),
      ...brandingOpts,
      ...previewRobots,
    });
  } catch (error) {
    unstable_rethrow(error);
    return { robots: { index: false, follow: false } };
  }
}

/**
 * Flat product URLs: 308 onto the product's canonical path, or serve.
 *
 * ### The redirect must be thrown above EVERY Suspense boundary
 *
 * Under Cache Components a redirect thrown inside a Suspense boundary runs
 * after the response has already committed, so the route answers 200 with a
 * shell and redirects only on the client — invisible to a crawler, which is the
 * only reader this exists for. (Same trap the `/posts` → `/news` move hit; see
 * the note on `redirects()` in `next.config.ts`.) So the decision is awaited
 * here, in the default export, above the `<Suspense>` below.
 *
 * That is not sufficient on its own, and the part that is easy to miss is that
 * SEVERAL separate things put this page inside a boundary — an in-page
 * `<Suspense>`, a `loading.tsx` at this route OR at any ANCESTOR segment (an
 * IMPLICIT boundary around that segment and everything nested below it), and a
 * boundary in an ANCESTOR layout — and removing only some of them still answers
 * 200. Hence this route has **no `loading.tsx`** and `app/layout.tsx` no longer
 * wraps `{children}` in a `<Suspense>`. "Setting a status code needs THREE
 * conditions" in `apps/starter/AGENTS.md` enumerates the full set, including the
 * fully postponed prerendered shell that a dynamic segment with NO
 * `generateStaticParams` is served from — this route declares one, so it never
 * sat behind that one. Measured on a Next 16.3 build with
 * `cacheComponents: true`, one variable at a time:
 *
 *   redirect below `<Suspense>`            → 200 + shell (client-side redirect)
 *   redirect in the default export,
 *     with a `loading.tsx` present         → 200 + shell (client-side redirect)
 *   redirect in the default export,
 *     with a root-layout `<Suspense>`      → 200 + shell (client-side redirect)
 *   redirect in the default export,
 *     none of the three                    → 308, prerendered AND at runtime
 *
 * `instant = true` makes no difference either way. Re-introducing any of the
 * three silently turns every flat product URL back into a 200 duplicate, which
 * is the whole defect this closes. No unit test can see it — calling this
 * function throws `NEXT_REDIRECT` under all of them — so
 * `e2e/canonical-url-308.spec.ts` is what fails, on the status code itself.
 *
 * The deletion is not free, and the cost is worth stating plainly rather than
 * claiming nothing is lost. The default export awaits `getCachedProduct` before
 * returning anything, so on a cache miss — a product past the
 * build's static params, or after the `cacheLife` window — a
 * soft navigation paints nothing until the backend responds, where
 * `loading.tsx` supplied a route-level skeleton instantly. `instant = true`
 * stays on this route but can no longer produce a static App Shell for the same
 * reason (the collections route documents the same forfeit). Both are accepted:
 * a 200 duplicate on every flat product URL is the larger cost.
 *
 * ### No redirect loop
 *
 * `productPath` returns THIS path for a product with no category ancestry (no
 * usable `/shop` permalink), so the comparison is what prevents a loop: such a
 * product is served here, self-canonical, and never redirected.
 *
 * ### The public product renders OUTSIDE the boundary; only a null read goes inside one
 *
 * The same `getCachedProduct` read that decides the redirect IS the product the
 * page renders, so when it resolves, `ProductPageBody` composes the whole PDP
 * (gallery, price, description, stock, carousels) directly in the route with
 * no `<Suspense>` around it, and that markup is baked into the prerendered
 * static shell — a shopper with JavaScript off, or a crawler that does not run
 * it, sees the product. It used to sit behind one route-level boundary that
 * landed the ENTIRE product in the streamed tail whatever the cache state
 * (measured on the Bike Society rehearsal store, 2026-09-10: 826 visible
 * characters in the shell — nav and footer — and every product byte behind
 * `B:2` behind a `ProductPageShell` fallback). Two distinct mechanisms did
 * that, and closing one without the other changes nothing:
 *
 *   - the boundary's subtree awaited `searchParams` (the Shopify preview key),
 *     a request-time read that POSTPONES the boundary at prerender — measured
 *     locally, the prerendered file holds the 4 946-byte skeleton and not one
 *     byte of product; remove the boundary instead and the route flips from
 *     `◐` to `ƒ` with a 0-byte shell;
 *   - React outlines any COMPLETED boundary larger than `progressiveChunkSize`
 *     (12 800 bytes; `flushSegment` in react-dom's Fizz) into a
 *     `<div hidden id="S:…">` plus an inline `$RC` swap that never runs with
 *     JavaScript off — so a product inside ANY boundary is hidden even when
 *     fully cached.
 *
 * "Cached content renders OUTSIDE the boundary" in `apps/starter/AGENTS.md`
 * owns the rule; `scripts/static-shell-split.ts` measures a built file.
 *
 * ### `searchParams` is forwarded, never awaited here
 *
 * The Shopify Admin preview key lives in the query string, and a 308 drops it —
 * but awaiting `searchParams` in THIS function to exempt a preview request is a
 * dynamic read above every boundary, which under Cache Components turns the
 * whole route dynamic (`ƒ`, empty prerendered shell — measured, see above).
 * Passing the unawaited promise down is not a read; `ProductPageContent`
 * awaits it inside the boundary below, which renders ONLY when the public read
 * returned null — the position a draft occupies. A product the public read can
 * see never pays that read at all.
 *
 * No exemption is needed anyway, and this is why the gate above is the PUBLIC
 * `getCachedProduct` rather than `getProductForPage`: a draft is invisible to
 * the public catalogue, so `product` is null, no redirect is issued, and the
 * key survives to the render that does consult the Admin API. See the Shopify
 * preview section in `apps/starter/AGENTS.md`.
 */
export const instant = true;

export default function ProductPage(props: Props) {
  return (
    <ProductRoute {...props} />
  );
}

export async function ProductRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const productSlug = slug[0]!;
  const colorSlug = slug[1];

  let product: Awaited<ReturnType<typeof getCachedProduct>> = null;
  if (productSlug !== STATIC_GEN_PLACEHOLDER_SLUG) {
    // This read is the THIRD provider call on the PDP path and the only one
    // above a Suspense boundary, so a provider auth/scope failure here aborts
    // the whole tenant static export — the failure `ProductPageContent` and
    // `generateMetadata` were both hardened against (#332). Degrade the same
    // way, but to SERVING rather than to notFound: the redirect is a
    // consolidation, so losing it costs one duplicate URL, while refusing to
    // render costs the page. A null here sends the request down the
    // request-time branch below, whose own read retries and degrades honestly.
    // Next control-flow still propagates.
    try {
      product = await getCachedProduct(productSlug);
    } catch (error) {
      unstable_rethrow(error);
    }
    if (product) {
      // The RULE lives in `lib/product-canonical.ts` because `proxy.ts` has to
      // apply the identical one to carry a campaign link's query string through
      // this 308. The pure form is used here so the product this route already
      // read is not read a second time for one string.
      const canonical = productRedirectTarget(product, slug);
      if (canonical) permanentRedirect(canonical);
    }
  }

  return (
    <>
      {product ? (
        <ProductPageBody
          product={product}
          productSlug={productSlug}
          colorSlug={colorSlug}
        />
      ) : (
        <Suspense fallback={<ProductPageShell />}>
          <ProductPageContent params={params} searchParams={searchParams} />
        </Suspense>
      )}
      {/*
        Request-time metadata opt-in, and the ONLY route in the app that mounts
        one. `generateMetadata` above awaits `searchParams` for the Shopify
        Admin preview key; the prerendered branch renders `ProductPageBody`
        outside any boundary, so without this marker that read is a build error
        ("uncached or runtime data in generateMetadata()"). It is a SIBLING of
        the page content, never a wrapper — a boundary around the body would
        hide the product from a client with JavaScript off. It used to live in
        `app/layout.tsx`, where it cost every route in the app its static shell;
        see components/seo/dynamic-metadata-marker.tsx for the measurement.
      */}
      <Suspense fallback={null}>
        <DynamicMetadataMarker />
      </Suspense>
    </>
  );
}

/**
 * What a PDP renders when the provider reads fail underneath it.
 *
 * Not `notFound()` (the product exists — see the catch that returns this) and
 * not a thrown error (that aborts the static export). The shopper gets an
 * honest, retryable page instead of either lie.
 */
function ProductTemporarilyUnavailable(): React.ReactElement {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-5 md:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl text-primary">
          This product is temporarily unavailable
        </h1>
        <p className="text-gray-600">
          We could not load it just now. Please refresh in a moment.
        </p>
      </div>
    </div>
  );
}

/**
 * The REQUEST-TIME branch: a product the public catalogue could not resolve.
 *
 * The route renders this only when `getCachedProduct` answered null (or threw)
 * above — a Shopify draft under Admin preview, a missing product, the
 * build-time placeholder, or a provider failure — and it is the ONE place on
 * the PDP that awaits `searchParams`: the preview key lives there, and reading
 * it is the request-time read that postpones the boundary this sits inside.
 * A product the public read CAN see never reaches this function; the route
 * composes it through {@link ProductPageBody} outside any boundary.
 *
 * Exported for the route's own tests, which drive it with a resolvable product
 * to exercise the shared body composition. The nested `/shop/[...slug]` route
 * does NOT use it: a draft can never reach that route (it verifies every
 * candidate against the public read before serving), so it renders
 * `ProductPageBody` directly.
 */
export async function ProductPageContent({ params, searchParams }: Props) {
  const { slug } = await params;
  const productSlug = slug[0]!;
  const colorSlug = slug[1]; // undefined for simple products or base variable URL
  const previewKey = shopifyPreviewKeyFromSearchParams(
    searchParams ? await searchParams : undefined,
  );

  // Build-time placeholder param (see generateStaticParams) is never served.
  if (productSlug === STATIC_GEN_PLACEHOLDER_SLUG) {
    notFound();
  }

  // A provider auth/scope failure here (e.g. Shopify Storefront 401) DEGRADES.
  // Neither of the two obvious alternatives is available, and the reason each
  // is closed is worth keeping:
  //
  //  - `notFound()` is wrong. A THROWN provider read is not evidence that the
  //    product is missing, so reporting it to shoppers and crawlers as a
  //    missing product is a lie — and one Next cannot back with a status
  //    anyway, because this component runs BELOW the `<Suspense>` that already
  //    committed the 200.
  //  - Rethrowing is wrong. At runtime it renders `app/error.tsx` for a
  //    product the shopper can otherwise be shown; on a build resume it aborts
  //    the render of a route whose `generateStaticParams` enumerates REAL
  //    products (#332).
  //
  // So it degrades, UNCONDITIONALLY, with no build-phase discriminator — a
  // direct `process.env` read outside `lib/env.ts` is banned (root
  // `AGENTS.md`, "Never"), and none is needed: the degraded body is the right
  // answer whenever this read fails.
  //
  // What a build blip produces has CHANGED with the route split, and the new
  // shape is the better one. The public read now runs in the route above,
  // outside every boundary; when it throws there the route falls through to
  // this branch, and at prerender the `searchParams` await above POSTPONES the
  // boundary before this read ever runs. So a blip while prerendering one
  // product no longer bakes "temporarily unavailable" into that product's
  // HTML — it bakes the `ProductPageShell` skeleton, and the first request
  // resumes here with a fresh read. This catch is therefore a RUNTIME degrade:
  // the least-wrong response when the retry fails too — not a false 404, not
  // an error boundary, and `generateMetadata`'s own catch has already marked
  // the page `noindex`, so nothing degraded is offered to a crawler. It LOGS,
  // with the slug, so the recovery lever (`revalidateTag(TAG.product(slug))`,
  // `lib/cache-tags.ts`) can be aimed.
  //
  // THE ASYMMETRY WITH `getPageData` IS DELIBERATE, not a contradiction.
  // `app/[...slug]/page.tsx` chooses to FAIL the build for `/[...slug]` and
  // `/wholesale` on this same class of failure (see the accepted-trade block
  // there). Those routes have NO degraded content to fall back to, so their
  // only options are fail-loud or bake a WRONG page — a 404 — and fail-loud
  // wins. A PDP has a degraded body. Different options, same policy: never
  // bake a lie, and never be silent about degrading.
  //
  // Next control flow is re-raised first and never absorbed.
  let product: Awaited<ReturnType<typeof getProductForPage>>;
  try {
    product = await getProductForPage(productSlug, {
      shopifyPreviewKey: previewKey,
    });
  } catch (error) {
    unstable_rethrow(error);
    logger.error("pdp.degraded_render", {
      productSlug,
      recovery: `revalidateTag(${TAG.product(productSlug)})`,
      ...errorFields(error),
    });
    return <ProductTemporarilyUnavailable />;
  }

  if (!product) {
    notFound();
  }

  // Called rather than rendered as an element, so the value returned is the
  // composed page tree itself — what the route tests and the canonical-shape
  // sweep inspect for crumbs, JSON-LD and the ProductDetail base path.
  return ProductPageBody({ product, productSlug, colorSlug });
}

type ProductPageBodyProps = {
  product: NonNullable<Awaited<ReturnType<typeof getCachedProduct>>>;
  productSlug: string;
  /** undefined for simple products or the base variable-product URL. */
  colorSlug: string | undefined;
};

/**
 * The PDP composition for a product already in hand.
 *
 * Every read below is a `"use cache"` entry — branding, Stripe config, one
 * brand — so this renders OUTSIDE any Suspense boundary and is baked into the
 * prerendered static shell; see the altitude note on `ProductPage` above.
 * Both PDP routes render it (D-15-04): they serve two valid URL shapes for one
 * product, and only their canonicals differ. Only `ProductStock` beneath it
 * reads on its own, and it reads the same cached product entry.
 *
 * The branding and Stripe reads never throw by contract (each degrades to its
 * defaults), but the catch stays: this runs above every boundary at BUILD for
 * every enumerated product, where an escaping error would abort the whole
 * tenant static export (#332). Same degrade and the same log line as the
 * product read in `ProductPageContent`, for the same reasons.
 */
export async function ProductPageBody({
  product,
  productSlug,
  colorSlug,
}: ProductPageBodyProps) {
  let branding: Awaited<ReturnType<typeof getBranding>>["branding"];
  let storeSettings: Awaited<ReturnType<typeof getBranding>>["storeSettings"];
  let stripeConfig: Awaited<ReturnType<typeof getStripeConfig>>;
  try {
    const [brandingBundle, stripe] = await Promise.all([
      getBranding(),
      getStripeConfig(),
    ]);
    branding = brandingBundle.branding;
    storeSettings = brandingBundle.storeSettings;
    stripeConfig = stripe;
  } catch (error) {
    unstable_rethrow(error);
    logger.error("pdp.degraded_render", {
      productSlug,
      recovery: `revalidateTag(${TAG.product(productSlug)})`,
      ...errorFields(error),
    });
    return <ProductTemporarilyUnavailable />;
  }

  // Display brand: the product's first brand term, with its logo from ONE
  // cached brand read per brand (`lib/product-brand.ts`). A product without
  // brand terms — every product on a store that has none, and every product
  // read through a theme that predates the `brands` selection — resolves null:
  // no logo slot, and JSON-LD names the STORE as the brand exactly as before.
  // The read cannot fail the page: it returns null on any error.
  const displayBrandTerm = resolveDisplayBrand(product.brands ?? []);
  const displayBrand = displayBrandTerm
    ? ((await getCachedProductBrand(displayBrandTerm.slug)) ?? {
        name: displayBrandTerm.name,
        slug: displayBrandTerm.slug,
        logoUrl: null,
      })
    : null;
  const brandName = displayBrand
    ? displayBrand.name
    : resolveStoreName(storeSettings.name);
  const relatedAsProducts = product.related.map(mapRelatedToProduct);
  const upsellsAsProducts = product.upsells.map(mapRelatedToProduct);
  const bundlesAsProducts = (product.includedInBundles ?? []).map(
    mapRelatedToProduct,
  );
  const featuredProjects = (product.projects ??
    []) as ProjectSummaryFieldsFragment[];

  // One canonical path per product, resolved from the product itself — so both
  // routes that render this component emit the SAME links, JSON-LD `url` and
  // crumb hrefs regardless of which URL shape was requested.
  const canonicalBasePath = productPath(product);
  const canonicalPath = productPath(product, colorSlug);

  // Crumbs follow the product's own category ancestry (the chain inside its
  // permalink), each linked to the collection path that chain canonicalises to
  // — not `/collections/{first-category}`, which is the flat shape the
  // collection route now redirects away from. Names come from the product's
  // own category list where a slug matches; a chain segment the product does
  // not carry a name for is humanised rather than dropped, so the crumb trail
  // never skips a level.
  const categoryNameBySlug = new Map(
    (product.categories ?? []).map((category) => [
      category.slug,
      category.name,
    ]),
  );
  const categorySegments = productCategorySegments(product);
  const categoryCrumbs = categorySegments.map((segment, index) => ({
    name: categoryNameBySlug.get(segment) ?? formatOptionName(segment),
    href: collectionPathFromSegments(categorySegments.slice(0, index + 1)),
  }));

  // Fallback trail for a product whose permalink carries NO category ancestry
  // (a `/shop/{slug}` permalink, or a store on WooCommerce's default
  // `/product/` base). The product still lists categories, so the crumb is
  // recoverable — but only two things about it can go wrong, and both did:
  //
  //  1. WHICH category. `product.categories[0]` is order-dependent on the
  //     payload, the exact determinism rule `lib/canonical-path.ts` states for
  //     the canonical. The rule here is the smallest slug in UTF-16 CODE POINT
  //     order — deliberately not `localeCompare`, which reads the runtime's
  //     default ICU locale and so can order non-ASCII slugs differently on the
  //     build host and the serving host (WordPress permits UTF-8 term slugs and
  //     this fleet has Thai merchants). A code-point comparison is one value per
  //     product, identical on every render and in every environment. It is
  //     arbitrary but stable, which is what matters — and it affects only this
  //     crumb's LABEL, never the product's canonical URL, which is derived from
  //     the permalink alone.
  //  2. WHERE it links. `collectionPathFromSegments([slug])` is the FLAT
  //     `/collections/{slug}` shape, which the collection route 308s away from
  //     — so this one crumb costs an extra redirect hop when the category is
  //     nested. It is deliberately NOT resolved to the nested path here, and
  //     the reason is a cache-tag one rather than a URL one.
  //
  //     The only way to recover a nested path from a bare slug is the category
  //     tree (`collectionPathResolver`), which is a `"use cache"` entry carrying
  //     `cacheTag(TAG.collections)`. `ProductPageContent` is not itself inside a
  //     `"use cache"` scope, so that tag would propagate onto the ROUTE's cache
  //     entry — and WordPress fires `headkit:collections` on every
  //     product-CATEGORY term edit (`created_term` / `edited_term` /
  //     `delete_term` on `product_cat`). On a store using WooCommerce's default
  //     `/product/` permalink base `productCategorySegments` returns [] for
  //     EVERY product, so every PDP would take this branch and one category
  //     edit would purge every PDP on the store. That is the tag-welding hazard
  //     recorded in `lib/cache-tags.ts` ("NEVER a route/page tag"), and
  //     `block-editor.tsx` gates its own read of the same resolver for the same
  //     reason.
  //
  //     CORRECTED 2026-09-17: this comment (and the same claim in
  //     `apps/starter/AGENTS.md`) used to say the tag fires on ANY PRODUCT or
  //     category change, which would have made one stock save a store-wide PDP
  //     purge. No product hook reaches `HK_TAG_COLLECTIONS` — the product
  //     builder sends the SINGULAR `headkit:collection:{slug}`, and only on a
  //     listing event. Measured in `lib/wp-revalidation-events.test.ts`; the
  //     trigger is rarer than recorded, the welding is not.
  //
  //     A whole-catalogue purge is far more expensive than one crumb href that
  //     308s to the canonical anyway, so the flat path wins here.
  //
  //     STATE THE SCOPE HONESTLY, because it is not small. This is a DELIBERATE
  //     exception to invariants 3 and 4 of the canonical decision (every
  //     internal link, and every Breadcrumb JSON-LD item, names the canonical).
  //     On a store using WooCommerce's default `/product/` permalink base it is
  //     not a rare degraded path — it is EVERY PDP BREADCRUMB ON THAT STORE
  //     CLASS, in the rendered link and in the JSON-LD alike. It costs one
  //     extra redirect hop per crumb; a crawler following it still reaches the
  //     canonical by a permanent redirect, which is why the trade was taken.
  //     The alternatives were a whole-catalogue purge tag on every PDP, or
  //     failing the whole page when the tree read fails.
  //
  //     Do not "fix" this back to `collectionPathResolver`. That is the change
  //     this comment exists to stop, and it reintroduces exactly the purge the
  //     trade was made to avoid. `app/products/[...slug]/page.test.ts` and
  //     `AGENTS.md` both record it.
  //
  //     The ROUTINE path on a nested-permalink store is unaffected: a product
  //     whose permalink carries ancestry gets the nested `categoryCrumbs`
  //     above, derived from the permalink alone with no tree read and no tag.
  const fallbackCategory =
    categoryCrumbs.length === 0 && product.categories?.length
      ? [...product.categories].sort((a, b) =>
          a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
        )[0]!
      : null;
  const fallbackCrumbs = fallbackCategory
    ? [
        {
          name: fallbackCategory.name,
          href: collectionPathFromSegments([fallbackCategory.slug]),
        },
      ]
    : [];

  const breadcrumbs = [
    { name: "Home", href: "/" },
    SHOP_BREADCRUMB,
    // A product with neither ancestry nor categories still gets a coherent
    // trail (Home / Shop / product) rather than an empty or `undefined` segment.
    ...(categoryCrumbs.length > 0 ? categoryCrumbs : fallbackCrumbs),
    {
      name: stripTitleMarkers(product.name),
      href: canonicalPath,
    },
  ];

  const breadcrumbItems = breadcrumbs.map((b, i) => ({
    name: b.name,
    uri: b.href,
    current: i === breadcrumbs.length - 1,
  }));

  // No boundary: `ProductStock` reads the same cached product entry this page
  // rendered from, so it is prerendered inline with the price beside it.
  // Inventory is the dynamic hole. cacheLife("seconds") is excluded from the
  // prerender, so this fallback is in the static shell and the line streams
  // at request time. The boundary is the stock line, not the product.
  const stockSlot = (
    <Suspense fallback={<AvailabilityLineFallback />}>
      <ProductStock
        productSlug={productSlug}
        {...(colorSlug !== undefined ? { colorSlug } : {})}
      />
    </Suspense>
  );

  const themeCopy = getStoreTheme().copy;
  const bundlesCopy = resolveSectionCopy(themeCopy, "pdpBundles", {
    title: "Available in bundles",
  });
  const relatedCopy = resolveSectionCopy(themeCopy, "pdpRelated", {
    title: "Something similar",
  });

  const swatchImagesEnabled = experimentalSwatchImagesEnabled();
  return (
    <SwatchImageProvider
      enabled={swatchImagesEnabled}
      {...(swatchImagesEnabled
        ? {
            promise: loadSwatchImageMap([
              product,
              ...relatedAsProducts,
              ...upsellsAsProducts,
              ...bundlesAsProducts,
            ]),
          }
        : {})}
    >
    <div>
      <ProductJsonLD
        product={product}
        brandName={brandName}
        url={storefrontUrl(canonicalBasePath, storeSettings.domain)}
      />
      <BreadcrumbJsonLD items={breadcrumbs} />

      <div className="px-5 py-8 md:px-10">
        <ProductDetail
          product={product}
          {...(colorSlug !== undefined ? { initialColor: colorSlug } : {})}
          productBasePath={canonicalBasePath}
          breadcrumbItems={breadcrumbItems}
          stockSlot={stockSlot}
          stripeConfig={stripeConfig}
          multiAddEnabled={branding.multiAddEnabled}
          pdpGalleryLayout={branding.pdpGalleryLayout}
          brand={displayBrand}
          shopifyContact={
            isShopifyStorefront(env) && getStoreTheme().layout.productEnquiry
          }
        />
      </div>

      {featuredProjects.length > 0 ? (
        <section className="overflow-hidden py-10">
          <SectionHeader
            title="Featured in projects"
            description="See this product in real projects."
            allButton="View All"
            allButtonPath="/projects"
            className="px-5 md:px-10"
          />
          <div className="mt-5">
            <ProjectCarousel projects={featuredProjects} imageAspect="video" />
          </div>
        </section>
      ) : null}

      {upsellsAsProducts.length > 0 && (
        <section className="overflow-x-clip py-10">
          <SectionHeader
            title="You might also like…"
            description=""
            className="px-5 md:px-10"
          />
          <div className="mt-5">
            <ProductCarousel
              products={upsellsAsProducts}
              id="upsell-products"
            />
          </div>
        </section>
      )}

      <div className="headkit-pdp-beside-bundles">
        <PdpBesideBundles />
        {bundlesAsProducts.length > 0 && (
          <section className="overflow-x-clip py-10">
            <SectionHeader
              title={bundlesCopy.title}
              description={bundlesCopy.description}
              allButton={bundlesCopy.allButton}
              allButtonPath={bundlesCopy.allButtonPath}
              className="px-5 md:px-10"
            />
            <div className="mt-5">
              <ProductCarousel
                products={bundlesAsProducts}
                id="bundle-products"
              />
            </div>
          </section>
        )}
      </div>

      {relatedAsProducts.length > 0 && (
        <section className="overflow-x-clip py-10">
          <SectionHeader
            title={relatedCopy.title}
            description={relatedCopy.description}
            allButton={relatedCopy.allButton}
            allButtonPath={relatedCopy.allButtonPath}
            className="px-5 md:px-10"
          />
          <div className="mt-5">
            <ProductCarousel
              products={relatedAsProducts}
              id="related-products"
            />
          </div>
        </section>
      )}
    </div>
    </SwatchImageProvider>
  );
}

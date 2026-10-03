import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import type { ProductCategoryDetail } from "@headkit/sdk";
import { headkit as sdk } from "@/lib/sdk";
import {
  paramsFromPlanPaths,
  readProductPrerenderPlan,
} from "@/lib/product-prerender-plan";
import { getBranding } from "@/lib/branding";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { TAG } from "@/lib/cache-tags";
import {
  generateMetadata as productMetadata,
  ProductPageBody,
} from "@/app/products/[...slug]/page";
import { ProductPageShell } from "@/app/products/[...slug]/product-page-shell";
import { CollectionRoute } from "@/app/collections/[...slug]/page";
import { collectionPathFromCategory } from "@/components/headkit-ui/collection/utils";
import {
  productColourSlugs,
  productPath,
  productShopSegments,
} from "@/lib/canonical-path";
import { getCachedProduct } from "@/lib/product-cache";
import {
  resolveShopPath,
  SHOP_PATH_PREFIX,
  type ShopProductCandidate,
} from "../shop-slug";

// Cache Components requires generateStaticParams to return ≥1 param. When the
// catalog API is unreachable at build we emit this single placeholder (which
// generateMetadata/the page resolve to noindex/notFound) instead of throwing —
// a transient backend error must not fail the whole tenant deploy. Mirrors the
// pattern in app/products/[...slug]/page.tsx.
const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

const NOINDEX: Metadata = { robots: { index: false, follow: false } };

/** The `/products/[...slug]` params a candidate reading delegates to. */
function candidateParams(candidate: ShopProductCandidate): string[] {
  return candidate.colourSlug !== undefined
    ? [candidate.productSlug, candidate.colourSlug]
    : [candidate.productSlug];
}

/** A candidate reading that survived, with the product the probe resolved. */
interface AcceptedProduct {
  candidate: ShopProductCandidate;
  product: NonNullable<Awaited<ReturnType<typeof getCachedProduct>>>;
}

/**
 * Resolve the requested path to the product it really names, or null.
 *
 * `resolveShopPath` is pure and has no catalogue access by design, so it hands
 * back READINGS in priority order and the choice between them is made here,
 * where a product can actually be looked up.
 *
 * Two acceptance rules, and the difference between them is the whole point:
 *
 *  - `ancestryValidated` — every segment ahead of the slug was matched against
 *    the category tree, so existence is enough. Serving it without comparing
 *    permalinks is REQUIRED, not lax: a product filed in two categories is
 *    reachable under either chain and the decision deliberately serves both,
 *    consolidating them by canonical rather than by a redirect.
 *  - otherwise — a containment guess about a truncated tree. Existence proves
 *    nothing there, so the product's OWN permalink must reproduce the requested
 *    path exactly. That single comparison is what keeps `/shop/junk/junk/{real}`
 *    answering not-found instead of 200, and what stops `…/{slug}/{colour}`
 *    resolving to an unrelated product that happens to be slugged like a colour.
 *    The permalink is the authority precisely where the tree is not — the same
 *    determinism rule the canonical itself rests on, one level down.
 *
 * `getCachedProduct` is the shared `"use cache"` entry both PDP routes read, so
 * a probe costs a cached lookup — and the product the accepted probe resolved
 * is handed back with it, so the route renders the very object it verified
 * rather than reading again below a boundary.
 *
 * Null means no reading survived: the caller answers not-found / noindex.
 */
async function resolveShopProduct(
  slug: readonly string[],
  candidates: readonly ShopProductCandidate[],
): Promise<AcceptedProduct | null> {
  const requestedPath = `/${SHOP_PATH_PREFIX}/${slug.join("/")}`;

  for (const candidate of candidates) {
    const product = await getCachedProduct(candidate.productSlug);
    if (!product) continue;
    if (candidate.ancestryValidated) return { candidate, product };
    if (productPath(product, candidate.colourSlug) === requestedPath) {
      return { candidate, product };
    }
  }
  return null;
}

type Props = {
  params: Promise<{ slug: string[] }>;
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | undefined;
};

/**
 * Nested shop route — D-15-04, replacing the permanent redirect to
 * `/products/{slug}`.
 *
 * WordPress mints WooCommerce product permalinks as `/shop/{cat}[/{sub}]/{slug}`
 * and those are the URLs live stores have indexed. The replaced implementation
 * answered every such URL with a 308 to a flat path. Two problems:
 *
 *  1. A 308 is cached by clients indefinitely, so it is the one act in a
 *     migration that a rollback cannot undo — after a flip back, those clients
 *     keep requesting a path the old stack never served.
 *  2. It took `slug[slug.length - 1]` unconditionally and so could not tell a
 *     product slug from a category slug, redirecting category URLs into a
 *     product route that answered not-found (RESEARCH C-6) — live for every
 *     store on this template, not just the migrating one.
 *
 * This route therefore serves real pages: `resolveShopPath` decides
 * category-vs-product from the category tree, and rendering is delegated to the
 * existing flat-PDP and collection views so the compositions cannot drift.
 *
 * Since the 2026-08-22 canonical decision this namespace is also the WINNER for
 * products: `/products/{slug}` now 308s here, every internal link is built from
 * the same `productPath`, and colourway URLs moved here too
 * (`/shop/{cat…}/{slug}/{colour}`).
 *
 * This route still issues NO permanent redirect of its own. Two URL shapes it
 * serves are not canonical, and both consolidate by canonical tag alone:
 *
 *  - a product filed in two categories, reached under the chain that is not the
 *    one in its permalink;
 *  - a category archive, whose one canonical is its `/collections/…` path.
 *
 * Neither was named by the decision, which spent its 308s on the flat
 * `/products/{slug}` and `/collections/{child}` shapes. A 308 is the single act
 * a rollback cannot undo (point 1 above), so it is spent only where the
 * decision asked for it.
 */

/**
 * Category tree for path classification.
 *
 * Deliberately NOT wrapped in a catch: the SDK returns null/empty for genuinely
 * absent data, so a THROWN error is transport/infra. Swallowing it would leave
 * an empty tree, which classifies every nested PDP as unknown and bakes a
 * sticky 404 into the route cache. Let it propagate — Next then serves the last
 * good render and retries. Same rationale as app/collections/[...slug]/page.tsx.
 */
async function getShopCategoryTree(): Promise<ProductCategoryDetail[]> {
  "use cache";
  // FINITE IN BOTH PROFILES. This read classifies a path, so it decides the
  // route's status code, and the aggressive profile therefore stops at `days`
  // rather than `max` — a cached-empty tree at `max` would pin a 404 on every
  // nested PDP until the next deploy. `lib/cache-profile.ts` has the rule;
  // `lib/cache-profile-call-sites.test.ts` pins it.
  cacheLifeForProfile("hours", "days");
  cacheTag(TAG.collections);
  return sdk.collections.getCategories();
}

/** Category detail for the category branch's metadata. Reuses the collection tags. */
async function getShopCategory(
  slug: string,
): Promise<ProductCategoryDetail | null> {
  "use cache";
  // Finite in both profiles alongside `getShopCategoryTree`, for a narrower
  // reason: this one feeds no status code, only `generateMetadata`, where a
  // cached null returns NOINDEX. At `max` one transient null would deindex a
  // real category until the next deploy.
  cacheLifeForProfile("hours", "days");
  cacheTag(TAG.collection(slug), TAG.collections);
  return sdk.collections.getCategory(slug);
}

/**
 * Prerender the nested URL each product actually has, taken from the product's
 * own permalink — never a synthesised guess.
 *
 * Products whose permalink is not beneath `/shop` are skipped: this app has no
 * route that serves them, so prerendering them would manufacture 404s on every
 * store that uses a different WooCommerce permalink base. Those stores keep
 * exactly today's behaviour (placeholder only) and their flat PDPs are
 * unaffected.
 *
 * PRERENDER COVERAGE — both PDP routes ask the HeadKit API
 * (`lib/product-prerender-plan.ts`) and obey the same answer. `all` paginates
 * the catalogue. `on-demand` emits only the paths commerce named, or the
 * placeholder, and the rest is ISR. Which route is canonical still depends on
 * the store's permalink base:
 *
 *   NESTED-permalink store (`/shop/{cat…}/{slug}`) — THIS route is canonical.
 *   The flat route is the redirect shim and, when the plan is `all`, still
 *   prerenders one file per product so those 308s are built. It does not
 *   enumerate colourways: every one 308s here, and prerendering a redirect
 *   spends the build on the redirect class.
 *
 *   DEFAULT-permalink store (`/product/{slug}`) — `productShopSegments` returns
 *   null, so this route emits only the placeholder. The flat route is canonical
 *   and prerenders under the same plan.
 *
 * COLOURWAY PARAMS are built with the base param when the plan is `all`, from
 * the same `productColourSlugs` rule the sitemap uses. They are not a separate
 * env budget. A colourway resolves the same product as its base page, and a
 * build with the bulk prefetch serves that product from disk.
 */
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  // Same decision as the flat PDP. On-demand does not paginate: a nested
  // catalogue past the build ceiling is the deploy that dies at 45 minutes.
  const plan = await readProductPrerenderPlan(sdk.products);
  if (plan.mode !== "all") {
    const seeded = paramsFromPlanPaths(plan.paths, "shop");
    if (seeded.length > 0) return seeded;
    return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
  }

  const params: { slug: string[] }[] = [];

  try {
    let page = 1;
    let hasMore = true;

    // The plan already said this catalogue fits the build.
    while (hasMore) {
      const result = await sdk.products.list({}, page, 100);
      for (const product of result.products) {
        // The same derivation the canonical, the 308 target and the sitemap
        // use, so this route can only prerender URLs they name.
        const segments = productShopSegments(product);
        if (!segments) continue;
        params.push({ slug: segments });

        // One more param per colourway, from the SAME rule the sitemap
        // advertises them by. Reads nothing new: this loop already holds the
        // rows, and `products.list` is the byte-identical call the sitemap
        // makes with the same page size and pagination.
        for (const colourSlug of productColourSlugs(product)) {
          params.push({ slug: [...segments, colourSlug] });
        }
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
}: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return NOINDEX;

  try {
    const categories = await getShopCategoryTree();
    const resolved = resolveShopPath(slug, categories);

    if (resolved.kind === "product") {
      const accepted = await resolveShopProduct(slug, resolved.candidates);
      if (!accepted) return NOINDEX;

      // Delegate to the flat PDP's own metadata, exactly as the page delegates
      // rendering. It resolves the canonical from `productPath(product, …)`,
      // which is the NESTED path — taken from the PRODUCT, never from the
      // requested URL. A product filed in two categories is reachable under
      // either chain; deriving the canonical from the request would make each
      // reachable chain declare itself an original, the same split under a new
      // name. Delegating also means a colourway URL keeps the `Name – Colour`
      // title, the variant OG image and the noindex-an-invalid-colour rule
      // rather than acquiring a thinner copy here.
      return productMetadata({
        params: Promise.resolve({ slug: candidateParams(accepted.candidate) }),
      });
    }

    if (resolved.kind === "category") {
      const [category, { seoSettings, storeSettings }] = await Promise.all([
        getShopCategory(resolved.categorySlug),
        getBranding(),
      ]);
      if (!category) return NOINDEX;

      return await makeSeoMetadata(category.seo ?? null, {
        title: category.name,
        // A category archive's canonical is its `/collections/…` path, never
        // this `/shop/…` one: `app/sitemap.ts` advertises the collections
        // shape, and the collection view this route delegates to renders its
        // facet links there too. Naming this URL instead would leave a category
        // with two self-declared originals — the very split the product side of
        // this route exists to close. No redirect is issued: the captain's
        // decision names the flat `/collections/{child}` shape as the one that
        // 308s, and a 308 is the one act a rollback cannot undo, so a URL shape
        // the decision did not name is consolidated by canonical alone.
        canonical: storefrontUrl(
          collectionPathFromCategory(category),
          storeSettings.domain,
        ),
        ...(category.description ? { description: category.description } : {}),
        storeName: storeSettings.name ?? undefined,
        dashboardOgImageUrl: seoSettings.ogImageUrl ?? undefined,
        allowIndexing: seoSettings.allowIndexing,
        siteUrl: storeSettings.domain,
      });
    }

    // index / unknown: not a URL this route represents.
    return NOINDEX;
  } catch (error) {
    unstable_rethrow(error);
    return NOINDEX;
  }
}

/**
 * `params` are URL data. Next.js will not put them in the shared App Shell
 * unless this read sits inside Suspense and the product read is `"use cache"`.
 * Awaiting them in the page itself is what left every unvisited product on
 * the `loading.tsx` skeleton: the prefetch was the shell, and the body was a
 * cold server render.
 *
 * https://nextjs.org/docs/app/guides/adopting-partial-prefetching#move-url-data-behind-suspense
 * https://nextjs.org/docs/app/guides/optimizing-prefetching
 *
 * `loading.tsx` stays. It is the instant fallback while this child is not
 * ready. `generateStaticParams` plus `prefetch={true}` on the product card is
 * what makes the child a static-cache hit instead of that fallback.
 *
 * `notFound()` in this child is already inside `loading.tsx`, so a missing
 * product is a soft 404. That is the trade for keeping the loading fallback.
 */
export const instant = true;

export default function Page(props: Props): ReactNode {
  return (
    <Suspense fallback={<ProductPageShell />}>
      <ShopRoute params={props.params} />
    </Suspense>
  );
}

export async function ShopRoute({
  params,
}: {
  params: Props["params"];
}): Promise<ReactNode> {
  // Pre-commit gate. This route DELEGATES rendering to the PDP and collection
  // views, so it must make their existence decision here rather than let them
  // 404 mid-stream — and making it means the whole decision, not just the
  // classification: `resolveShopPath` reads `/shop/{slug}` as a PRODUCT
  // candidate (see `shop-slug.test.ts`), so an unknown one-segment path only
  // fails once `resolveShopProduct` has probed every candidate and found none.
  // Every probe is a `"use cache"` `getCachedProduct` read.
  //
  // The `category` branch needs no lookup: a path only classifies as a category
  // by already matching the tree that was just read.
  //
  // The build-time placeholder param 404s HERE. It is never served from a
  // prerender, so skipping the gate for it would send a runtime request down
  // into a `notFound()` below the boundary — the soft 404 this gate closes.
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) notFound();
  // Not caught, deliberately — same rule as `getShopCategoryTree`: a thrown
  // read is transport/infra and must propagate, never become a sticky 404.
  const resolved = resolveShopPath(slug, await getShopCategoryTree());
  if (resolved.kind === "index" || resolved.kind === "unknown") notFound();

  if (resolved.kind === "product") {
    const accepted = await resolveShopProduct(slug, resolved.candidates);
    if (!accepted) notFound();

    // Cached product body. This child does not await `searchParams`, so the
    // prerender can finish `getCachedProduct` into the static segment while
    // the page-level Suspense keeps `params` out of the shared App Shell.
    // Colourway links come from `productPath`, the nested shape this route
    // serves.
    //
    // A chain that is reachable but is NOT the product's own permalink chain
    // (a product filed under two categories) is served here rather than
    // redirected: the canonical above already names the one original, and the
    // decision that put a 308 on the flat shapes did not name this one — a 308
    // is the single act a rollback cannot undo, so it is spent only where the
    // decision asked for it.
    //
    // A draft cannot reach this branch: the probe above is the PUBLIC read,
    // which a draft fails by construction, so this route never needs the
    // request-time preview branch the flat route keeps behind its boundary.
    return (
      <ProductPageBody
        product={accepted.product}
        productSlug={accepted.candidate.productSlug}
        colorSlug={accepted.candidate.colourSlug}
      />
    );
  }

  // Category: delegate to the collection view with the category's own
  // segments, so its facet links stay in the served /collections namespace
  // (see the export comment there). The canonical emitted by `generateMetadata`
  // above points at that same `/collections/…` path, NOT at this `/shop` URL —
  // a category archive served here is a duplicate that consolidates by
  // canonical tag, which is why the two agree on the collections shape.
  //
  // This branch has NO boundary, on purpose. `CollectionRoute` reads no
  // `searchParams` — its heading and page-1 grid come from `"use cache"` reads
  // keyed by the path — so it renders in the static shell, where a JS-off
  // shopper and a non-rendering crawler can see the products. A `<Suspense>`
  // here would put all of it back in a hidden segment: React outlines any
  // completed boundary over 500 bytes, and one product card is ~4.3 KB. The
  // full contract is on `CollectionProductsShell`
  // (`app/collections/[...slug]/page.tsx`); `page.composition.test.tsx` guards
  // both halves of it.
  return (
    <CollectionRoute params={Promise.resolve({ slug: resolved.segments })} />
  );
}

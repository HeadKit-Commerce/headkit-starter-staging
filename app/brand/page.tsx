import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import { collectAllBrands, type BrandWalk } from "@/lib/brand-list";
import { BrandPage } from "@/components/headkit-ui/brand/brand-page";
import { BrandHeader } from "@/components/headkit-ui/brand/brand-header";
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
      title: "Brands",
      alternates: {
        canonical: storefrontUrl("/brand", storeSettings.domain),
      },
    };
  } catch {
    return {
      title: "Brands",
      alternates: { canonical: storefrontUrl("/brand") },
    };
  }
}

/**
 * EVERY brand, on one crawlable page — not page 1 of an unpaginated list.
 *
 * This read was `sdk.brands.list()` with no arguments until 2026-10-01. The
 * SDK's `perPage` default is 24, so the index rendered 24 brands with no page
 * control and no sign anything was missing: measured on the Bike Society
 * rehearsal store, `/brand` served 24 of the 110 brands `sitemap.xml`
 * advertised, stopping alphabetically at `campagnolo`.
 *
 * WALK, DO NOT PAGINATE. `?page=` on `/shop` and on the PLPs is applied in the
 * BROWSER by `CollectionProvider`'s mount effect and is neither canonical nor
 * in the sitemap, so there is no existing convention for a crawlable paginated
 * URL to follow — adding one here would be a second convention, and would split
 * this route's single `headkit:brands` entry into per-page entries that purge
 * independently. The convention that does exist for "a list a crawler must see
 * whole" is the brand walk itself, which `app/sitemap.ts` and
 * `app/brand/[...slug]`'s `generateStaticParams` already run;
 * `lib/brand-list.ts` is now the one copy of it and states its bound.
 *
 * CACHING IS UNCHANGED: still ONE entry, still `cacheLifeForProfile("weeks",
 * "max")`, still invalidated by the single `headkit:brands` tag the theme fires
 * on a `product_brand` term edit. The walk is inside the cached scope, so the
 * extra page reads are paid once per purge, not per request. `TAG.brands`
 * replaces the former inline literal so the tag cannot drift from the contract
 * in `lib/cache-tags.ts`.
 */
async function getBrands(): Promise<BrandWalk> {
  "use cache";
  // Brands change rarely; webhooks invalidate `headkit:brands`.
  cacheLifeForProfile("weeks", "max");
  cacheTag(TAG.brands);
  return collectAllBrands();
}

/**
 * The brand grid, rendered in the static shell — NO `<Suspense>` above it
 * anywhere on this route.
 *
 * It had one until 2026-10-01, wrapping content that performs no request-time
 * read at all, and that alone hid every card: a COMPLETED boundary over
 * React's 12,800-byte `progressiveChunkSize` is outlined into a hidden segment
 * plus a `$RC` swap even in a fully prerendered file, and one brand card is far
 * past that on its own. Measured on the deployed rehearsal store the same day:
 * all 24 cards sat after `<div hidden id="S:0">` at byte 49,458 of 183,930, so
 * a JS-off shopper and any crawler that does not run scripts saw the skeleton
 * and nothing else. The rule is stated once in "Cached content renders OUTSIDE
 * the boundary" in `apps/starter/AGENTS.md`; `/shop` and `/brand/[...slug]`
 * already follow it.
 */
async function BrandsGridShell() {
  const { brands, total, complete } = await getBrands();
  return <BrandPage brands={brands} total={total} complete={complete} />;
}

const BREADCRUMBS = [
  { name: "Home", uri: "/", current: false },
  { name: "Brands", uri: "/brand", current: true },
] as const;

/**
 * Instant Navigation (Next.js 16.3): sync default export, no Suspense boundary.
 * Both the header and the cached grid commit with the App Shell — this route
 * reads no `searchParams` and makes no request-time read, so the whole page
 * prerenders. Same shape as `app/shop/page.tsx`.
 * @see https://nextjs.org/docs/app/guides/instant-navigation
 */
export const instant = true;
// The finished document is prerendered. This fails the build if the
// route, or a layout above it, starts reading cookies, headers,
// searchParams, or connection(). The root layout stays unset.
export const ensureStatic = "navigation";

export default function Page() {
  return (
    <>
      <BrandHeader name="Brands" breadcrumbs={[...BREADCRUMBS]} />
      <BrandsGridShell />
    </>
  );
}

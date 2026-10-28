import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Generic CMS page cache guard (09.5-05, CACHE-04).
 *
 * Generic WP pages (`app/[...slug]`) were fully UNCACHED, so a WP
 * `headkit:page:{slug}` edit invalidated nothing. `getPageData` is now a
 * params-safe `use cache` helper: the slug is read OUTSIDE the cached scope
 * (in `Page`/`generateMetadata`) and passed in as a PLAIN STRING, so the
 * "cannot read params inside use cache" constraint (threat T-09.5-15) is never
 * tripped. This suite proves:
 *   - the cached fn tags `TAG.page(slug)` + `TAG.pages` at `cacheLife('days')`,
 *   - it takes a plain string arg (no `params`/`searchParams`/`cookies` inside),
 *   - null means MISS and only miss: an absent page resolves null (so `Page`
 *     can `notFound()` deterministically), while a thrown read PROPAGATES
 *     rather than being caught into a null that the cache entry would keep.
 *
 * `next/cache` is mocked to capture `cacheTag`/`cacheLife`; the SDK and the UI/
 * SEO components the page imports are stubbed so the module loads in node env.
 */

const cacheTag = vi.fn<(...tags: string[]) => void>();
const cacheLife = vi.fn<(profile: string) => void>();
const contentGet = vi.fn<(slug: string, type: string) => Promise<unknown>>();

vi.mock("next/cache", () => ({
  cacheTag: (...tags: string[]): void => cacheTag(...tags),
  cacheLife: (profile: string): void => cacheLife(profile),
}));

// The page module under test imports `@/lib/env` (for `isShopifyStorefront`),
// which parses `process.env` with Zod at import time and throws in a bare test
// process. A WooCommerce-shaped env: no Shopify domain, so every Shopify branch
// stays off and the assertions below describe the WooCommerce path.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: "pk_store",
    NEXT_PUBLIC_GRAPHQL_URL: "https://graph.example.test/graphql",
    HEADKIT_PRIVATE_KEY: "sk_store",
  },
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    content: {
      get: (slug: string, type: string): Promise<unknown> =>
        contentGet(slug, type),
    },
  },
}));

const makeSeoMetadata =
  vi.fn<(seo: unknown, fallback: unknown) => Record<string, unknown>>();
const allowIndexing = vi.fn<() => boolean>();
const storeDomain = vi.fn<() => string | null>();

vi.mock("@/lib/make-metadata", () => ({
  makeSeoMetadata: (seo: unknown, fallback: unknown): Record<string, unknown> =>
    makeSeoMetadata(seo, fallback),
  seoFallbackDescription: (): string => "",
  storefrontUrl: (path: string, domain?: string | null): string =>
    `https://${domain ?? "shop.example"}${path}`,
}));
// generateMetadata now reads the store's indexing switch; `lib/branding`
// validates server env at import, so it is stubbed like the SDK above.
vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      seoSettings: { allowIndexing: allowIndexing() },
      storeSettings: { domain: storeDomain() },
    }),
}));
vi.mock("@/components/seo/breadcrumb-json-ld", () => ({
  BreadcrumbJsonLD: (): null => null,
}));
vi.mock("@/components/headkit-ui/editorial-content", () => ({
  EditorialContent: (): null => null,
}));
vi.mock("@/components/headkit-ui/cms-page-body", () => ({
  CmsPageBody: (): null => null,
}));

import Page, { getPageData, generateMetadata } from "./page";

const SLUG = "about/team";
const EXPECTED_TAGS = ["headkit:page:about/team", "headkit:pages"] as const;

beforeEach(() => {
  cacheTag.mockClear();
  cacheLife.mockClear();
  contentGet.mockReset();
  contentGet.mockResolvedValue({ title: "About", content: "", seo: null });
  makeSeoMetadata.mockReset();
  makeSeoMetadata.mockReturnValue({});
  allowIndexing.mockReset();
  allowIndexing.mockReturnValue(true);
  storeDomain.mockReset();
  storeDomain.mockReturnValue(null);
});

describe("getPageData — params-safe cached CMS helper", () => {
  it("tags TAG.page(slug) and TAG.pages at cacheLife('days')", async () => {
    await getPageData(SLUG);
    expect(cacheTag).toHaveBeenCalledWith(...EXPECTED_TAGS);
    expect(cacheLife).toHaveBeenCalledWith("days");
    expect(cacheLife).not.toHaveBeenCalledWith("max");
  });

  it("takes a plain string arg — no runtime API inside use cache", async () => {
    // The cached fn receives an already-joined string and forwards it verbatim
    // to the SDK. It never reads params/searchParams/cookies itself: the caller
    // resolves the slug outside the cached scope and passes the value in.
    await getPageData(SLUG);
    expect(contentGet).toHaveBeenCalledWith(SLUG, "PAGE");
  });

  it("resolves null for a genuinely missing page (notFound-safe)", async () => {
    // `sdk.content.get` resolves null for a page that does not exist. That is
    // the ONLY null, and it is what the route's pre-commit gate turns into a
    // 404.
    contentGet.mockResolvedValueOnce(null);
    await expect(getPageData(SLUG)).resolves.toBeNull();
  });

  it("propagates a thrown read instead of caching it as a miss", async () => {
    // The regression this closes: a blanket `.catch(() => null)` sat INSIDE the
    // `"use cache"` scope, so one gateway blip on a cold `/about` wrote null
    // into the cache entry and the hoisted gate turned it into a real 404 —
    // held for `cacheLife("days")`, self-healing only on a tag purge. The
    // sibling gated routes (`app/brand`, `app/collections`, `app/shop`) state
    // this invariant at their own gates; this route's shape hid it.
    // `/wholesale` shares this helper and inherits the fix.
    const transportFailure = new Error("gateway unreachable");
    contentGet.mockRejectedValueOnce(transportFailure);
    await expect(getPageData(SLUG)).rejects.toBe(transportFailure);
  });
});

/**
 * Every WordPress page — `/about`, `/legal/*`, the marketing landing pages —
 * is served by this route, and it passed NEITHER a canonical NOR the store's
 * indexing switch. Yoast's own canonical names the WordPress backend host, and
 * an omitted `allowIndexing` used to default to "index" and override the root
 * layout, so a store with search engines switched off still published these.
 */
describe("generateMetadata — canonical + indexing switch", () => {
  async function fallbackFor(slug: string[]): Promise<Record<string, unknown>> {
    await generateMetadata({ params: Promise.resolve({ slug }) });
    const call = makeSeoMetadata.mock.calls[0];
    return (call?.[1] ?? {}) as Record<string, unknown>;
  }

  it("passes a self-referencing canonical built from the served path", async () => {
    const fallback = await fallbackFor(["legal", "privacy-policy"]);
    expect(fallback["canonical"]).toBe(
      "https://shop.example/legal/privacy-policy",
    );
  });

  it("forwards the store's allowIndexing rather than defaulting to index", async () => {
    allowIndexing.mockReturnValue(false);
    const fallback = await fallbackFor(["about"]);
    expect(fallback["allowIndexing"]).toBe(false);
  });

  it("forwards allowIndexing when the store has indexing on", async () => {
    const fallback = await fallbackFor(["about"]);
    expect(fallback["allowIndexing"]).toBe(true);
  });

  it("builds the canonical from the runtime store domain, not the baked env", async () => {
    // A custom domain attached without a redeploy leaves the inlined
    // NEXT_PUBLIC_FRONTEND_URL on the old host. robots.txt and the sitemap
    // already prefer the runtime domain, so a canonical that did not would
    // point the sitemap's own URLs at a host it never advertises.
    storeDomain.mockReturnValue("customer.com");
    const fallback = await fallbackFor(["about"]);
    expect(fallback["canonical"]).toBe("https://customer.com/about");
    // Forwarded so the same origin decides whether Yoast's canonical is
    // same-host, and so metadataBase agrees with the canonical.
    expect(fallback["siteUrl"]).toBe("customer.com");
  });
});

/**
 * Asset-like paths (old WordPress image URLs, bot probes) must 404 BEFORE the
 * CMS read — `lib/catch-all-slug-guard.ts`. Commerce decodes whatever
 * WordPress returns for that path without a content-type check, so an image
 * body or a 403 throws a decode error and the shopper gets a 500, not a 404.
 */
describe("asset-like slugs never reach the CMS read", () => {
  it("generateMetadata noindexes without calling the content loader", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: ["wp-content", "uploads", "2019", "photo.jpg"],
      }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(contentGet).not.toHaveBeenCalled();
  });

  it.each([
    [["wp-content", "x"]],
    [["wp-admin"]],
    [[".well-known", "x"]],
    [["favicon-96x96.png"]],
  ])("Page() 404s %j without calling the content loader", async (slug) => {
    await expect(Page({ params: Promise.resolve({ slug }) })).rejects.toThrow();
    expect(contentGet).not.toHaveBeenCalled();
  });

  it("still serves a genuine nested CMS slug with no extension", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["legal", "privacy-policy"] }),
    });
    expect(contentGet).toHaveBeenCalledWith("legal/privacy-policy", "PAGE");
    expect(metadata.robots).toBeUndefined();
  });
});

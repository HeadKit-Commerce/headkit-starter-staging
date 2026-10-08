import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    products: { list: vi.fn(), get: vi.fn() },
    collections: {
      list: vi.fn(),
      getCategories: vi.fn(async () => []),
      getFilters: vi.fn(async () => ({ attributes: [] })),
    },
    brands: { list: vi.fn(async () => ({ brands: [] })) },
    posts: {
      list: vi.fn(async () => ({ posts: [] })),
      // sitemap() → getPostsBasePath() → posts.getLanding(); `null` is the
      // unset-Posts-page case and falls back to DEFAULT_POSTS_BASE_PATH.
      getLanding: vi.fn(async () => null),
    },
    projects: { list: vi.fn(async () => ({ projects: [] })) },
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  // Real `unstable_rethrow` only rethrows Next control-flow errors. A branding
  // rejection is an ordinary Error and must stay in robots()'s catch so the
  // store switch fails closed.
  unstable_rethrow: (): void => {},
}));

const SITE_URL = "https://shop.example";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_FRONTEND_URL: "https://shop.example" },
}));

// Mutable per test — robots() decides on the request Host header first.
let requestHost = "shop.example";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: requestHost })),
}));

import { headers } from "next/headers";
import { getBranding, type Branding } from "@/lib/branding";
import sitemap from "./sitemap";
import robots from "./robots";
import { makeRootMetadata, resolveRobots } from "@/lib/make-metadata";
import { hostRobotsTag } from "@/lib/host-robots";

const mockedGetBranding = vi.mocked(getBranding);

const stubBranding: Branding = {
  primaryColor: "#000",
  secondaryColor: "#fff",
  backgroundColor: "#ffffff",
  textColor: "#171717",
  logoUrl: null,
  iconUrl: null,
  headingFont: {
    source: "",
    family: "",
    googleSlug: "",
    fileUrl: "",
    googleWeights: [],
    googleItalic: false,
    italicFileUrl: "",
  },
  subheadingFont: {
    source: "",
    family: "",
    googleSlug: "",
    fileUrl: "",
    googleWeights: [],
    googleItalic: false,
    italicFileUrl: "",
  },
  bodyFont: {
    source: "",
    family: "",
    googleSlug: "",
    fileUrl: "",
    googleWeights: [],
    googleItalic: false,
    italicFileUrl: "",
  },
  cornerStyle: "soft",
  pdpGalleryLayout: "grid",
  iconLibrary: "hi2",
  showVariants: true,
  showSwatches: false,
  imageRollover: false,
  hideEmptyCollections: true,
  defaultCollectionSort: "CREATED_AT",
  multiAddEnabled: false,
};

describe("sitemap enableSitemap gate", () => {
  beforeEach(() => {
    mockedGetBranding.mockReset();
  });

  it("returns empty array when enableSitemap is false", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: null,
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: false,
        allowIndexing: true,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });

    await expect(sitemap()).resolves.toEqual([]);
  });

  it("roots every loc under the runtime store domain when env still has the headkit host", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: "paralelfurniture.com.au",
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: true,
        allowIndexing: true,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });

    const { headkit } = await import("@/lib/sdk");
    vi.mocked(headkit.products.list).mockResolvedValue({
      products: [],
      totalPages: 0,
    } as never);

    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every((e) => e.url.startsWith("https://paralelfurniture.com.au")),
      "stale NEXT_PUBLIC_FRONTEND_URL must not win over Store.domain",
    ).toBe(true);
    expect(entries.some((e) => e.url.includes("headkit.app"))).toBe(false);
  });
});

const permissiveSeo = {
  branding: stubBranding,
  storeSettings: {
    id: null,
    slug: null,
    name: "Acme",
    gtmId: null,
    domain: null,
    checkoutType: null,
    cookieConsentEnabled: false,
    webmcpEnabled: false,
  },
  seoSettings: {
    title: null,
    description: null,
    ogImageUrl: null,
    enableSitemap: true,
    allowIndexing: true,
    indexNowEnabled: false,
    indexNowKey: null,
  },
} satisfies Awaited<ReturnType<typeof getBranding>>;

const DISALLOW_EVERYTHING = [{ userAgent: "*", disallow: "/" }];

describe("robots host gate (MIG-03)", () => {
  beforeEach(() => {
    mockedGetBranding.mockReset();
    requestHost = "shop.example";
  });

  it("disallows everything and omits the sitemap on a TEMP host even when branding reports both gates ENABLED", async () => {
    mockedGetBranding.mockResolvedValue(permissiveSeo);
    requestHost = "acme-rehearsal.vercel.app";

    const result = await robots();

    expect(
      result.rules,
      "the rehearsal host must serve Disallow: / regardless of branding — branding's default bundle is permissive and is returned on any failure",
    ).toEqual(DISALLOW_EVERYTHING);
    expect(
      result.sitemap,
      "the rehearsal host must not advertise a sitemap of the live catalogue",
    ).toBeUndefined();
  });

  it("disallows everything when the branding read THROWS — a failed read must close, not open", async () => {
    mockedGetBranding.mockRejectedValue(new Error("dashboard-api unreachable"));

    const result = await robots();

    expect(
      result.rules,
      "a thrown branding read must not fall through to the permissive ruleset",
    ).toEqual(DISALLOW_EVERYTHING);
    expect(
      result.sitemap,
      "no sitemap on a failed branding read",
    ).toBeUndefined();
  });

  it("still reads the request Host when the branding read THROWS", async () => {
    // The degraded branch must not become a path with no runtime input: a
    // render that consults nothing is one Next can statically prerender, and a
    // prerendered `Disallow: /` would then be served to the store's own LIVE
    // domain until the next deploy, with no per-request read to recover it.
    mockedGetBranding.mockRejectedValue(new Error("dashboard-api unreachable"));
    vi.mocked(headers).mockClear();

    await robots();

    expect(
      vi.mocked(headers),
      "every render of robots.txt must consume request data, including the degraded one",
    ).toHaveBeenCalled();
  });

  it("disallows everything when the Host header is absent", async () => {
    mockedGetBranding.mockResolvedValue(permissiveSeo);
    requestHost = "";

    const result = await robots();

    expect(
      result.rules,
      "a missing Host header is an unknown host and must fail closed",
    ).toEqual(DISALLOW_EVERYTHING);
  });

  it("INVERTS on the production host: permissive ruleset WITH the sitemap line", async () => {
    mockedGetBranding.mockResolvedValue(permissiveSeo);
    requestHost = "shop.example";

    const result = await robots();

    expect(
      result.rules,
      "the live host must stay indexable — a closed posture here costs the merchant their search presence",
    ).not.toEqual(DISALLOW_EVERYTHING);
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("robots allowIndexing + enableSitemap", () => {
  beforeEach(() => {
    mockedGetBranding.mockReset();
    requestHost = "shop.example";
  });

  it("Disallow all and omits sitemap when allowIndexing is false", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: null,
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: true,
        allowIndexing: false,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });

    const result = await robots();
    expect(result.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(result.sitemap).toBeUndefined();
  });

  it("omits Sitemap line when enableSitemap is false", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: null,
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: false,
        allowIndexing: true,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });

    const result = await robots();
    expect(result.sitemap).toBeUndefined();
    expect(Array.isArray(result.rules)).toBe(true);
  });

  it("advertises sitemap when enableSitemap and allowIndexing are true", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: null,
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: true,
        allowIndexing: true,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });

    const result = await robots();
    expect(result.sitemap).toBe("https://shop.example/sitemap.xml");
  });

  it("prefers the runtime store domain over a stale NEXT_PUBLIC_FRONTEND_URL", async () => {
    mockedGetBranding.mockResolvedValue({
      branding: stubBranding,
      storeSettings: {
        id: null,
        slug: null,
        name: "Acme",
        gtmId: null,
        domain: "paralelfurniture.com.au",
        checkoutType: null,
        cookieConsentEnabled: false,
        webmcpEnabled: false,
      },
      seoSettings: {
        title: null,
        description: null,
        ogImageUrl: null,
        enableSitemap: true,
        allowIndexing: true,
        indexNowEnabled: false,
        indexNowKey: null,
      },
    });
    requestHost = "paralelfurniture.com.au";

    const result = await robots();

    expect(result.host).toBe("https://paralelfurniture.com.au");
    expect(result.sitemap).toBe("https://paralelfurniture.com.au/sitemap.xml");
    expect(result.rules).not.toEqual(DISALLOW_EVERYTHING);
  });
});

/**
 * ENG-868 / ENG-876: robots.txt and the PAGE's own directive must never disagree.
 *
 * They used to, by construction — robots.txt consulted the request HOST while
 * the meta consulted `VERCEL_ENV`. A rehearsal storefront is a Vercel
 * *production* deployment on a temporary host, so it served `Disallow: /`
 * beside pages that said `index, follow`. `Disallow` is a CRAWL directive: a
 * URL discovered by a link can still be indexed, and the page's own directives
 * are what invite it. So the agreement is asserted directly, not per side.
 *
 * The page side is now TWO signals, not one: the store switch in the `robots`
 * meta and the host gate in the `X-Robots-Tag` header `proxy.ts` sets.
 * `pageIndexes` below composes both, because asserting the meta alone would now
 * pass on a rehearsal host — the exact disagreement this block exists to forbid.
 */
describe("robots.txt and the page's own directive agree", () => {
  beforeEach(() => {
    mockedGetBranding.mockReset();
    requestHost = "shop.example";
    // The case that used to wave the meta through on a rehearsal host.
    process.env.VERCEL_ENV = "production";
  });

  /** True when robots.txt permits crawling at all (no blanket `Disallow: /`). */
  function robotsTxtIndexes(
    result: Awaited<ReturnType<typeof robots>>,
  ): boolean {
    return !Array.isArray(result.rules)
      ? false
      : JSON.stringify(result.rules) !== JSON.stringify(DISALLOW_EVERYTHING);
  }

  /**
   * True when the PAGE invites indexing — the meta AND the header, composed the
   * way a crawler composes them (most restrictive wins). `requestHost` is the
   * same variable `robots()` reads through the mocked `headers()`, so both
   * sides of every assertion below are judging the same request.
   */
  function pageIndexes(allowIndexing: boolean): boolean {
    const meta = resolveRobots(allowIndexing);
    const metaIndexes =
      typeof meta === "object" &&
      meta !== null &&
      meta.index === true &&
      meta.follow === true;
    return metaIndexes && hostRobotsTag(SITE_URL, requestHost) === null;
  }

  it("both refuse on a non-indexable host even when allowIndexing is true", async () => {
    mockedGetBranding.mockResolvedValue(permissiveSeo);
    requestHost = "acme-rehearsal.headkit.app";

    const txt = robotsTxtIndexes(await robots());
    const page = pageIndexes(true);

    expect(txt).toBe(false);
    expect(page, "the page must not invite indexing robots.txt refuses").toBe(
      txt,
    );
  });

  it("both refuse on an indexable host when allowIndexing is false", async () => {
    mockedGetBranding.mockResolvedValue({
      ...permissiveSeo,
      seoSettings: { ...permissiveSeo.seoSettings, allowIndexing: false },
    });

    const txt = robotsTxtIndexes(await robots());
    const page = pageIndexes(false);

    expect(txt).toBe(false);
    expect(page, "the store switch must close both signals").toBe(txt);
  });

  it("both allow on an indexable host when allowIndexing is true", async () => {
    mockedGetBranding.mockResolvedValue(permissiveSeo);

    const txt = robotsTxtIndexes(await robots());
    const page = pageIndexes(true);

    expect(txt).toBe(true);
    expect(page, "only both inputs agreeing opens indexing").toBe(txt);
  });

  it("both refuse when the branding read throws and the switch is unknown", async () => {
    // The degraded branch of app/layout.tsx and app/page.tsx: getBranding()
    // threw, so the store's switch cannot be read. robots.txt answers that with
    // `Disallow: /`, and the meta must not answer it with `index, follow`.
    // `siteUrl` is supplied and the request host matches it, so the HOST gate
    // is satisfied — the unknown switch is then the only thing left to close
    // the page, which is the point.
    mockedGetBranding.mockRejectedValue(new Error("dashboard-api unreachable"));

    const txt = robotsTxtIndexes(await robots());
    const degraded = await makeRootMetadata({
      siteName: "Store",
      siteUrl: SITE_URL,
    });

    expect(txt).toBe(false);
    expect(
      degraded.robots,
      "an unknown store switch must not open indexing robots.txt refuses",
    ).toEqual({ index: false, follow: false });
  });
});

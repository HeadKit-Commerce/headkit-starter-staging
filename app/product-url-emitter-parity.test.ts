import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, Suspense } from "react";

/**
 * THREE EMITTERS, ONE SET — the guard the brand-pagination fixes and the
 * colourway prerender all exist because of.
 *
 * A URL class has two independent emitters that must name exactly the same
 * strings: `app/sitemap.ts` says which URLs exist, and a route's
 * `generateStaticParams` says which get built. Nothing bound them together, and
 * `/brand/{slug}` drifted silently: the sitemap walked `headkit/v2/brands` to
 * completion via `collectListPages` while `app/brand/[...slug]` read page 1 and
 * stopped, so every brand past the first 100 was advertised and never built and
 * charged its first visitor a cold render.
 *
 * The brand INDEX is the THIRD reader of that endpoint, and it was the same
 * defect in its plainest form: `app/brand/page.tsx` called `sdk.brands.list()`
 * with no arguments at all, so the SDK's `perPage` default of 24 decided how
 * many brands a shopper could reach. On the store above that was 24 of 110,
 * with no page control and no notice. The index does not emit URLs, so it is
 * compared on the LINKS it renders rather than on params.
 *
 * WHAT THIS COVERS: set equality between the emitters' OUTPUT for the `/brand`
 * family — the sitemap, the route's params and the index's rendered links —
 * driven through ONE fixture catalogue so a change that teaches one emitter a
 * rule and not the other fails here; plus the two fallbacks the brand walk owns
 * (an unreachable endpoint still yields a param; a mid-walk failure keeps what
 * it already collected).
 *
 * WHAT IT DOES NOT COVER, and none of these is implied by a green run:
 *
 *   - Unconditional equality for the `/shop` COLOURWAY family, because whether
 *     those URLs are built is now a per-store BUDGET rather than an open gap
 *     (`HEADKIT_PRERENDER_PRODUCT_COLOURWAYS`, `lib/prerender-budget.ts`), and
 *     its platform default is ZERO. Both ends are asserted instead: at the
 *     default, every `/shop` param the build emits is a URL the sitemap
 *     advertises (no build effort spent on a URL nothing links to) and the
 *     colourway URLs are the advertised-only remainder; with the budget open,
 *     the two sets are EQUAL. What stays shared in both is the RULE —
 *     `productColourSlugs` in `lib/canonical-path.ts` — which is the thing a
 *     second copy would break.
 *   - Whether either set is CORRECT. Both emitters reading the same wrong rule
 *     is a green run. `app/sitemap.test.ts` owns the sitemap's own rules and
 *     `app/canonical-url-shape.test.tsx` owns the canonical shape.
 *   - Whether any of these URLs RENDERS, answers 200, or is prerendered by a
 *     real build. This calls two functions; it starts no build and makes no
 *     request. `e2e/not-found-status.spec.ts` asserts live status codes.
 *   - Build DURATION or origin-read cost. No unit test can see either.
 *   - The `/collections` facet family, deliberately: the sitemap advertises
 *     facet URLs the build does not prerender, because each one costs an
 *     origin-paced catalogue read. Asserting parity there would fail a decision
 *     that was taken deliberately. `app/collections/[...slug]/page.test.ts` pins
 *     that seed's shape instead.
 *   - Any other route family. `/news`, `/projects` and `/client` are not read
 *     here.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

const { SITE_URL } = vi.hoisted(() => {
  const url = "https://shop.example.com";
  process.env.NEXT_PUBLIC_FRONTEND_URL = url;
  return { SITE_URL: url };
});

const productsList =
  vi.fn<(filter: unknown, page: number, perPage: number) => Promise<unknown>>();
const brandsList =
  vi.fn<(args: { page?: number; perPage?: number }) => Promise<unknown>>();

vi.mock("server-only", () => ({}));
vi.mock("@/sitemap.config", () => ({ storeSitemapRoutes: [] }));

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
  revalidateTag: (): void => {},
  updateTag: (): void => {},
}));

vi.mock("@/lib/cache-profile", () => ({
  cacheLifeForProfile: (): void => {},
}));

vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      seoSettings: { enableSitemap: true, allowIndexing: true },
      storeSettings: { name: "Acme", domain: null },
    }),
}));

vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: (): Promise<unknown> =>
    Promise.resolve({
      publishableKey: "",
      accountId: "",
      bnplMessagingEnabled: false,
    }),
}));

vi.mock("@/lib/product-cache", () => ({
  getCachedProduct: (): Promise<null> => Promise.resolve(null),
  getProductForPage: (): Promise<null> => Promise.resolve(null),
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    products: {
      list: (
        filter: unknown,
        page: number,
        perPage: number,
      ): Promise<unknown> => productsList(filter, page, perPage),
    },
    brands: {
      list: (args: { page?: number; perPage?: number }): Promise<unknown> =>
        brandsList(args),
    },
    // Every other section is emptied so the sitemap under test carries only the
    // product and brand families this file compares.
    collections: {
      getCategories: (): Promise<unknown[]> => Promise.resolve([]),
      getFilters: (): Promise<unknown> => Promise.resolve({ attributes: [] }),
      getCategory: (): Promise<null> => Promise.resolve(null),
    },
    posts: {
      list: (): Promise<unknown> => Promise.resolve({ posts: [] }),
      getLanding: (): Promise<null> => Promise.resolve(null),
    },
    projects: {
      list: (): Promise<unknown> => Promise.resolve({ projects: [] }),
    },
    menu: { getMenus: (): Promise<unknown[]> => Promise.resolve([]) },
    content: { get: (): Promise<null> => Promise.resolve(null) },
  },
}));

import sitemap from "./sitemap";
import { generateStaticParams as shopParams } from "./shop/[...slug]/page";
import { generateStaticParams as brandParams } from "./brand/[...slug]/page";
import BrandIndexPage from "./brand/page";
import { BrandPage } from "@/components/headkit-ui/brand/brand-page";

/**
 * ONE fixture catalogue, shaped so both emitters read the same rows:
 *
 *  - a product with NO colourway and products with one and with several, plus a
 *    repeated colour option slug (both emitters must de-duplicate) and a
 *    non-colour attribute carrying option slugs (size must contribute no URL),
 *  - products spread over TWO pages (a walk that reads page 1 and stops fails),
 *  - a product off the `/shop` permalink base, which contributes no param here,
 *  - a product at two category depths (the URL shape comes from the permalink).
 */
function product(
  slug: string,
  uri: string,
  colours: string[] = [],
  sizes: string[] = [],
): Record<string, unknown> {
  const attributes: Record<string, unknown>[] = [];
  if (sizes.length) {
    attributes.push({
      slug: "pa_size",
      fullOptions: sizes.map((s) => ({ slug: s })),
    });
  }
  if (colours.length) {
    attributes.push({
      slug: "pa_color",
      fullOptions: colours.map((c) => ({ slug: c })),
    });
  }
  return { slug, uri, attributes };
}

const PRODUCT_PAGES: Record<string, unknown>[][] = [
  [
    product("plain-bidon", "/shop/water-bottles/plain-bidon"),
    product("trail-jacket", "/shop/apparel/trail-jacket", ["black"]),
    product("deep-bar-tape", "/shop/components/bars/deep-bar-tape", [
      "red",
      "blue",
      "red", // repeated: one URL, not two
    ]),
  ],
  [
    product(
      "club-jersey",
      "/shop/apparel/jerseys/club-jersey",
      ["white", "navy"],
      ["s", "m", "l"], // size options must contribute NO url
    ),
    product("no-shop-base", "/product/no-shop-base", ["green"]),
  ],
];

const BRAND_PAGES: string[][] = [
  ["abus", "amflow", "avid"],
  ["wahoo", "zefal", "zipp"], // page 2 — the half the capped read dropped
];

beforeEach(() => {
  productsList.mockReset();
  brandsList.mockReset();

  productsList.mockImplementation((_filter, page) =>
    Promise.resolve({
      products: PRODUCT_PAGES[page - 1] ?? [],
      totalPages: PRODUCT_PAGES.length,
    }),
  );
  brandsList.mockImplementation((args) =>
    Promise.resolve({
      brands: (BRAND_PAGES[(args?.page ?? 1) - 1] ?? []).map((slug) => ({
        slug,
      })),
      // The endpoint's own count, which is what the index measures itself
      // against before claiming to be showing every brand.
      total: BRAND_PAGES.flat().length,
      totalPages: BRAND_PAGES.length,
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every base param the fixture can produce, in the shape the route emits. */
const BASE_PATHS = [
  "/shop/water-bottles/plain-bidon",
  "/shop/apparel/trail-jacket",
  "/shop/components/bars/deep-bar-tape",
  "/shop/apparel/jerseys/club-jersey",
] as const;

/** Sitemap entries beneath a prefix, excluding the family's own index URL. */
async function advertised(prefix: string): Promise<Set<string>> {
  const entries = await sitemap();
  const base = `${SITE_URL}${prefix}`;
  return new Set(
    entries
      .map((entry) => entry.url)
      .filter((url) => url.startsWith(`${base}/`))
      .map((url) => url.slice(SITE_URL.length)),
  );
}

function builtPaths(params: { slug: string[] }[], prefix: string): Set<string> {
  return new Set(
    params
      .map((param) => param.slug)
      .filter((slug) => slug[0] !== "__hk_static_placeholder")
      .map((slug) => `${prefix}/${slug.join("/")}`),
  );
}

/**
 * The brands the INDEX actually renders. Walks the real server composition of
 * `app/brand/page.tsx`, failing on any `<Suspense>` on the way: a boundary over
 * React's 12,800-byte `progressiveChunkSize` is outlined into a hidden segment,
 * so a brand inside one is not rendered for a crawler that runs no JavaScript —
 * which is the second half of how this index hid its brands.
 * `app/brand/page.composition.test.tsx` owns that rule; this reads the props to
 * compare the SET.
 */
async function indexBrandPaths(): Promise<Set<string>> {
  const collected = new Set<string>();

  async function walk(node: unknown): Promise<void> {
    if (Array.isArray(node)) {
      for (const child of node) await walk(child);
      return;
    }
    if (!isValidElement<Record<string, unknown>>(node)) return;
    expect(node.type, "no boundary may wrap the brand index's grid").not.toBe(
      Suspense,
    );
    if (node.type === BrandPage) {
      expect(
        node.props.complete,
        "the index must not claim a complete list it cannot prove",
      ).toBe(true);
      for (const brand of node.props.brands as { slug: string }[]) {
        collected.add(`/brand/${brand.slug}`);
      }
      return;
    }
    if (typeof node.type === "function") {
      const component = node.type as (
        props: Record<string, unknown>,
      ) => unknown;
      await walk(await component(node.props));
      return;
    }
    await walk(node.props.children);
  }

  await walk(BrandIndexPage());
  return collected;
}

describe("product and brand URL emitters agree", () => {
  it("prerenders no /shop URL the sitemap does not advertise", async () => {
    const [advertisedShop, params] = await Promise.all([
      advertised("/shop"),
      shopParams(),
    ]);
    const built = builtPaths(params, "/shop");

    // Stated positively as well as by the subset check, so a fixture that
    // silently stopped producing products could not make this vacuous.
    expect(built).toContain("/shop/apparel/trail-jacket");
    expect(built.size).toBeGreaterThan(0);

    const orphans = [...built].filter((path) => !advertisedShop.has(path));
    expect(
      orphans,
      "a param the sitemap does not advertise is build time spent on a URL nothing links to",
    ).toEqual([]);

    // The reverse containment is the BUDGET's doing, not a gap: at the platform
    // default of zero the sitemap advertises one URL per colourway and this
    // route emits only base params. The case below asserts the equality that
    // holds once a store opens the budget.
    const advertisedOnly = [...advertisedShop].filter(
      (path) => !built.has(path),
    );
    expect(advertisedOnly).toContain("/shop/apparel/trail-jacket/black");
  });

  it("prerenders exactly the /brand URLs the sitemap advertises, past page 1", async () => {
    const [advertisedBrands, params] = await Promise.all([
      advertised("/brand"),
      brandParams(),
    ]);
    const built = builtPaths(params, "/brand");

    // The page-2 brands are the ones the capped read used to drop.
    expect(advertisedBrands).toContain("/brand/zipp");
    expect(built).toContain("/brand/zipp");
    expect(built.size).toBe(6);

    expect(built).toEqual(advertisedBrands);
  });

  it("renders on /brand exactly the brands the sitemap advertises", async () => {
    // The index is not an emitter of URLs, but it is the only surface a shopper
    // reaches a brand THROUGH, so a brand missing here is unreachable however
    // correctly the sitemap and the prerender agree. It showed 24 of 110.
    const [advertisedBrands, rendered] = await Promise.all([
      advertised("/brand"),
      indexBrandPaths(),
    ]);

    expect(rendered).toContain("/brand/zipp");
    expect(rendered.size).toBe(6);
    expect(rendered).toEqual(advertisedBrands);
  });

  it("still yields a param when the catalogue is unreachable", async () => {
    // Cache Components requires >= 1 param; a route returning [] is served from
    // a postponed shell and its not-found gate goes inert
    // (`app/not-found-status.test.ts` owns that rule).
    productsList.mockRejectedValue(new Error("catalogue unreachable"));
    brandsList.mockRejectedValue(new Error("catalogue unreachable"));

    expect(await shopParams()).toEqual([{ slug: ["__hk_static_placeholder"] }]);
    expect(await brandParams()).toEqual([
      { slug: ["__hk_static_placeholder"] },
    ]);
  });

  it("keeps the brands collected before a mid-walk failure", async () => {
    brandsList.mockImplementation((args) =>
      (args?.page ?? 1) === 1
        ? Promise.resolve({
            brands: BRAND_PAGES[0]!.map((slug) => ({ slug })),
            totalPages: 2,
          })
        : Promise.reject(new Error("page 2 unreachable")),
    );

    const built = builtPaths(await brandParams(), "/brand");
    expect(built).toEqual(
      new Set(["/brand/abus", "/brand/amflow", "/brand/avid"]),
    );
  });
});

describe("with the colourway budget opened", () => {
  // `HEADKIT_PRERENDER_PRODUCT_COLOURWAYS` is what a store raises once it has
  // priced the class against its own build; `lib/prerender-budget.test.ts` owns
  // the parsing of the key, this owns what the emitters then do.
  beforeEach(() => {
    vi.stubEnv("HEADKIT_PRERENDER_PRODUCT_COLOURWAYS", "unlimited");
  });

  it("prerenders exactly the /shop URLs the sitemap advertises", async () => {
    const [advertisedShop, params] = await Promise.all([
      advertised("/shop"),
      shopParams(),
    ]);
    const built = builtPaths(params, "/shop");

    // Stated positively as well as by equality, so a fixture that silently
    // stopped producing colourways could not make this vacuous.
    expect(advertisedShop).toContain("/shop/apparel/trail-jacket/black");
    expect(built).toContain("/shop/apparel/trail-jacket/black");
    expect(built).toContain("/shop/apparel/jerseys/club-jersey/navy");

    expect(built).toEqual(advertisedShop);
  });

  it("emits one param per colourway and none for size or a repeated option", async () => {
    const built = builtPaths(await shopParams(), "/shop");

    // No colourway: base only.
    expect([...built].filter((p) => p.includes("plain-bidon"))).toEqual([
      "/shop/water-bottles/plain-bidon",
    ]);

    // Repeated `red` yields one URL; `pa_size` yields none.
    expect(
      [...built].filter((p) => p.includes("deep-bar-tape")).sort(),
    ).toEqual([
      "/shop/components/bars/deep-bar-tape",
      "/shop/components/bars/deep-bar-tape/blue",
      "/shop/components/bars/deep-bar-tape/red",
    ]);
    expect([...built].some((p) => p.endsWith("/m"))).toBe(false);

    // A product off the `/shop` permalink base contributes nothing to THIS
    // route — neither its base nor its colourway.
    expect([...built].some((p) => p.includes("no-shop-base"))).toBe(false);
  });

  it("spends a finite budget on colourways only, never on a base param", async () => {
    vi.stubEnv("HEADKIT_PRERENDER_PRODUCT_COLOURWAYS", "1");

    const built = builtPaths(await shopParams(), "/shop");

    // Every base param survives the cap; exactly one colourway is built, and it
    // is the first one the walk reaches.
    for (const base of BASE_PATHS) expect(built).toContain(base);
    expect(built.size).toBe(BASE_PATHS.length + 1);
    expect(built).toContain("/shop/apparel/trail-jacket/black");
  });
});

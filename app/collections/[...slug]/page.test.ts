import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Collection canonical consolidation.
 *
 * The route resolves a category from the LAST slug segment, so
 * `/collections/child` and `/collections/parent/child` both serve the same
 * category and render identical content. Internal links use the flat shape
 * (category carousel, subcategory cards, block editor) while `app/sitemap.ts`
 * advertises the nested one, so both are live. A canonical built from the
 * REQUESTED path makes each shape declare itself the original; these cases pin
 * that every shape consolidates onto the one path the sitemap advertises.
 */

const { SITE_URL, bailout, BailoutSignal } = vi.hoisted(() => {
  const url = "https://shop.example.com";
  process.env.NEXT_PUBLIC_FRONTEND_URL = url;
  /** Stands in for the control-flow error Next throws from a dynamic API. */
  class BailoutSignal extends Error {}
  return { SITE_URL: url, bailout: { armed: false }, BailoutSignal };
});

const getCategory = vi.fn();
const getFilters = vi.fn();
const getCategories = vi.fn();
const brandsList = vi.fn();
// The brand-facet metadata branch reads the display name through
// `getCachedProductBrand`, which is `brands.get` — never the 100-brand list.
const brandsGet = vi.fn();
const redirectedTo = vi.fn<(path: string) => void>();

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("notFound");
  },
  permanentRedirect: (path: string): never => {
    redirectedTo(path);
    throw new Error(`REDIRECT:${path}`);
  },
  // Mirrors the real one: rethrows Next's own control-flow signals, passes
  // ordinary errors through untouched.
  unstable_rethrow: (error: unknown): void => {
    if (error instanceof BailoutSignal) throw error;
  },
}));

// Kept mocked even though this route's metadata no longer reads a header:
// `setRequestHost` below still drives it, and one test asserts it is NEVER
// called — the property that keeps `generateMetadata` prerenderable.
const mockedHeaders = vi.hoisted(() => vi.fn());

vi.mock("next/headers", async () => {
  const { currentRequestHeaders } =
    await import("@/lib/test-support/request-host");
  mockedHeaders.mockImplementation(
    async (): Promise<Headers> => currentRequestHeaders(),
  );
  return { headers: mockedHeaders };
});

vi.mock("@/lib/sdk", () => ({
  headkit: {
    collections: {
      getCategory: (slug: string): unknown => {
        // Stands in for Next throwing its dynamic-access signal from inside a
        // read `generateMetadata` awaits. It used to be armed on `headers()`,
        // which this route's metadata no longer calls; the property under test
        // — the route's catch must not swallow Next control flow — is the same.
        if (bailout.armed) throw new BailoutSignal("dynamic usage");
        return getCategory(slug);
      },
      getFilters: (slug: string): unknown => getFilters(slug),
      getCategories: (): unknown => getCategories(),
    },
    brands: {
      list: (): unknown => brandsList(),
      get: (slug: string): unknown => brandsGet(slug),
    },
  },
}));

vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      seoSettings: { allowIndexing: true, ogImageUrl: null },
      storeSettings: { name: "Acme", domain: null },
    }),
}));

vi.mock("@/lib/hide-empty-collections", () => ({
  filterCategoriesByNonEmptySlugs: (c: unknown): unknown => c,
  getNonEmptyCollectionSlugs: (): Promise<null> => Promise.resolve(null),
}));

vi.mock("@/components/headkit-ui/collection/collection-header", () => ({
  CollectionHeader: (): null => null,
}));
vi.mock("@/components/headkit-ui/collection/collection-page", () => ({
  CollectionPage: (): null => null,
}));
vi.mock("@/components/seo/breadcrumb-json-ld", () => ({
  BreadcrumbJsonLD: (): null => null,
}));
vi.mock("@/components/headkit-ui/skeletons/collection-page-skeleton", () => ({
  CollectionPageSkeleton: (): null => null,
  CollectionProductsSkeleton: (): null => null,
}));
vi.mock("@/components/headkit-ui/catalog-grid", () => ({
  CATALOG_PAGE_SIZE: 24,
}));

// The facet plan is mocked so these cases can force discovery on or off.
// The decision itself is `lib/collection-facet-plan.test.ts`. Default here
// is discover-and-emit, which is the small-catalogue path.
const facetPlan = vi.hoisted(() => ({ discover: true, emit: true }));
vi.mock("@/lib/collection-facet-plan", () => ({
  readFacetCataloguePlan: (): Promise<{
    mode: "all";
    paths: [];
    reason: string;
    total: null;
  }> =>
    Promise.resolve({
      mode: "all",
      paths: [],
      reason: "test",
      total: null,
    }),
  shouldDiscoverCollectionFacets: (): boolean => facetPlan.discover,
  shouldEmitCollectionFacets: (): boolean => facetPlan.emit,
}));

import {
  DEFAULT_FILTER_VALUES,
  encodeFilterSlug,
} from "@/components/headkit-ui/collection/utils";
import { setRequestHost } from "@/lib/test-support/request-host";
import { decodeFilterSlug } from "@/components/headkit-ui/collection/utils";
import {
  CollectionPageContent,
  generateMetadata,
  generateStaticParams,
} from "./page";

/** A category that lives at /collections/parent/child, whatever URL asked for it. */
function nestedCategory(): Record<string, unknown> {
  return {
    id: "2",
    name: "Child",
    slug: "child",
    description: "",
    thumbnail: "",
    uri: "",
    seo: null,
    children: [],
    ancestors: [
      {
        id: "1",
        name: "Parent",
        slug: "parent",
        description: "",
        thumbnail: "",
        uri: "",
        children: [],
        ancestors: [],
      },
    ],
  };
}

async function metadataFor(
  slug: string[],
): Promise<Awaited<ReturnType<typeof generateMetadata>>> {
  return await generateMetadata({
    params: Promise.resolve({ slug }),
  });
}

async function canonicalFor(slug: string[]): Promise<string | undefined> {
  const meta = await metadataFor(slug);
  return (meta.alternates as { canonical?: string } | undefined)?.canonical;
}

const COLOR_FACET = encodeFilterSlug({
  ...DEFAULT_FILTER_VALUES,
  attributes: { pa_color: ["red"] },
});

beforeEach(() => {
  bailout.armed = false;
  // The store's own live host — branding mocks `domain: null`, so the origin
  // resolves from NEXT_PUBLIC_FRONTEND_URL above.
  setRequestHost(new URL(SITE_URL).host);
  getCategory.mockReset();
  getFilters.mockReset();
  getCategories.mockReset();
  brandsList.mockReset();
  brandsGet.mockReset();
  redirectedTo.mockReset();
  getCategory.mockResolvedValue(nestedCategory());
  getFilters.mockResolvedValue({
    attributes: [{ slug: "pa_color", options: [{ slug: "red", name: "Red" }] }],
  });
  getCategories.mockResolvedValue([]);
  brandsList.mockResolvedValue({ brands: [] });
  brandsGet.mockResolvedValue(null);
});

describe("base collection canonical", () => {
  it("consolidates every serving URL shape onto the nested path", async () => {
    const flat = await canonicalFor(["child"]);
    const nested = await canonicalFor(["parent", "child"]);

    expect(
      flat,
      "the flat shape every internal link uses must point at the path the sitemap advertises, not at itself",
    ).toBe(`${SITE_URL}/collections/parent/child`);
    expect(nested).toBe(flat);
  });

  it("emits the bare path for a root category", async () => {
    getCategory.mockResolvedValue({ ...nestedCategory(), ancestors: [] });

    await expect(canonicalFor(["child"])).resolves.toBe(
      `${SITE_URL}/collections/child`,
    );
  });
});

describe("Tier-1 facet canonical", () => {
  it("consolidates every serving URL shape onto the nested facet path", async () => {
    const flat = await canonicalFor(["child", "f", COLOR_FACET]);
    const nested = await canonicalFor(["parent", "child", "f", COLOR_FACET]);

    expect(flat).toBe(`${SITE_URL}/collections/parent/child/f/${COLOR_FACET}`);
    expect(nested).toBe(flat);
  });
});

/**
 * ENG-868 / ENG-876: a Tier-1 facet URL is a deliberate SEO surface — it gets a
 * self-canonical, a facet title and a facet description precisely so it can be
 * indexed, and robots.txt allows `/collections/*`. It used to carry a
 * `noindex, nofollow` on EVERY host because its `resolveRobots` call omitted
 * the store origin, silently de-indexing the page while robots.txt kept
 * inviting the crawl.
 *
 * SCOPE: the meta carries the STORE SWITCH only. A rehearsal host is closed by
 * the `X-Robots-Tag` header `proxy.ts` sets, which is `lib/host-robots.test.ts`
 * — nothing here proves it, and the host-independence below is the cost of that
 * split stated out loud rather than hidden.
 */
describe("Tier-1 facet robots", () => {
  it("indexes when the store switch is on, and reads no request header", async () => {
    mockedHeaders.mockClear();

    const meta = await metadataFor(["child", "f", COLOR_FACET]);

    expect(
      meta.robots,
      "the facet meta must not refuse the crawl robots.txt allows",
    ).toEqual({ index: true, follow: true });
    expect(
      mockedHeaders,
      "a header read here postpones a dynamic hole in this route",
    ).not.toHaveBeenCalled();
  });

  it("answers the same on a rehearsal host — the HEADER is what closes it", async () => {
    setRequestHost("acme-rehearsal.headkit.app");

    const meta = await metadataFor(["child", "f", COLOR_FACET]);

    expect(meta.robots).toEqual({ index: true, follow: true });
  });
});

/**
 * Next's dynamic-access signal can originate INSIDE `generateMetadata`'s own
 * try block — a cached read it awaits can throw one during prerender. A `catch`
 * that consumes it turns "mark this render dynamic" into a page that silently
 * loses its title, description and canonical.
 */
describe("generateMetadata dynamic bailout", () => {
  it("propagates Next's bailout signal instead of degrading to empty metadata", async () => {
    bailout.armed = true;

    await expect(
      metadataFor(["parent", "child"]),
      "the route catch must not swallow the signal a cached read re-throws",
    ).rejects.toBeInstanceOf(BailoutSignal);
  });

  it("propagates it from the Tier-1 facet branch too", async () => {
    bailout.armed = true;

    await expect(
      metadataFor(["child", "f", COLOR_FACET]),
    ).rejects.toBeInstanceOf(BailoutSignal);
  });
});

describe("Tier-2 filtered canonical", () => {
  it("points a non-indexable facet back at the nested base collection", async () => {
    const combo = encodeFilterSlug({
      ...DEFAULT_FILTER_VALUES,
      attributes: { pa_color: ["red", "blue"] },
    });

    await expect(canonicalFor(["child", "f", combo])).resolves.toBe(
      `${SITE_URL}/collections/parent/child`,
    );
  });
});

/** The `Location` the route 308s to, or null when it served instead. */
async function redirectTargetFor(slug: string[]): Promise<string | null> {
  redirectedTo.mockClear();
  try {
    await CollectionPageContent({
      params: Promise.resolve({ slug }),
    });
  } catch (error) {
    if (!String(error).startsWith("Error: REDIRECT:")) throw error;
  }
  return redirectedTo.mock.calls[0]?.[0] ?? null;
}

describe("the flat collection shape 308s onto the nested one", () => {
  it("redirects the flat path and serves the nested one", async () => {
    expect(
      await redirectTargetFor(["child"]),
      "the flat shape must retire onto the canonical path, not merely point a canonical at it — with both serving 200 the duplicate stays live",
    ).toBe("/collections/parent/child");

    expect(
      await redirectTargetFor(["parent", "child"]),
      "the canonical path itself must serve; redirecting it would loop",
    ).toBeNull();
  });

  it("carries a path-encoded facet across the redirect", async () => {
    expect(
      await redirectTargetFor(["child", "f", COLOR_FACET]),
      "a Tier-1 facet URL is indexable in its own right — dropping the facet would 308 it onto a different page",
    ).toBe(`/collections/parent/child/f/${COLOR_FACET}`);
  });

  it("does not redirect a root category, which has no nested shape", async () => {
    getCategory.mockResolvedValue({ ...nestedCategory(), ancestors: [] });

    expect(
      await redirectTargetFor(["child"]),
      "a root category's canonical IS the flat path — redirecting it to itself is an infinite loop",
    ).toBeNull();
  });

  it("does not redirect when the category cannot be resolved", async () => {
    // A genuinely missing category must never become a redirect: an outage
    // would otherwise mint permanent, client-cached moves to a path that was
    // never canonical. It answers 404 instead, from the same default export and
    // above the boundary, so the status line is still settable — the soft-404
    // fix. The distinction that matters is redirect-vs-not: `notFound()` here
    // is the SAME outcome the route always had, moved to where it can set a
    // status (see `app/not-found-status.test.ts`).
    getCategory.mockResolvedValue(null);

    redirectedTo.mockClear();
    await expect(
      CollectionPageContent({
        params: Promise.resolve({ slug: ["child"] }),
      }),
    ).rejects.toThrow("notFound");
    expect(redirectedTo).not.toHaveBeenCalled();
  });

  it("agrees with the canonical it emits", async () => {
    // The two are read from different code paths; the whole defect class is
    // them disagreeing, so pin them against each other rather than separately.
    const target = await redirectTargetFor(["child"]);
    const canonical = await canonicalFor(["child"]);

    expect(canonical).toBe(`${SITE_URL}${target}`);
  });
});

describe("generateStaticParams color facet key", () => {
  // A store whose colour taxonomy is `pa_colour` (British spelling). Before
  // the fix, colorFilterSlug hard-coded `pa_color`, so the emitted facet URL
  // decoded to an attribute key the store's own taxonomy does not have and the
  // gateway matched zero products (report §7.4).
  function colorCategory(slug: string): Record<string, unknown> {
    return { slug, children: [] };
  }

  it("emits a facet segment that decodes back to the store's own attribute slug (pa_colour)", async () => {
    getCategories.mockResolvedValue([colorCategory("bikes")]);
    getFilters.mockResolvedValue({
      // SDK getFilters() returns the display slug with the `pa_` prefix
      // stripped (see lib/color-attr-slug.ts) — not the raw taxonomy name.
      attributes: [
        { slug: "colour", options: [{ slug: "black", name: "Black" }] },
      ],
    });

    const params = await generateStaticParams();
    const facetParam = params.find((p) => p.slug.includes("f"));
    expect(
      facetParam,
      "expected a category×color facet param to be emitted",
    ).toBeDefined();
    const facetSlug = facetParam!.slug[facetParam!.slug.length - 1]!;

    const decoded = decodeFilterSlug(facetSlug);
    expect(decoded.attributes).toEqual({ pa_colour: ["black"] });
    expect(decoded.attributes).not.toHaveProperty("pa_color");
  });

  it("still emits pa_color correctly for a store spelled that way", async () => {
    getCategories.mockResolvedValue([colorCategory("bikes")]);
    getFilters.mockResolvedValue({
      attributes: [
        { slug: "color", options: [{ slug: "black", name: "Black" }] },
      ],
    });

    const params = await generateStaticParams();
    const facetParam = params.find((p) => p.slug.includes("f"));
    expect(facetParam).toBeDefined();
    const facetSlug = facetParam!.slug[facetParam!.slug.length - 1]!;

    const decoded = decodeFilterSlug(facetSlug);
    expect(decoded.attributes).toEqual({ pa_color: ["black"] });
  });
});

describe("generateStaticParams category×brand emptiness", () => {
  // Before the fix this loop emitted the GLOBAL brand list under EVERY
  // category with no check that the pair contained a product — 100 categories
  // × 100 brands = 10,000 params of which 9,499 rendered an empty grid on the
  // measured store (report §7.1). getFilters now reports the category's own
  // brand list, so only real pairs are emitted.
  const GLOBAL_BRANDS = {
    brands: [
      { slug: "shimano" },
      { slug: "abus" },
      { slug: "basil" },
      { slug: "4iiii" },
    ],
  };

  /** Facet params whose filter segment decodes to a single brand. */
  function brandFacets(params: { slug: string[] }[]): {
    category: string;
    brand: string;
  }[] {
    return params
      .filter((p) => p.slug.includes("f"))
      .map((p) => ({
        category: p.slug[p.slug.indexOf("f") - 1]!,
        decoded: decodeFilterSlug(p.slug[p.slug.length - 1]!),
      }))
      .filter((e) => e.decoded.brands.length === 1)
      .map((e) => ({ category: e.category, brand: e.decoded.brands[0]! }));
  }

  it("emits only the brands a category actually stocks, not every brand in the store", async () => {
    getCategories.mockResolvedValue([
      { slug: "suspension", children: [] },
      { slug: "locks", children: [] },
    ]);
    brandsList.mockResolvedValue(GLOBAL_BRANDS);
    // Each category reports its OWN brand list — a strict subset of the global
    // one. The endpoint only ever returns a brand whose in-scope count is > 0.
    getFilters.mockImplementation((slug: string) =>
      Promise.resolve({
        attributes: [],
        brands:
          slug === "suspension"
            ? [{ slug: "shimano", name: "Shimano", count: 12 }]
            : [
                { slug: "abus", name: "Abus", count: 3 },
                { slug: "basil", name: "Basil", count: 1 },
              ],
      }),
    );

    const facets = brandFacets(await generateStaticParams());

    expect(facets).toEqual([
      { category: "suspension", brand: "shimano" },
      { category: "locks", brand: "abus" },
      { category: "locks", brand: "basil" },
    ]);
    // The blind cross-product would have been 2 × 4 = 8.
    expect(facets).toHaveLength(3);
    expect(
      facets.some((f) => f.category === "suspension" && f.brand === "abus"),
      "a lock brand must not be emitted under suspension",
    ).toBe(false);
    expect(facets.some((f) => f.brand === "4iiii")).toBe(false);
  });

  it("emits nothing for a category that stocks no brand", async () => {
    getCategories.mockResolvedValue([
      { slug: "bikes", children: [] },
      { slug: "gift-cards", children: [] },
    ]);
    brandsList.mockResolvedValue(GLOBAL_BRANDS);
    getFilters.mockImplementation((slug: string) =>
      Promise.resolve({
        attributes: [],
        brands: slug === "bikes" ? [{ slug: "shimano", count: 4 }] : [],
      }),
    );

    const facets = brandFacets(await generateStaticParams());

    expect(facets).toEqual([{ category: "bikes", brand: "shimano" }]);
  });

  it("falls back to the global cross-product when NO category can report brands", async () => {
    // A backend predating ProductFilters.brands (or a provider that cannot
    // report them) returns an empty list for every category. That is not a
    // catalogue in which nothing is branded — it is an unknowable brand list,
    // and dropping every brand facet page silently would be worse than keeping
    // the previous behaviour.
    getCategories.mockResolvedValue([{ slug: "bikes", children: [] }]);
    brandsList.mockResolvedValue({
      brands: [{ slug: "shimano" }, { slug: "abus" }],
    });
    getFilters.mockResolvedValue({ attributes: [] });

    const facets = brandFacets(await generateStaticParams());

    expect(facets).toEqual([
      { category: "bikes", brand: "shimano" },
      { category: "bikes", brand: "abus" },
    ]);
  });
});

describe("generateStaticParams facet plan", () => {
  function category(slug: string): Record<string, unknown> {
    return { slug, children: [] };
  }

  beforeEach(() => {
    facetPlan.discover = true;
    facetPlan.emit = true;
  });

  it("emits bare category params only when facets are not discovered", async () => {
    facetPlan.discover = false;
    getCategories.mockResolvedValue([category("bikes"), category("locks")]);
    // Both dimensions the facet loops explode on are present and stocked, so
    // an unbudgeted run would emit facet params here.
    getFilters.mockResolvedValue({
      attributes: [
        { slug: "colour", options: [{ slug: "black", name: "Black" }] },
      ],
      brands: [{ slug: "shimano", name: "Shimano", count: 12 }],
    });
    brandsList.mockResolvedValue({ brands: [{ slug: "shimano" }] });

    const params = await generateStaticParams();

    expect(params).toEqual([{ slug: ["bikes"] }, { slug: ["locks"] }]);
    expect(
      params.some((p) => p.slug.includes("f")),
      "no /f/<slug> facet param may be prerendered when discovery is skipped",
    ).toBe(false);
  });

  it("makes no facet READ when discovery is skipped", async () => {
    facetPlan.discover = false;
    getCategories.mockResolvedValue([category("bikes")]);

    await generateStaticParams();

    expect(getFilters).not.toHaveBeenCalled();
    expect(brandsList).not.toHaveBeenCalled();
  });

  it("keeps nested categories at their nested path when facets are off", async () => {
    facetPlan.discover = false;
    getCategories.mockResolvedValue([
      { slug: "parent", children: [{ slug: "child", children: [] }] },
    ]);

    const params = await generateStaticParams();

    expect(params).toContainEqual({ slug: ["parent", "child"] });
  });

  it("emits none of a discovered set that does not fit", async () => {
    facetPlan.discover = true;
    facetPlan.emit = false;
    getCategories.mockResolvedValue([category("bikes"), category("locks")]);
    getFilters.mockResolvedValue({
      attributes: [
        {
          slug: "colour",
          options: [
            { slug: "black", name: "Black" },
            { slug: "red", name: "Red" },
          ],
        },
      ],
      brands: [{ slug: "shimano", name: "Shimano", count: 12 }],
    });
    brandsList.mockResolvedValue({ brands: [{ slug: "shimano" }] });

    const params = await generateStaticParams();

    expect(params.filter((p) => !p.slug.includes("f"))).toEqual([
      { slug: ["bikes"] },
      { slug: ["locks"] },
    ]);
    expect(params.some((p) => p.slug.includes("f"))).toBe(false);
    expect(getFilters).toHaveBeenCalled();
  });

  it("still falls back to the placeholder with facets off and no category", async () => {
    facetPlan.discover = false;
    getCategories.mockResolvedValue([]);

    expect(await generateStaticParams()).toEqual([
      { slug: ["__hk_static_placeholder"] },
    ]);
  });
});

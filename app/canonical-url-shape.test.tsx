import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";

/**
 * One product, five signals, one string.
 *
 * The defect this closes was never "the canonical is wrong" on its own — it was
 * that the signals CONTRADICTED each other: `app/sitemap.ts` advertised the
 * nested `/shop/{cat}/{slug}` shape while the canonical, every internal link and
 * the Product JSON-LD `url` all named the flat `/products/{slug}` one, with no
 * redirect between them and both serving 200. Verified on two rehearsal
 * storefronts (Pebblr F3/F1/F9, Dishee F5/F1/F9), where it meant duplicate
 * content across the whole catalogue with the internal link graph voting against
 * the URLs the V1 sites had indexed.
 *
 * So the assertion that matters is not that any one signal is nested. It is that
 * all five are the SAME STRING, produced by the real code paths, in one test —
 * because five green tests in five files is exactly the shape the bug already
 * passed. Each signal below is read from the module that actually emits it:
 *
 *   1. `<link rel="canonical">`  — `generateMetadata` in app/shop/[...slug]
 *   2. the 308 `Location`        — the default export of app/products/[...slug]
 *   3. the rendered link         — `ProductCard`'s markup
 *   4. Product JSON-LD `url`     — `ProductJsonLD`
 *   5. the sitemap `<loc>`       — the default export of app/sitemap
 */

const { STORE_DOMAIN, SITE_URL } = vi.hoisted(() => {
  // Deliberately DIFFERENT from the runtime store domain: every signal must
  // resolve the runtime domain, so a regression to the baked env shows up as a
  // host mismatch here rather than passing silently.
  process.env.NEXT_PUBLIC_FRONTEND_URL = "https://stale.headkit.app";
  const domain = "shop.example.com";
  return { STORE_DOMAIN: domain, SITE_URL: `https://${domain}` };
});

/** The fixture: a product WordPress files under clothing → hoodies. */
const PRODUCT = {
  id: "1",
  name: "Blue Hoodie",
  slug: "blue-hoodie",
  // The absolute WooCommerce permalink, exactly as the Go mapper assigns it.
  uri: "https://commerce.example.com/shop/clothing/hoodies/blue-hoodie/",
  sku: "SKU-1",
  type: "simple",
  price: "100",
  regularPrice: "100",
  salePrice: "",
  onSale: false,
  isNew: false,
  stockStatus: "instock",
  shortDescription: "A hoodie",
  description: "A hoodie",
  seo: null,
  image: {
    src: "https://cdn.example/hoodie.jpg",
    alt: "",
    width: 1,
    height: 1,
  },
  images: [],
  attributes: [],
  defaultAttributes: [],
  variations: [],
  categories: [
    { id: "c1", name: "Hoodies", slug: "hoodies" },
    // A SECOND category, listed first-but-not-primary in some payloads: the
    // canonical must not depend on this list's order.
    { id: "c2", name: "Accessories", slug: "accessories" },
  ],
  related: [],
  upsells: [],
  projects: [],
};

/**
 * A VARIABLE product with one real colourway, for the colourway cases. The
 * colour must be a genuine option: an unknown colour segment is a junk URL and
 * both routes noindex it rather than canonicalising it.
 */
const VARIABLE_PRODUCT = {
  ...PRODUCT,
  id: "2",
  name: "Zip Hoodie",
  slug: "zip-hoodie",
  uri: "https://commerce.example.com/shop/clothing/hoodies/zip-hoodie/",
  type: "variable",
  attributes: [
    {
      id: "a1",
      name: "Colour",
      slug: "pa_color",
      type: "select",
      options: ["red"],
      visible: true,
      variation: true,
      fullOptions: [
        { name: "Red", slug: "red", swatchColor: "", swatchColor2: "" },
      ],
    },
  ],
  variations: [
    {
      id: "v1",
      price: "100",
      regularPrice: "100",
      salePrice: "",
      onSale: false,
      stockStatus: "instock",
      dateModified: null,
      image: { src: "https://cdn.example/zip-red.jpg" },
      images: [],
      attributes: [{ key: "pa_color", value: "red" }],
    },
  ],
};

/** The one path every signal must name. */
const CANONICAL_PATH = "/shop/clothing/hoodies/blue-hoodie";
const CANONICAL_URL = `${SITE_URL}${CANONICAL_PATH}`;

const CATEGORY_TREE = [
  { slug: "clothing", children: [{ slug: "hoodies", children: [] }] },
  { slug: "accessories", children: [] },
];

/** One category node as the single-category endpoint returns it. */
function collectionNode(
  slug: string,
  name: string,
  ancestors: { slug: string; name: string }[],
  children: unknown[] = [],
): Record<string, unknown> {
  return {
    id: slug,
    name,
    slug,
    description: "",
    thumbnail: "",
    uri: "",
    seo: null,
    ancestors,
    children,
  };
}

/**
 * The same two categories as `CATEGORY_TREE`, in the ancestors-carrying shape
 * `sdk.collections.getCategory` returns — this is what `CollectionRoute` reads,
 * and its `ancestors` are what the nested child links are built from.
 */
const COLLECTION_BY_SLUG: Record<string, Record<string, unknown>> = {
  clothing: collectionNode(
    "clothing",
    "Clothing",
    [],
    [
      collectionNode("hoodies", "Hoodies", [
        { slug: "clothing", name: "Clothing" },
      ]),
    ],
  ),
  hoodies: collectionNode("hoodies", "Hoodies", [
    { slug: "clothing", name: "Clothing" },
  ]),
  accessories: collectionNode("accessories", "Accessories", []),
};

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
}));

const redirectedTo = vi.fn<(path: string) => void>();

/**
 * The category-tree read, spied. The PDP must never reach it: it is a
 * `"use cache"` entry tagged `TAG.collections`, and WordPress fires that tag on
 * a product-CATEGORY term edit (see the fallback-crumb note in
 * `app/products/[...slug]/page.tsx`).
 */
const getCategories = vi.fn<() => Promise<unknown>>();

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("notFound");
  },
  permanentRedirect: (path: string): never => {
    redirectedTo(path);
    throw new Error(`REDIRECT:${path}`);
  },
  // Route catches call this first so a Next control-flow signal is never
  // swallowed into a resolved noindex (#323). Mirror that contract: rethrow the
  // signals this file simulates, and fall through for anything else, exactly as
  // the real helper does for an ordinary error.
  unstable_rethrow: (error: unknown): void => {
    const message = String(error);
    if (
      message.startsWith("Error: REDIRECT:") ||
      message === "Error: notFound"
    ) {
      throw error;
    }
  },
}));

/** Everything the four modules under test read from the catalogue. */
// The page module under test imports `@/lib/env` (for `isShopifyStorefront`),
// which parses `process.env` with Zod at import time and throws in a bare test
// process. WooCommerce is the default. A preview test sets the domain so the
// same flag contact and checkout use turns the Admin preview read on.
const commerce = vi.hoisted(() => ({
  shopifyDomain: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: "pk_store",
    NEXT_PUBLIC_GRAPHQL_URL: "https://graph.example.test/graphql",
    HEADKIT_PRIVATE_KEY: "sk_store",
    get SHOPIFY_STORE_DOMAIN() {
      return commerce.shopifyDomain;
    },
  },
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    products: {
      list: (): Promise<unknown> =>
        Promise.resolve({ products: [PRODUCT], totalPages: 1 }),
    },
    collections: {
      getCategories: (): Promise<unknown> => getCategories(),
      getCategory: (slug: string): Promise<unknown> =>
        Promise.resolve(COLLECTION_BY_SLUG[slug] ?? null),
      getFilters: (): Promise<unknown> => Promise.resolve({ attributes: [] }),
    },
    brands: { list: (): Promise<unknown> => Promise.resolve({ brands: [] }) },
    posts: { list: (): Promise<unknown> => Promise.resolve({ posts: [] }) },
    projects: {
      list: (): Promise<unknown> => Promise.resolve({ projects: [] }),
    },
    menu: { getMenus: (): Promise<unknown[]> => Promise.resolve([]) },
    content: { get: (): Promise<null> => Promise.resolve(null) },
  },
}));

vi.mock("@/lib/product-cache", () => {
  // Both exports resolve the same fixture: `getProductForPage` delegates to
  // `getCachedProduct` whenever no Shopify preview key is supplied, which is
  // every case in this file. The preview branch has its own suite in
  // `app/products/[...slug]/page.test.ts`.
  const load = (slug: string): Promise<unknown> =>
    Promise.resolve(
      slug === PRODUCT.slug
        ? PRODUCT
        : slug === VARIABLE_PRODUCT.slug
          ? VARIABLE_PRODUCT
          : null,
    );
  return { getCachedProduct: load, getProductForPage: load };
});

vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      branding: { hideEmptyCollections: false, defaultCollectionSort: "" },
      seoSettings: {
        allowIndexing: true,
        enableSitemap: true,
        ogImageUrl: null,
      },
      storeSettings: { name: "Acme", domain: STORE_DOMAIN },
    }),
  getBrandingAssets: (): Promise<unknown> => Promise.resolve({ iconUrl: null }),
}));

vi.mock("@/lib/posts-base-path", () => ({
  getPostsBasePath: (): Promise<string> => Promise.resolve("news"),
  postsIndexPath: (base: string): string => `/${base}`,
}));

// The PDP pulls this in for the BNPL badge; it runs a Zod env parse at module
// scope which throws under Vitest.
vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: (): Promise<unknown> =>
    Promise.resolve({
      publishableKey: "",
      accountId: "",
      bnplMessagingEnabled: false,
    }),
}));

// Presentation-only children of the PDP and the card. Stubbed at the module
// boundary so what is under test is the URL each surface computes, not layout.
vi.mock("@/components/headkit-ui/product-detail", () => ({
  ProductDetail: (): null => null,
}));
vi.mock("@/components/headkit-ui/product-stock", () => ({
  ProductStock: (): null => null,
}));
vi.mock("@/components/headkit-ui/product-carousel", () => ({
  ProductCarousel: (): null => null,
}));
vi.mock("@/components/headkit-ui/project/project-carousel", () => ({
  ProjectCarousel: (): null => null,
}));
vi.mock("@/components/headkit-ui/section-header", () => ({
  SectionHeader: (): null => null,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: (): null => null }));
vi.mock("@/components/headkit-ui/featured-image", () => ({
  FeaturedImage: (): null => null,
}));
vi.mock("@/components/headkit-ui/product-price", () => ({
  ProductPrice: (): null => null,
}));
vi.mock("@/components/headkit-ui/badge-list", () => ({
  BadgeList: (): null => null,
}));
vi.mock("@/components/headkit-ui/variant-swatch", () => ({
  VariantSwatch: (): null => null,
}));
// The real carousel is a client component driven by scroll refs and effects.
// The URLs are in the items it renders, so render them all synchronously.
vi.mock("@/components/headkit-ui/carousel", () => ({
  Carousel: <T,>({
    items,
    renderItem,
    children,
  }: {
    items?: T[];
    renderItem?: (item: T, index: number) => React.ReactNode;
    children?: React.ReactNode;
  }): React.JSX.Element => (
    <div>
      {children}
      {items && renderItem
        ? items.map((item, index) => (
            <div key={index}>{renderItem(item, index)}</div>
          ))
        : null}
    </div>
  ),
}));
// `InstantLink` wraps next/link and calls `useLinkStatus`, which needs a Next
// router context. The href it receives is the whole point, so render it as a
// plain anchor and read the attribute back out of the markup.
vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    href,
    children,
  }: {
    href: string;
    children?: unknown;
  }): React.JSX.Element => <a href={href}>{children as React.ReactNode}</a>,
}));

import { generateMetadata as shopMetadata } from "./shop/[...slug]/page";
import { ProductPageContent, ProductRoute } from "./products/[...slug]/page";
import sitemap from "./sitemap";
import {
  resolveShopPath,
  shopSegmentsFromPath,
  walkCategoryPaths,
  SHOP_PATH_PREFIX,
} from "./shop/shop-slug";
import { ProductCard } from "@/components/headkit-ui/product-card";
import { CategoryCarousel } from "@/components/headkit-ui/category-carousel";
import { SubcategoryCard } from "@/components/headkit-ui/collection/subcategory-card";
import { CollectionHeader } from "@/components/headkit-ui/collection/collection-header";
import { CollectionRoute } from "./collections/[...slug]/page";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import { collectionPathFromCategory } from "@/components/headkit-ui/collection/utils";
import { productPath } from "@/lib/canonical-path";
import { ProductJsonLD } from "@/components/seo/product-json-ld";
import { CarouselProductJsonLD } from "@/components/seo/carousel-product-json-ld";
import { collectionPathResolver } from "@/lib/collection-path";
import type { CatalogProduct } from "@/lib/catalog-display";

/** The canonical a route asked `makeSeoMetadata` for. */
function canonicalOf(meta: Metadata): string | undefined {
  return (meta.alternates as { canonical?: string } | undefined)?.canonical;
}

/**
 * The `Location` the flat route 308s to, or null when it served instead.
 *
 * `searchParams` is optional and forwarded UNAWAITED, exactly as a request
 * carries it, so a case can put a real query string on the request without the
 * helper reading it — the route's own placement of that await is the thing
 * under test.
 */
async function flatRedirectTarget(
  slug: string[],
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<string | null> {
  redirectedTo.mockClear();
  try {
    await ProductRoute({
      params: Promise.resolve({ slug }),
      ...(searchParams
        ? { searchParams: Promise.resolve(searchParams) }
        : undefined),
    });
  } catch (error) {
    if (!String(error).startsWith("Error: REDIRECT:")) throw error;
  }
  return redirectedTo.mock.calls[0]?.[0] ?? null;
}

/** The `href` of the first anchor a component rendered. */
function firstHref(markup: string): string | undefined {
  return /href="([^"]*)"/.exec(markup)?.[1];
}

/** The JSON-LD graph a component serialised into its <script> tag. */
async function graphOf(element: unknown): Promise<Record<string, unknown>> {
  const rendered = (await element) as {
    props: { dangerouslySetInnerHTML: { __html: string } };
  };
  return JSON.parse(rendered.props.dangerouslySetInnerHTML.__html) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  redirectedTo.mockClear();
  getCategories.mockReset();
  getCategories.mockResolvedValue(CATEGORY_TREE);
});

describe("every signal names one URL", () => {
  it("canonical, 308 target, internal link, Product JSON-LD url and sitemap entry are the SAME string", async () => {
    const canonical = canonicalOf(
      await shopMetadata({
        params: Promise.resolve({
          slug: ["clothing", "hoodies", "blue-hoodie"],
        }),
      }),
    );

    const redirectTarget = await flatRedirectTarget(["blue-hoodie"]);

    const cardHref = firstHref(
      renderToStaticMarkup(
        <ProductCard product={PRODUCT as unknown as CatalogProduct} />,
      ),
    );

    const graph = await graphOf(ProductJsonLD({ product: PRODUCT as never }));

    const sitemapEntry = (await sitemap()).find((entry) =>
      entry.url.includes(PRODUCT.slug),
    )?.url;

    // Absolute where the signal is absolute, relative where it is an href —
    // compared as one set after re-rooting, because "they agree" is the claim.
    const absolute = (value: string | undefined | null): string | undefined =>
      value?.startsWith("/") ? `${SITE_URL}${value}` : (value ?? undefined);

    expect({
      canonical: absolute(canonical),
      redirectTarget: absolute(redirectTarget),
      internalLink: absolute(cardHref),
      jsonLdUrl: absolute(graph.url as string),
      jsonLdOfferUrl: absolute((graph.offers as { url: string }).url),
      sitemapEntry: absolute(sitemapEntry),
    }).toEqual({
      canonical: CANONICAL_URL,
      redirectTarget: CANONICAL_URL,
      internalLink: CANONICAL_URL,
      jsonLdUrl: CANONICAL_URL,
      jsonLdOfferUrl: CANONICAL_URL,
      sitemapEntry: CANONICAL_URL,
    });
  });

  it("resolves both shapes of the product, and the flat one 308s to the nested one", async () => {
    // The nested shape resolves: it produces a canonical, where an
    // unresolvable path produces none (see the noindex cases in
    // app/shop/[...slug]/page.test.ts).
    const nested = await shopMetadata({
      params: Promise.resolve({ slug: ["clothing", "hoodies", "blue-hoodie"] }),
    });
    expect(canonicalOf(nested)).toBe(CANONICAL_URL);

    // The flat shape resolves too — to a permanent redirect, not a 404.
    expect(await flatRedirectTarget(["blue-hoodie"])).toBe(CANONICAL_PATH);
  });

  it("carries a colourway onto the nested path rather than stranding it", async () => {
    const base = "/shop/clothing/hoodies/zip-hoodie";

    expect(
      await flatRedirectTarget(["zip-hoodie", "red"]),
      "a colourway URL whose base 308s must move with it, or it is left beneath a path that redirects",
    ).toBe(`${base}/red`);

    expect(
      canonicalOf(
        await shopMetadata({
          params: Promise.resolve({
            slug: ["clothing", "hoodies", "zip-hoodie", "red"],
          }),
        }),
      ),
      "the nested colourway is self-canonical — it is a Tier-1 indexable URL in its own right, and the sitemap advertises it",
    ).toBe(`${SITE_URL}${base}/red`);
  });
});

describe("the canonical is a property of the product, not of the request", () => {
  it("is identical from either category the product belongs to", async () => {
    const viaHoodies = canonicalOf(
      await shopMetadata({
        params: Promise.resolve({
          slug: ["clothing", "hoodies", "blue-hoodie"],
        }),
      }),
    );
    const viaAccessories = canonicalOf(
      await shopMetadata({
        params: Promise.resolve({ slug: ["accessories", "blue-hoodie"] }),
      }),
    );

    expect(
      viaAccessories,
      "a canonical derived from the requested chain would make every reachable chain declare itself an original — the duplicate split in a new shape, and a 308 target that varies by referrer",
    ).toBe(viaHoodies);
    expect(viaHoodies).toBe(CANONICAL_URL);
  });
});

describe("a product with no category ancestry", () => {
  /** A store on WooCommerce's default `/product/` permalink base. */
  const NO_ANCESTRY = {
    ...PRODUCT,
    uri: "https://commerce.example.com/product/blue-hoodie/",
    categories: [],
  };

  it("stays on the flat path, self-canonical, with no redirect loop", async () => {
    vi.doMock("@/lib/product-cache", () => ({
      getCachedProduct: (): Promise<unknown> => Promise.resolve(NO_ANCESTRY),
      getProductForPage: (): Promise<unknown> => Promise.resolve(NO_ANCESTRY),
    }));
    vi.resetModules();
    const { ProductRoute: Page } = await import("./products/[...slug]/page");
    const { generateMetadata: metadata } =
      await import("./products/[...slug]/page");

    redirectedTo.mockClear();
    const rendered = await Page({
      params: Promise.resolve({ slug: ["blue-hoodie"] }),
    });

    expect(
      redirectedTo,
      "the flat path IS this product's canonical, so redirecting would loop forever",
    ).not.toHaveBeenCalled();
    expect(rendered, "it must still serve a page").toBeTruthy();

    const canonical = canonicalOf(
      await metadata({ params: Promise.resolve({ slug: ["blue-hoodie"] }) }),
    );
    expect(
      canonical,
      "one self-consistent canonical, and never an `undefined` path segment",
    ).toBe(`${SITE_URL}/products/blue-hoodie`);
    expect(canonical).not.toContain("undefined");

    vi.doUnmock("@/lib/product-cache");
    vi.resetModules();
  });

  /**
   * Same product, but it still LISTS categories — the common case on a store
   * using WooCommerce's default `/product/` permalink base. The crumb is
   * recoverable from those, and WHICH category it picks used to be wrong: it
   * took `categories[0]`, which is order-dependent on the payload, the exact
   * determinism rule the canonical itself obeys.
   *
   * `winter` is listed FIRST here and `hoodies` second, so `categories[0]` and
   * "smallest slug" disagree — which is what this separates. WHERE the crumb
   * links is settled separately and deliberately flat; see the next case.
   */
  const NO_ANCESTRY_WITH_CATEGORIES = {
    ...PRODUCT,
    uri: "https://commerce.example.com/product/blue-hoodie/",
    categories: [
      { id: "cw", name: "Winter", slug: "winter" },
      { id: "c1", name: "Hoodies", slug: "hoodies" },
    ],
  };

  it("chooses its fallback crumb deterministically, never by payload order", async () => {
    vi.doMock("@/lib/product-cache", () => ({
      getCachedProduct: (): Promise<unknown> =>
        Promise.resolve(NO_ANCESTRY_WITH_CATEGORIES),
      getProductForPage: (): Promise<unknown> =>
        Promise.resolve(NO_ANCESTRY_WITH_CATEGORIES),
    }));
    vi.resetModules();
    const { ProductPageContent: Content } =
      await import("./products/[...slug]/page");

    const rendered = await Content({
      params: Promise.resolve({ slug: ["blue-hoodie"] }),
    });
    const crumbs = propsOf(rendered, "BreadcrumbJsonLD")?.items as
      | { name: string; href: string }[]
      | undefined;

    expect(
      crumbs?.map((crumb) => crumb.href),
      "the fallback crumb must not depend on the payload's ordering (`categories[0]` is `winter` here) — and it stays on the FLAT collection path on purpose, because the only way to nest it is a category-tree read that would put `TAG.collections` on every PDP of a default-permalink store",
    ).toEqual(["/", "/shop", "/collections/hoodies", "/products/blue-hoodie"]);
    expect(
      crumbs?.at(-2)?.name,
      "the label follows the same deterministic choice as the href",
    ).toBe("Hoodies");

    vi.doUnmock("@/lib/product-cache");
    vi.resetModules();
  });

  /**
   * The tag, not the URL, is why that crumb is flat.
   *
   * `collectionPathResolver` is the only way to recover a nested path from a
   * bare slug, and it is a `"use cache"` entry carrying `cacheTag(TAG.collections)`
   * — a tag WordPress fires on ANY product or category change. `ProductPageContent`
   * is not itself inside a `"use cache"` scope, so that tag lands on the ROUTE's
   * entry, and on a store using WooCommerce's default `/product/` permalink base
   * EVERY product takes this branch. One product save would then purge every PDP
   * on the store — the Bike Society hazard `lib/cache-tags.ts` records.
   *
   * So the property worth pinning is not the crumb's shape but the absence of
   * the read: the PDP must never touch the category tree. Asserted on the SDK
   * call itself rather than on a tag spy, because "no read" is the stronger and
   * more durable statement — a read that acquired no tag today would acquire one
   * the moment the resolver's caching changed.
   */
  it("never reads the category tree, so the PDP cannot inherit the whole-catalogue tag", async () => {
    vi.doMock("@/lib/product-cache", () => ({
      getCachedProduct: (): Promise<unknown> =>
        Promise.resolve(NO_ANCESTRY_WITH_CATEGORIES),
      getProductForPage: (): Promise<unknown> =>
        Promise.resolve(NO_ANCESTRY_WITH_CATEGORIES),
    }));
    vi.resetModules();
    const { ProductPageContent: Content } =
      await import("./products/[...slug]/page");

    getCategories.mockClear();
    const rendered = await Content({
      params: Promise.resolve({ slug: ["blue-hoodie"] }),
    });

    expect(rendered, "it must still serve a page").toBeTruthy();
    expect(
      getCategories,
      "the PDP must resolve its crumb without the category tree — reading it subscribes every PDP on a default-permalink store to headkit:collections",
    ).not.toHaveBeenCalled();

    vi.doUnmock("@/lib/product-cache");
    vi.resetModules();
  });
});

/** Depth-first search of a rendered element tree for one component's props. */
function propsOf(
  node: unknown,
  componentName: string,
): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOf(child, componentName);
      if (found) return found;
    }
    return null;
  }
  const element = node as {
    type?: { name?: string };
    props?: Record<string, unknown>;
  };
  if (
    typeof element.type === "function" &&
    element.type.name === componentName
  ) {
    return element.props ?? {};
  }
  return propsOf(element.props?.children, componentName);
}

describe("the PDP renders links on the canonical shape", () => {
  it("puts the product crumb on the canonical path and the category crumbs on nested collection paths", async () => {
    const rendered = await ProductPageContent({
      params: Promise.resolve({ slug: ["blue-hoodie"] }),
    });

    const crumbs = propsOf(rendered, "BreadcrumbJsonLD")?.items as
      | { name: string; href: string }[]
      | undefined;

    expect(
      crumbs?.map((crumb) => crumb.href),
      "the crumb trail follows the product's OWN category ancestry, each level linked to the collection path that level canonicalises to — `/collections/{first-category}` was both flat and order-dependent",
    ).toEqual([
      "/",
      "/shop",
      "/collections/clothing",
      "/collections/clothing/hoodies",
      CANONICAL_PATH,
    ]);
  });

  it("gives the colourway router the canonical base, so a colour switch stays in one namespace", async () => {
    const rendered = await ProductPageContent({
      params: Promise.resolve({ slug: ["blue-hoodie"] }),
    });

    expect(
      propsOf(rendered, "ProductDetail")?.productBasePath,
      "colour selection pushes `${base}/{colour}` — a flat base would eject the shopper from the canonical namespace on every swatch click",
    ).toBe(CANONICAL_PATH);
  });
});

/**
 * ── The sweep: no surface may emit the flat shape ──────────────────────────
 *
 * Two findings in the first review round were the same defect twice — a code
 * path that still emitted the FLAT URL and compiled happily while doing it
 * (`collectionPathResolver` swallowing a transport error into an empty index;
 * the PDP's no-ancestry crumb linking `/collections/{slug}`, which a later
 * round then made the DELIBERATE behaviour — see the exemption below). Two of
 * them means
 * the sweep across route families had been spot-checked, not proven. The
 * ticket's invariant is that EVERY internal link and EVERY JSON-LD url names
 * the canonical, and "every" is worth proving once here rather than re-auditing
 * by hand each time a surface is added.
 *
 * So each surface below is RENDERED and the URLs it emits are collected into
 * ONE set, which is then asserted against as a whole. Adding a surface is one
 * entry in `LINK_SURFACES`.
 *
 * WHY THIS LIST IS THE COMPLETE SET. A product or collection URL can reach a
 * reader in exactly four ways, and each is represented:
 *
 *   - an `<a href>` a component renders → `ProductCard` (its main href AND its
 *     colourway swatch hrefs), `SubcategoryCard`, `CategoryCarousel`
 *   - a path handed to the client router → `productBasePath` on `ProductDetail`
 *   - a URL inside a JSON-LD graph → `ProductJsonLD` (`url`, `offers.url` and
 *     every variant `url`), `BreadcrumbJsonLD` items, `CarouselProductJsonLD`
 *   - a `<loc>` in the sitemap → `sitemap()`
 *
 * The remaining link surfaces build their hrefs from the same two helpers this
 * set already exercises: nav and collection crumbs from
 * `collectionPathFromCategory` / `buildBreadcrumbFromCategory`, related and
 * upsell cards from `ProductCard`. The cart drawer and quote cart are the one
 * documented exception (no permalink in the cart fragment) and are excluded on
 * purpose — see the note at both call sites.
 *
 * ── WHAT THIS PROOF DOES NOT COVER ────────────────────────────────────────
 *
 * State the boundary rather than imply a guarantee. Three separate rounds of
 * this branch shipped green while a surface still emitted the retired shape,
 * every time because a check read as if it proved more than it checked. So:
 *
 *  - IT COVERS the RENDERED output of the surfaces in `LINK_SURFACES` above,
 *    under Vitest, against the fixture catalogue and `CATEGORY_TREE` in this
 *    file. A shape only some real store produces — a deeper tree, a different
 *    permalink base — is not exercised here.
 *  - IT DOES NOT COVER the Playwright specs in `apps/starter/e2e/`. Those carry
 *    their own hardcoded URLs and are a separate audit surface: `pdp-variants`,
 *    `wishlist`, `cart-ops` and `forms-gravity` each had to be repaired by hand
 *    after this sweep was already passing.
 *  - IT DOES NOT COVER the specs CI never runs. `.github/workflows/ci.yml`
 *    keeps an IGNORE list (`forms-gravity`, `gift-card`, `product-addons`,
 *    `store-parity` — licence/fixture-gated), so a stale assertion in one of
 *    those can survive a fully green pipeline indefinitely. `forms-gravity`
 *    did exactly that.
 *  - IT DOES NOT COVER the PDP's no-ancestry fallback crumb, which names the
 *    FLAT `/collections/{slug}` ON PURPOSE. On a store using WooCommerce's
 *    default `/product/` permalink base that is every PDP breadcrumb on the
 *    store, not a rare degraded path. It is exempt because the only way to nest
 *    it subscribes every PDP to a whole-catalogue purge tag; see the comment at
 *    the branch in `app/products/[...slug]/page.tsx` and `AGENTS.md`. The
 *    fixtures in `LINK_SURFACES` all have NESTED permalinks, so the exempt
 *    branch is never reached here — the ban below is not silently skipping it.
 *  - IT DOES NOT COVER the HTTP status code. Whether the losing shape really
 *    answers 308 rather than 200-plus-a-client-redirect depends on Suspense
 *    altitude and cannot be seen from a unit render at all — that is
 *    `e2e/canonical-url-308.spec.ts`, and only against a running build.
 *
 * FIXTURE CAVEAT, or the sweep would be wrong: a product with no `/shop`
 * permalink is LEGITIMATELY canonical at `/products/{slug}`, so every fixture
 * used here has a NESTED permalink. The no-ancestry describe above is the
 * separate case proving that path still serves flat and self-canonical.
 */

/** Site-relative path of an emitted URL, absolute or already relative. */
function pathOfUrl(value: string): string {
  return value.startsWith("/") ? value : new URL(value).pathname;
}

/** Every `href` a render emitted. */
function allHrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);
}

/**
 * Every value at a key named `url`, at any depth of a JSON-LD graph.
 *
 * Generic rather than a fixed list of paths so a graph that grows a new url
 * field (a variant, an `ItemList` entry) is swept without editing this file.
 * schema.org vocabulary URLs sit under `@context` / `availability` /
 * `itemCondition`, never under `url`, so they are not collected.
 */
function jsonLdUrls(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(jsonLdUrls);
  if (!node || typeof node !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "url" && typeof value === "string") out.push(value);
    else out.push(...jsonLdUrls(value));
  }
  return out;
}

/** Swatch links only render when the store has them switched on. */
const SWATCH_PREFS = {
  showVariants: true,
  showSwatches: true,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

function cardHrefs(product: unknown): string[] {
  return allHrefs(
    renderToStaticMarkup(
      <CatalogDisplayProvider prefs={SWATCH_PREFS}>
        <ProductCard product={product as CatalogProduct} />
      </CatalogDisplayProvider>,
    ),
  );
}

/** One category node shaped as the collection surfaces consume it. */
function categoryNode(
  slug: string,
  name: string,
  ancestors: { slug: string; name: string }[] = [],
): never {
  return {
    id: slug,
    name,
    slug,
    description: "",
    thumbnail: "",
    uri: "",
    seo: null,
    children: [],
    ancestors,
  } as never;
}

const LINK_SURFACES: { name: string; urls: () => Promise<string[]> }[] = [
  {
    name: "ProductCard — simple product",
    urls: async () => cardHrefs(PRODUCT),
  },
  {
    name: "ProductCard — variable product (main href + colourway swatches)",
    urls: async () => cardHrefs(VARIABLE_PRODUCT),
  },
  {
    name: "ProductPageContent — breadcrumbs, ProductDetail base, Product JSON-LD",
    urls: async () => {
      const tree = await ProductPageContent({
        params: Promise.resolve({ slug: [PRODUCT.slug] }),
      });
      const crumbs = (propsOf(tree, "BreadcrumbJsonLD")?.items ?? []) as {
        href: string;
      }[];
      const basePath = propsOf(tree, "ProductDetail")?.productBasePath as
        | string
        | undefined;
      // Rendered from the props the PAGE handed it, so the graph under test is
      // the one the route actually emits — not a hand-built call.
      const graph = await graphOf(
        ProductJsonLD(propsOf(tree, "ProductJsonLD") as never),
      );
      return [
        ...crumbs.map((crumb) => crumb.href),
        ...(basePath ? [basePath] : []),
        ...jsonLdUrls(graph),
      ];
    },
  },
  {
    name: "ProductPageContent — variable product, variant JSON-LD urls",
    urls: async () => {
      const tree = await ProductPageContent({
        params: Promise.resolve({ slug: [VARIABLE_PRODUCT.slug] }),
      });
      const graph = await graphOf(
        ProductJsonLD(propsOf(tree, "ProductJsonLD") as never),
      );
      return jsonLdUrls(graph);
    },
  },
  {
    // The COLOURWAY param, not just the base. `buildVariantUrl` derives every
    // `hasVariant[].offers.url` by appending a colour to the `url` prop, so
    // handing it a path that already carries one produces `.../red/blue` — a
    // remainder `resolveShopPath` calls unknown, i.e. a 404 in JSON-LD on
    // exactly the Tier-1 URLs the sitemap advertises. Rendering only the base
    // param missed that entirely, which is why a sweep that skips colourway
    // PDPs is not the completeness proof this file claims to be.
    name: "ProductPageContent — COLOURWAY PDP, variant JSON-LD urls",
    urls: async () => {
      const tree = await ProductPageContent({
        params: Promise.resolve({ slug: [VARIABLE_PRODUCT.slug, "red"] }),
      });
      const crumbs = (propsOf(tree, "BreadcrumbJsonLD")?.items ?? []) as {
        href: string;
      }[];
      const basePath = propsOf(tree, "ProductDetail")?.productBasePath as
        | string
        | undefined;
      const graph = await graphOf(
        ProductJsonLD(propsOf(tree, "ProductJsonLD") as never),
      );
      return [
        ...crumbs.map((crumb) => crumb.href),
        ...(basePath ? [basePath] : []),
        ...jsonLdUrls(graph),
      ];
    },
  },
  {
    name: "CarouselProductJsonLD — ItemList item urls",
    urls: async () => {
      const graph = await graphOf(
        CarouselProductJsonLD({
          products: [PRODUCT, VARIABLE_PRODUCT] as never,
        }),
      );
      return jsonLdUrls(graph);
    },
  },
  {
    name: "SubcategoryCard — child tile beneath its parent's canonical path",
    urls: async () =>
      allHrefs(
        renderToStaticMarkup(
          <SubcategoryCard
            subcategory={categoryNode("hoodies", "Hoodies")}
            // The parent's own canonical, exactly as `CollectionRoute` derives
            // it before handing it down.
            parentPath={collectionPathFromCategory(
              categoryNode("clothing", "Clothing"),
            )}
          />,
        ),
      ),
  },
  {
    // THE WIRING, not the leaf. `SubcategoryCard` above is handed a
    // `parentPath` by hand, which only proves the card concatenates — never in
    // doubt. The ancestry is actually carried by
    // `CollectionRoute` → `CollectionHeader(childBasePath)` →
    // `SubcategoryCarousel(parentPath)` → `SubcategoryCard`, and that chain had
    // no coverage at all: `childBasePath` used to default to `/collections`, so
    // a caller that dropped it emitted the losing shape with no type error and
    // no test failure. Driving the route means the props under test are the
    // ones the route really computes.
    name: "CollectionRoute → CollectionHeader → SubcategoryCarousel → SubcategoryCard",
    urls: async () => {
      const tree = await CollectionRoute({
        params: Promise.resolve({ slug: ["clothing"] }),
      });
      const crumbs = (propsOf(tree, "BreadcrumbJsonLD")?.items ?? []) as {
        href: string;
      }[];
      const header = propsOf(tree, "CollectionHeader") as React.ComponentProps<
        typeof CollectionHeader
      > | null;

      // `propsOf` walks `props.children` only, so it misses a `CollectionHeader`
      // moved into an async sub-component or passed through a non-`children`
      // prop slot — the shape `SubcategoryCarouselClient.firstCard` already uses
      // in this very chain. Without these two assertions that miss is SILENT:
      // `headerHrefs` collapses to [], the surface still emits the crumb hrefs
      // `buildBreadcrumbFromCategory` always produces, so the vacuity guard
      // below still passes, and `/collections/clothing/hoodies` is already in
      // the set from the hand-passed `SubcategoryCard` surface. The one link in
      // this chain that carries the ancestry would drop out with nothing red.
      expect(
        header,
        "propsOf could not find CollectionHeader in what CollectionRoute returned — this surface would silently stop covering the wiring it exists to cover",
      ).not.toBeNull();
      const headerHrefs = allHrefs(
        renderToStaticMarkup(<CollectionHeader {...header!} />),
      );
      expect(
        headerHrefs.length,
        "CollectionHeader rendered no links at all — the subcategory carousel is what carries `childBasePath` into `parentPath`, so zero hrefs means this surface proves nothing",
      ).toBeGreaterThan(0);

      return [...crumbs.map((crumb) => crumb.href), ...headerHrefs];
    },
  },
  {
    name: "CategoryCarousel — homepage/editorial tiles via collectionPathResolver",
    urls: async () => {
      // The real resolver against the real category tree, exactly as
      // `HomeContent` and `BlockEditor` call it — so a regression in the
      // resolver shows up here as a flat tile rather than passing silently.
      const collectionPath = await collectionPathResolver();
      return allHrefs(
        renderToStaticMarkup(
          <CategoryCarousel
            categories={[
              {
                name: "Hoodies",
                slug: "hoodies",
                uri: collectionPath("hoodies"),
                thumbnail: "",
              },
              {
                name: "Accessories",
                slug: "accessories",
                uri: collectionPath("accessories"),
                thumbnail: "",
              },
            ]}
          />,
        ),
      );
    },
  },
  {
    name: "sitemap() — every <loc>",
    urls: async () => (await sitemap()).map((entry) => entry.url),
  },
];

/**
 * `/collections/{slug}` is a LIE for any category that is not a root: it is the
 * shape `app/collections/[...slug]` 308s away from. Derived from the fixture
 * tree rather than hardcoded, so adding a nested category to `CATEGORY_TREE`
 * extends the ban automatically. A ROOT category's flat path IS its canonical
 * and is deliberately not banned.
 */
const FLAT_COLLECTION_PATHS = walkCategoryPaths(CATEGORY_TREE)
  .filter((node) => node.segments.length > 1)
  .map((node) => `/collections/${node.slug}`);

describe("no route family emits the flat shape", () => {
  it("collects every URL every link surface emits, and none of them is a loser", async () => {
    const emitted = new Map<string, string[]>();
    for (const surface of LINK_SURFACES) {
      emitted.set(surface.name, (await surface.urls()).map(pathOfUrl));
    }

    // Vacuity guard: a surface that silently stopped emitting anything would
    // satisfy the ban below without proving a thing.
    expect(
      Object.fromEntries(
        [...emitted].map(([name, paths]) => [name, paths.length > 0]),
      ),
      "a link surface emitted no URLs at all — the ban below cannot prove anything about it",
    ).toEqual(
      Object.fromEntries(LINK_SURFACES.map((surface) => [surface.name, true])),
    );

    const collected = new Set(
      [...emitted.values()].flat().map((path) => path.replace(/\/+$/, "")),
    );

    // Positive half: the winners really are in the set, so the ban below is
    // being applied to a set that contains the paths it must discriminate.
    expect([
      collected.has(CANONICAL_PATH),
      collected.has("/collections/clothing/hoodies"),
    ]).toEqual([true, true]);

    // Negative half, asserted over the whole set at once.
    const losers = [...collected].filter(
      (path) =>
        path.startsWith("/products/") || FLAT_COLLECTION_PATHS.includes(path),
    );
    expect(
      losers.sort(),
      `these paths 308 away — a surface that renders one votes the storefront's own link graph against the URL the sitemap advertises. Banned flat collection paths for this fixture: ${FLAT_COLLECTION_PATHS.join(", ")}`,
    ).toEqual([]);

    // Naming the WINNING namespace is necessary but not sufficient: a
    // `/shop/…` URL can still be one the route answers not-found for. That is
    // how a doubled colourway segment (`…/zip-hoodie/red/blue`) slipped past an
    // earlier version of this sweep — it is not the flat shape, it is simply a
    // 404. So every emitted `/shop/…` path is put through the SAME classifier
    // the route uses, and then through the same LOOKUP the route performs.
    //
    // The lookup half is load-bearing and is not a nicety: `resolveShopPath` no
    // longer answers `unknown` for a long remainder — it degrades to reading the
    // last segment as a product slug, so that a permalink whose ancestry was
    // promoted out of a truncated category tree still resolves rather than
    // 404ing. That is the right trade for real permalinks, but it means "not
    // unknown" no longer proves a URL serves. What proves it is that the slug
    // the classifier lands on is a product this catalogue actually has —
    // exactly what the route discovers when `getCachedProduct` returns null.
    const CATALOGUE = new Map<string, { slug: string; uri: string }>([
      [PRODUCT.slug, PRODUCT],
      [VARIABLE_PRODUCT.slug, VARIABLE_PRODUCT],
    ]);
    const unresolvable = [...collected]
      .filter((path) => path.startsWith(`/${SHOP_PATH_PREFIX}/`))
      .filter((path) => {
        const resolved = resolveShopPath(
          shopSegmentsFromPath(path),
          CATEGORY_TREE,
        );
        if (resolved.kind === "category") return false;
        if (resolved.kind === "product") {
          // Mirror `resolveShopProduct` exactly: a reading off a VALIDATED
          // chain needs the product to exist, and a containment reading needs
          // the product's own permalink to reproduce the requested path. A
          // doubled colourway (`…/red/blue`) offers `blue` then `red`, and even
          // if one of those were a real slug its permalink would not match — so
          // it is still reported here.
          return !resolved.candidates.some((candidate) => {
            const product = CATALOGUE.get(candidate.productSlug);
            if (!product) return false;
            if (candidate.ancestryValidated) return true;
            return productPath(product, candidate.colourSlug) === path;
          });
        }
        return true;
      });
    expect(
      unresolvable.sort(),
      "`app/shop/[...slug]` serves no page for these — either it classifies them as undecidable, or the slug it resolves is not a product in the catalogue, so the PDP answers notFound(). An emitted URL that 404s is worse than one that 308s, and a JSON-LD `url` is the one signal a crawler cannot recover from",
    ).toEqual([]);
  });
});

/**
 * DOMAIN OF THIS GUARD, and where it stops.
 *
 * It covers the interaction between the flat route's 308 and the SHOPIFY ADMIN
 * PREVIEW request (`?preview_key=…`) — nothing else about preview. It does not
 * cover the SDK header plumbing (`app/products/[...slug]/page.test.ts` owns
 * that), the `/draft-product` entry point (`lib/shopify-preview.test.ts`), or
 * the Admin fallback in commerce.
 *
 * WHY THE 308 NEEDS NO PREVIEW EXEMPTION
 *
 * A 308 drops the query string, so a preview key cannot survive one. The
 * exemption that would normally require — reading `searchParams` in the default
 * export — is unavailable: under Cache Components that is a dynamic read above
 * every Suspense boundary, which is a build error on a route with
 * `generateStaticParams`.
 *
 * No exemption is needed, because the redirect is gated on
 * `getCachedProduct` — the PUBLIC catalogue read — while preview exists
 * precisely for products that read cannot see. `GetProductBySlug` in
 * `services/commerce/internal/provider/shopify/catalog.go` only consults the
 * Admin API when the Storefront query returned nothing, and the resolver maps
 * that miss to a null product rather than an error. So for a draft the guard
 * falls through and the request reaches `ProductPageContent`, which awaits
 * `searchParams` INSIDE the boundary, where reading it is legal.
 *
 * The two cases below are therefore the whole matrix, and they are opposites by
 * construction: a draft cannot redirect, and a published product does not need
 * to preview.
 */
describe("the flat route's 308 and Shopify Admin preview", () => {
  /** A draft product: absent from the public catalogue, visible with a key. */
  const DRAFT = {
    ...PRODUCT,
    slug: "draft-hoodie",
    name: "Draft Hoodie",
    uri: "https://commerce.example.com/shop/clothing/hoodies/draft-hoodie/",
    categories: [{ id: "c1", name: "Hoodies", slug: "hoodies" }],
  };

  afterEach(() => {
    commerce.shopifyDomain = undefined;
    vi.doUnmock("@/lib/product-cache");
    vi.resetModules();
  });

  it("does not 308 a draft, so the preview key survives to the render", async () => {
    commerce.shopifyDomain = "preview.myshopify.com";
    const previewLoads = vi.fn<(slug: string, opts?: unknown) => unknown>();

    vi.doMock("@/lib/product-cache", () => ({
      // The public read a draft fails by construction — this IS the gate the
      // redirect is behind.
      getCachedProduct: (): Promise<unknown> => Promise.resolve(null),
      getProductForPage: (slug: string, opts?: unknown): Promise<unknown> => {
        if (opts === undefined) previewLoads(slug);
        else previewLoads(slug, opts);
        return Promise.resolve(DRAFT);
      },
    }));
    vi.resetModules();
    const { ProductRoute: Page, ProductPageContent: Content } =
      await import("./products/[...slug]/page");

    const props = {
      params: Promise.resolve({ slug: [DRAFT.slug] }),
      searchParams: Promise.resolve({ preview_key: "shpat-preview" }),
    };

    redirectedTo.mockClear();
    await Page(props);

    expect(
      redirectedTo,
      "a 308 here would strip ?preview_key and the merchant would land on a URL that cannot resolve the draft at all",
    ).not.toHaveBeenCalled();

    // The default export only returns the boundary, so drive the content
    // component directly — that is where `searchParams` is awaited and the
    // product is loaded. Without this the ban above would pass vacuously for a
    // page that never reaches a product read at all.
    const rendered = await Content(props);

    expect(previewLoads).toHaveBeenCalledWith(DRAFT.slug, {
      shopifyPreviewKey: "shpat-preview",
    });
    expect(
      (propsOf(rendered, "ProductJsonLD")?.product as { name?: string })?.name,
      "the DRAFT is what must render — a page that fell back to the public read would have notFound()ed instead",
    ).toBe(DRAFT.name);
  });

  /**
   * DOMAIN: the redirect gate's own provider read, in the default export.
   * It is the only PDP provider call above the Suspense boundary, so it is the
   * only one that can abort a tenant's static export. Says nothing about the
   * two reads below the boundary — `ProductPageContent` and `generateMetadata`
   * carry their own guards and their own tests (#332).
   */
  it("does not forward a Shopify preview key on WooCommerce", async () => {
    commerce.shopifyDomain = undefined;
    const previewLoads = vi.fn<(slug: string, opts?: unknown) => unknown>();

    vi.doMock("@/lib/product-cache", () => ({
      getCachedProduct: (): Promise<unknown> => Promise.resolve(null),
      getProductForPage: (slug: string, opts?: unknown): Promise<unknown> => {
        if (opts === undefined) previewLoads(slug);
        else previewLoads(slug, opts);
        return Promise.resolve(DRAFT);
      },
    }));
    vi.resetModules();
    const { ProductPageContent: Content } =
      await import("./products/[...slug]/page");

    await Content({
      params: Promise.resolve({ slug: [DRAFT.slug] }),
      searchParams: Promise.resolve({ preview_key: "shpat-preview" }),
    });

    expect(previewLoads).toHaveBeenCalledWith(DRAFT.slug);
  });

  it("serves instead of aborting when the provider fails at the redirect gate", async () => {
    vi.doMock("@/lib/product-cache", () => ({
      getCachedProduct: (): Promise<unknown> =>
        Promise.reject(
          new Error("shopify.GetProductBySlug: shopify.Query: status 401"),
        ),
      getProductForPage: (): Promise<unknown> => Promise.resolve(PRODUCT),
    }));
    vi.resetModules();
    const { ProductRoute: Route } = await import("./products/[...slug]/page");

    redirectedTo.mockClear();
    await expect(
      Route({ params: Promise.resolve({ slug: ["blue-hoodie"] }) }),
      "a provider auth failure here would abort the whole tenant export; the redirect is a consolidation and losing it costs one duplicate URL, not the page",
    ).resolves.toBeTruthy();

    expect(
      redirectedTo,
      "nothing is known about the canonical when the lookup failed, so no 308 may be guessed",
    ).not.toHaveBeenCalled();
  });

  it("still 308s a PUBLISHED product, preview key or not", async () => {
    // Same request shape as above — the key IS on the request — but the public
    // read resolves, so this is not a product preview can reveal anything extra
    // about, and the canonical consolidation applies to it exactly as it does
    // to ordinary traffic. The exemption comes from the public catalogue read
    // missing and never from the presence of `preview_key`: a redirect anyone
    // could opt out of with a query parameter would not be a redirect.
    expect(
      await flatRedirectTarget(["blue-hoodie"], {
        preview_key: "shpat-preview",
      }),
      "attaching a preview key must not buy an exemption from the 308",
    ).toBe(CANONICAL_PATH);
  });
});

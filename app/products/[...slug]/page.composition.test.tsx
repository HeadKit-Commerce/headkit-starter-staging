import { beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, type ReactElement, type ReactNode } from "react";
import { DynamicMetadataMarker } from "@/components/seo/dynamic-metadata-marker";

/**
 * Where the flat PDP puts its ONE Suspense boundary, and what goes inside it.
 *
 * With JavaScript off a shopper sees only what sits BEFORE the first
 * `<div hidden id="S:…">` in the HTML, and two things put content after it:
 * a boundary whose subtree performs a request-time read (postponed at
 * prerender), and — less obviously — any COMPLETED boundary larger than
 * React's `progressiveChunkSize` (12 800 bytes), which Fizz outlines into a
 * hidden segment plus an inline `$RC` swap. A whole product is far past that
 * budget, so a PDP inside ANY boundary is invisible with JavaScript off even
 * when fully cached. Measured on the Bike Society rehearsal store, 2026-09-10:
 * 826 visible characters in the shell (nav + footer), the entire product
 * behind `B:2`.
 *
 * So the composition this file pins is:
 *
 *   - a product the PUBLIC read resolves renders through `ProductPageBody`
 *     directly in the route — no `<Suspense>` above it, none inside it at the
 *     page level — and `searchParams` is never awaited on that path;
 *   - a NULL public read (a Shopify draft under Admin preview, a missing
 *     product, the build-time placeholder, a failed read) falls into the one
 *     boundary, whose child `ProductPageContent` is the only place that awaits
 *     `searchParams` and reads with the preview key.
 *
 * The route also returns a SECOND, always-empty boundary holding
 * `DynamicMetadataMarker` — this route's
 * `generateMetadata` awaits `searchParams`, and the marker is what keeps that
 * legal now the root layout no longer supplies a hole for every route. It is a
 * SIBLING of the content and renders `null`, so it changes no split; `pageContent`
 * below pulls the two apart, and one case asserts the marker is exactly one
 * empty boundary rather than a wrapper.
 *
 * A unit render cannot see the HTML split itself — that is
 * `scripts/static-shell-split.ts` against a built file — but it CAN see the
 * element tree the route returns, which is what decides it. The 308 half of
 * the route (`permanentRedirect` thrown above everything) is asserted in
 * `app/canonical-url-shape.test.tsx`; the status code over HTTP is
 * `e2e/canonical-url-308.spec.ts`.
 */

vi.mock("server-only", () => ({}));

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

vi.mock("next/cache", () => ({
  cacheTag: (): void => {},
  cacheLife: (): void => {},
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  permanentRedirect: (url: string): never => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  },
  unstable_rethrow: (error: unknown): void => {
    if (
      error instanceof Error &&
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_REDIRECT/.test(error.message)
    ) {
      throw error;
    }
  },
}));

const { getCachedProduct, getProductForPage } = vi.hoisted(() => ({
  getCachedProduct: vi.fn<(slug: string) => Promise<unknown>>(),
  getProductForPage:
    vi.fn<(slug: string, options?: unknown) => Promise<unknown>>(),
}));

vi.mock("@/lib/product-cache", () => ({
  getCachedProduct: (slug: string): Promise<unknown> => getCachedProduct(slug),
  getProductForPage: (slug: string, options?: unknown): Promise<unknown> =>
    options === undefined
      ? getProductForPage(slug)
      : getProductForPage(slug, options),
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    products: { list: (): Promise<never> => Promise.reject(new Error("off")) },
    brands: { get: (): Promise<null> => Promise.resolve(null) },
  },
}));

vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      branding: {
        hideEmptyCollections: false,
        defaultCollectionSort: "",
        multiAddEnabled: false,
        pdpGalleryLayout: "grid",
      },
      seoSettings: { allowIndexing: true, ogImageUrl: null },
      storeSettings: { name: "Test Store", domain: "shop.example" },
    }),
  getBrandingAssets: (): Promise<Record<string, never>> => Promise.resolve({}),
}));

vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: (): Promise<unknown> =>
    Promise.resolve({
      publishableKey: "",
      accountId: "",
      bnplMessagingEnabled: false,
    }),
}));

vi.mock("@/lib/make-metadata", () => ({
  makeSeoMetadata: (): Record<string, unknown> => ({}),
  resolveStoreName: (): string => "Test Store",
  storefrontUrl: (path: string, domain?: string | null): string =>
    `https://${domain ?? "shop.example"}${path}`,
}));

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
vi.mock("@/components/seo/product-json-ld", () => ({
  ProductJsonLD: (): null => null,
}));
vi.mock("@/components/seo/breadcrumb-json-ld", () => ({
  BreadcrumbJsonLD: (): null => null,
}));
vi.mock("@/components/headkit-ui/collection/utils", () => ({
  isColorAttrSlug: (): boolean => false,
  formatOptionName: (slug: string): string => slug,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: (): null => null }));
vi.mock("@/components/headkit-ui/skeletons/product-card-skeleton", () => ({
  ProductCardSkeleton: (): null => null,
}));

import ProductPage, {
  ProductPageBody,
  ProductPageContent,
  ProductRoute,
} from "./page";
import { ProductPageShell } from "./product-page-shell";
import { ProductStock } from "@/components/headkit-ui/product-stock";
import { ProductDetail } from "@/components/headkit-ui/product-detail";

const SLUG = "acme-hoodie";

/**
 * A product on WooCommerce's default `/product/` permalink base: no `/shop`
 * ancestry, so its canonical IS the flat path and the route serves rather than
 * redirects. That keeps the redirect out of the way of what this file pins.
 */
const FLAT_PRODUCT = {
  id: "p1",
  name: "Acme Hoodie",
  slug: SLUG,
  uri: "https://commerce.example.com/product/acme-hoodie/",
  shortDescription: "",
  description: "",
  seo: null,
  image: null,
  attributes: [],
  defaultAttributes: [],
  variations: [],
  categories: [],
  related: [],
  upsells: [],
  projects: [],
};

const NESTED_PRODUCT = {
  ...FLAT_PRODUCT,
  uri: "https://commerce.example.com/shop/clothing/acme-hoodie/",
};

/**
 * A `searchParams` promise that records whether anything awaited it. An
 * `await` on a thenable calls `then`, so the spy is the read itself — not a
 * proxy for it.
 */
function trackedSearchParams(value: Record<string, string>): {
  promise: Promise<Record<string, string>>;
  awaited: () => boolean;
} {
  let awaited = false;
  const thenable = {
    then(
      resolve: (v: Record<string, string>) => unknown,
      reject?: (e: unknown) => unknown,
    ): unknown {
      awaited = true;
      return Promise.resolve(value).then(resolve, reject);
    },
  };
  return {
    promise: thenable as unknown as Promise<Record<string, string>>,
    awaited: () => awaited,
  };
}

/** Every element in a tree, depth-first, without rendering components. */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const element = node as ReactElement<{
    children?: ReactNode;
    fallback?: ReactNode;
  }>;
  out.push(element);
  elements(element.props?.children, out);
  elements(element.props?.fallback, out);
  return out;
}

/** The route's returned children, flattened out of its wrapping fragment. */
function routeChildren(element: ReactElement): ReactElement[] {
  const children = (element.props as { children?: ReactNode }).children;
  return (Array.isArray(children) ? children : [children]).filter(
    (child): child is ReactElement =>
      typeof child === "object" && child !== null && "type" in child,
  );
}

/**
 * The page content the route composed — everything except the metadata
 * marker's empty boundary. Throws rather than returning undefined so a route
 * that stops rendering content fails here instead of passing vacuously.
 */
function pageContent(element: ReactElement): ReactElement {
  const content = routeChildren(element).filter(
    (child) => !isMarkerBoundary(child),
  );
  expect(
    content,
    "the route must return exactly one content element beside the marker",
  ).toHaveLength(1);
  return content[0]!;
}

/** True for the `<Suspense>` whose only child is the metadata marker. */
function isMarkerBoundary(element: ReactElement): boolean {
  if (element.type !== Suspense) return false;
  const child = (element.props as { children?: ReactNode }).children;
  return (
    typeof child === "object" &&
    child !== null &&
    "type" in child &&
    (child as ReactElement).type === DynamicMetadataMarker
  );
}

beforeEach(() => {
  commerce.shopifyDomain = "preview.myshopify.com";
  getCachedProduct.mockReset();
  getProductForPage.mockReset();
});

describe("products/[...slug] — a resolvable product renders OUTSIDE the boundary", () => {
  it("returns ProductPageBody directly, not a Suspense wrapper, and never awaits searchParams", async () => {
    getCachedProduct.mockResolvedValue(FLAT_PRODUCT);
    const searchParams = trackedSearchParams({ preview_key: "unused" });

    const body = pageContent(
      (await ProductRoute({
        params: Promise.resolve({ slug: [SLUG] }),
        searchParams: searchParams.promise,
      })) as ReactElement,
    ) as ReactElement<{ product: unknown; colorSlug: unknown }>;

    expect(
      body.type,
      "a product the public read resolves must be composed in the route itself; any boundary above it — postponed by a request-time read, or outlined by size — puts the whole product after the visible shell",
    ).toBe(ProductPageBody);
    expect(body.type).not.toBe(Suspense);
    expect(
      body.props.product,
      "and it renders the very object the gate resolved — one read, no second lookup below a boundary",
    ).toBe(FLAT_PRODUCT);

    expect(
      searchParams.awaited(),
      "`searchParams` is the request-time read that postponed the old boundary; a public product must never pay it",
    ).toBe(false);
    expect(
      getProductForPage,
      "the preview-keyed read belongs to the null branch only",
    ).not.toHaveBeenCalled();
  });

  it("forwards the colourway segment to the body", async () => {
    getCachedProduct.mockResolvedValue(FLAT_PRODUCT);

    const body = pageContent(
      (await ProductRoute({
        params: Promise.resolve({ slug: [SLUG, "red"] }),
      })) as ReactElement,
    ) as ReactElement<{ colorSlug: unknown }>;

    expect(body.type).toBe(ProductPageBody);
    expect(body.props.colorSlug).toBe("red");
  });

  it("mounts the metadata marker as one EMPTY sibling boundary, never a wrapper", async () => {
    getCachedProduct.mockResolvedValue(FLAT_PRODUCT);

    const element = (await ProductRoute({
      params: Promise.resolve({ slug: [SLUG] }),
    })) as ReactElement;
    const children = routeChildren(element);
    const markers = children.filter(isMarkerBoundary);

    expect(
      markers,
      "generateMetadata awaits searchParams, so this route needs exactly one marker — and only this route does; the root layout must never carry one again",
    ).toHaveLength(1);
    expect(
      markers[0]!.props,
      "the marker renders null behind a null fallback; a fallback with content would land in the shell",
    ).toMatchObject({ fallback: null });
    expect(
      children.some(
        (child) => child.type === Suspense && !isMarkerBoundary(child),
      ),
      "the product must not gain a boundary of its own",
    ).toBe(false);
  });

  it("composes the body with the five-minute stock line and no stock boundary", async () => {
    getCachedProduct.mockResolvedValue(FLAT_PRODUCT);

    const tree = await ProductPageBody({
      product: FLAT_PRODUCT as never,
      productSlug: SLUG,
      colorSlug: undefined,
    });

    const rendered = elements(tree);
    expect(
      rendered.filter((element) => element.type === Suspense),
      "the product composition has no boundary at all, the stock slot included",
    ).toEqual([]);

    const detail = rendered.find(
      (element) => element.type === ProductDetail,
    ) as ReactElement<{ stockSlot: ReactElement }> | undefined;
    expect(
      detail,
      "positive control: the body rendered the detail",
    ).toBeDefined();
    const slot = detail!.props.stockSlot as ReactElement;
    expect(
      slot.type,
      "the stock slot is ProductStock itself: the five-minute read stays in the stored document, so it has no Suspense boundary",
    ).toBe(ProductStock);
  });

  it("still throws the 308 above everything for a product whose canonical is nested", async () => {
    getCachedProduct.mockResolvedValue(NESTED_PRODUCT);
    const searchParams = trackedSearchParams({ preview_key: "k" });

    await expect(
      ProductRoute({
        params: Promise.resolve({ slug: [SLUG] }),
        searchParams: searchParams.promise,
      }),
    ).rejects.toThrow(/NEXT_REDIRECT;\/shop\/clothing\/acme-hoodie/);
    expect(
      searchParams.awaited(),
      "a published product 308s with a key attached; the key is never consulted",
    ).toBe(false);
  });
});

describe("products/[...slug] — a NULL public read is the only path into the boundary", () => {
  it("wraps ProductPageContent in Suspense with the PDP skeleton, and only that branch awaits searchParams", async () => {
    getCachedProduct.mockResolvedValue(null);
    getProductForPage.mockResolvedValue(FLAT_PRODUCT);
    const searchParams = trackedSearchParams({ preview_key: "draft-key" });

    const boundary = pageContent(
      (await ProductRoute({
        params: Promise.resolve({ slug: [SLUG] }),
        searchParams: searchParams.promise,
      })) as ReactElement,
    ) as ReactElement<{
      fallback: ReactElement;
      children: ReactElement<Parameters<typeof ProductPageContent>[0]>;
    }>;

    expect(
      boundary.type,
      "a draft and a missing product are the same null here; only a request-time read can tell them apart, and that read must sit below a boundary",
    ).toBe(Suspense);
    expect(boundary.props.fallback.type).toBe(ProductPageShell);
    expect(boundary.props.children.type).toBe(ProductPageContent);
    expect(
      searchParams.awaited(),
      "the route itself never awaits searchParams — doing so would turn the whole route dynamic",
    ).toBe(false);

    // The branch inside the boundary is where the preview key is read.
    const rendered = await ProductPageContent(boundary.props.children.props);
    expect(searchParams.awaited()).toBe(true);
    expect(getProductForPage).toHaveBeenCalledWith(SLUG, {
      shopifyPreviewKey: "draft-key",
    });
    expect(rendered, "and it renders the draft it resolved").toBeTruthy();
  });

  it("does not read a Shopify preview key when the store is WooCommerce", async () => {
    commerce.shopifyDomain = undefined;
    getCachedProduct.mockResolvedValue(null);
    getProductForPage.mockResolvedValue(FLAT_PRODUCT);
    const searchParams = trackedSearchParams({ preview_key: "draft-key" });

    const page = ProductPage({
      params: Promise.resolve({ slug: [SLUG] }),
      searchParams: searchParams.promise,
    }) as ReactElement;
    expect(routeChildren(page).filter(isMarkerBoundary)).toHaveLength(0);

    const route = (await ProductRoute({
      params: Promise.resolve({ slug: [SLUG] }),
      searchParams: searchParams.promise,
    })) as ReactElement;
    expect(
      routeChildren(route).filter(isMarkerBoundary),
      "WooCommerce does not mount connection() for a Shopify preview key",
    ).toHaveLength(0);
    const boundary = (
      route.type === Suspense ? route : pageContent(route)
    ) as ReactElement<{
      children: ReactElement<Parameters<typeof ProductPageContent>[0]>;
    }>;
    await ProductPageContent(boundary.props.children.props);
    expect(searchParams.awaited()).toBe(false);
    expect(getProductForPage).toHaveBeenCalledWith(SLUG);
  });

  it("answers the build-time placeholder from the boundary without touching the cache", async () => {
    const boundary = pageContent(
      (await ProductRoute({
        params: Promise.resolve({ slug: ["__hk_static_placeholder"] }),
      })) as ReactElement,
    );

    expect(boundary.type).toBe(Suspense);
    expect(getCachedProduct).not.toHaveBeenCalled();
  });

  it("falls through to the boundary when the public read throws, so the request-time branch can retry", async () => {
    getCachedProduct.mockRejectedValue(new Error("provider 401"));

    const boundary = pageContent(
      (await ProductRoute({
        params: Promise.resolve({ slug: [SLUG] }),
      })) as ReactElement,
    );

    expect(
      boundary.type,
      "a thrown read is not evidence of a missing product and must not fail the route; the branch below the boundary reads again and degrades honestly if that fails too",
    ).toBe(Suspense);
  });
});

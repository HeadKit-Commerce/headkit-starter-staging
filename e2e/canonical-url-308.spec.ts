import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./helpers";

/**
 * The 308 half of the one-canonical-URL invariant, asserted over real HTTP.
 *
 * LOCAL-ONLY (HARD RULE): every request here goes to the localhost Docker
 * stack, GET only. Nothing is signed in, added to a cart, or purchased.
 *
 * WHY THIS SPEC EXISTS AT THE HTTP LAYER AND NOT IN VITEST. The canonical
 * decision names five signals that must agree, and four of them
 * (`<link rel="canonical">`, internal links, JSON-LD, the sitemap) are values a
 * unit test can read straight out of a render. The fifth — "the `Location` of a
 * 308 served from the losing shape" — is not a value any render produces. It is
 * the STATUS LINE Next writes, and whether `permanentRedirect()` becomes a real
 * 308 or an already-committed 200 carrying a client-side redirect is decided by
 * where the throw sits relative to every Suspense boundary ABOVE the page: the
 * route's own, one implied by a route-level `loading.tsx`, and the one
 * `app/layout.tsx` wraps `{children}` in. Calling the page function directly
 * throws `NEXT_REDIRECT` under all of them, so a unit test is green under all of
 * them; asserting instead that a particular `loading.tsx` is absent checks one
 * of the three conditions while reading as if it checked the property — the
 * guard this spec replaces asserted exactly that and stayed green through three
 * review rounds while every losing URL served 200. Only a request to a built,
 * running app observes the status code, so that is what this asserts.
 *
 * MEASURED, on a Next 16.3 production build with `cacheComponents: true`,
 * changing one variable at a time (this is the table the deleted unit guard
 * carried, plus the ancestor-layout row it missed):
 *
 *   redirect below an in-page `<Suspense>`      → 200 + shell, `Location` never sent
 *   redirect in the default export, with a
 *     route-level `loading.tsx`                 → 200 + shell, `Location` never sent
 *   redirect in the default export, with a
 *     `<Suspense>` in the ROOT LAYOUT           → 200 + shell, `Location` never sent
 *   redirect in the default export, none of
 *     the three                                 → 308, prerendered and at runtime alike
 *
 * `instant = true` makes no difference in any row. The root-layout row is the
 * one that hides: it lives in a file no redirecting route mentions, and it
 * re-broke both route families after their own `loading.tsx` files were deleted.
 *
 * CARD ROUTES NO LONGER TAKE THE `loading.tsx` ROW. #601 (`be499c4d`) removed
 * the route-level `loading.tsx` from `app/products/[...slug]`,
 * `app/collections/[...slug]`, and the brand, news, and projects twins so
 * those routes paint from the static shell. `permanentRedirect` in the
 * default export, with none of the three boundaries above it, is a real 308.
 * A path-only flat product or collection URL therefore answers 308, and its
 * `Location` pathname is the nested URL the sitemap advertises. Putting
 * `loading.tsx` back would stream a 200 and hide that redirect. A
 * query-carrying flat URL is still a different request: `proxy.ts` issues
 * that 308 (campaign query, `?preview_key=` on a published product) before
 * the route renders, and those cases stay 308 with the query preserved.
 *
 * STORE-AGNOSTIC BY CONSTRUCTION. No slug is hard-coded. The sitemap is the
 * storefront's own published statement of the winning URL for every product and
 * collection, so the fixtures are READ from it and the flat counterpart is
 * derived. That makes the assertion stronger than a literal would be: it proves
 * the nested canonical (path-only) and the 308 target (query-carrying) are the
 * SAME STRING the sitemap advertises, rather than two strings that happen to
 * look alike — the precise failure being guarded against is a sitemap
 * advertising one shape while the app serves another.
 *
 * A store whose sitemap advertises no nested URL at all (every product on
 * WooCommerce's default `/product/` base, a flat category tree) has nothing to
 * redirect and legitimately serves one shape; those fixtures skip rather than
 * inventing a URL to fail on.
 */

/** Site-relative path of a sitemap `<loc>` or a `Location` header. */
function pathOf(url: string): string {
  return new URL(url, BASE_URL).pathname;
}

async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(res.status(), "sitemap.xml must serve").toBe(200);
  const xml = await res.text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    pathOf(m[1]!),
  );
  expect(paths.length, "an empty sitemap proves nothing").toBeGreaterThan(0);
  return paths;
}

/**
 * A base PDP among the sitemap's nested product URLs.
 *
 * `app/sitemap.ts` emits one entry per colourway alongside the base
 * (`/shop/{cat…}/{slug}` plus `/shop/{cat…}/{slug}/{colour}`), and only the
 * base is what `/products/{slug}` redirects to. A colourway is by construction
 * a strict path extension of its base, and no category archive appears under
 * `/shop` in the sitemap, so "has no other sitemap entry as a prefix" selects
 * bases without needing to know which segment is a colour.
 */
function nestedProductBase(paths: string[]): string | undefined {
  const shop = paths.filter((p) => p.startsWith("/shop/"));
  const set = new Set(shop);
  return shop
    .filter((p) => {
      const parent = p.slice(0, p.lastIndexOf("/"));
      return !set.has(parent);
    })
    .sort()[0];
}

/**
 * Collection paths that are pure category chains.
 *
 * The sitemap also carries Tier-1 facet URLs, which put a literal `f` segment
 * between the category chain and the encoded filter
 * (`/collections/accessories/f/color.black`). Those are not a parent/child
 * category pair and must never be read as one.
 */
function categoryChains(paths: string[]): string[][] {
  return paths
    .filter((p) => p.startsWith("/collections/"))
    .map((p) => p.split("/").filter(Boolean).slice(1))
    .filter((segments) => segments.length > 0 && !segments.includes("f"));
}

test.describe("one canonical URL shape @seo", () => {
  test("the flat product URL 308s onto the nested one the sitemap advertises", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nested = nestedProductBase(paths);
    test.skip(!nested, "no nested product URL in this store's sitemap");

    const slug = nested!.split("/").pop()!;
    const flat = `/products/${slug}`;

    const res = await request.get(`${BASE_URL}${flat}`, { maxRedirects: 0 });
    expect(
      res.status(),
      `${flat} 308s because the product route has no loading.tsx. A 200 here would mean that boundary was put back.`,
    ).toBe(308);
    const locationHeader = res
      .headersArray()
      .find((h) => h.name.toLowerCase() === "location");
    expect(
      locationHeader,
      `${flat} must send a Location naming ${nested}`,
    ).toBeDefined();
    const location = new URL(locationHeader!.value, BASE_URL);
    expect(
      location.pathname,
      `${flat} must 308 to ${nested}, the nested URL the sitemap advertises`,
    ).toBe(nested);
  });

  test("the flat collection URL 308s onto the nested one the sitemap advertises", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const chains = categoryChains(paths);
    // A child category: a chain of two or more segments. Its flat loser is
    // always `/collections/{last segment}`.
    const nestedChain = chains.filter((c) => c.length >= 2)[0];
    test.skip(!nestedChain, "no nested collection URL in this store's sitemap");

    const nested = `/collections/${nestedChain!.join("/")}`;
    const flat = `/collections/${nestedChain!.at(-1)}`;

    const res = await request.get(`${BASE_URL}${flat}`, { maxRedirects: 0 });
    expect(
      res.status(),
      `${flat} 308s because the collection route has no loading.tsx. A 200 here would mean that boundary was put back.`,
    ).toBe(308);
    const locationHeader = res
      .headersArray()
      .find((h) => h.name.toLowerCase() === "location");
    expect(
      locationHeader,
      `${flat} must send a Location naming ${nested}`,
    ).toBeDefined();
    const location = new URL(locationHeader!.value, BASE_URL);
    expect(
      location.pathname,
      `${flat} must 308 to ${nested}, the nested URL the sitemap advertises`,
    ).toBe(nested);
  });

  /**
   * ISSUE #74. A 308 built from the path alone drops the whole query string, so
   * a campaign link to a flat URL loses `gclid`, `utm_*` and Klaviyo's `_kx`
   * before the page can read them — and the visitor still ends on a 200, which
   * is why it goes unreported. The redirect is issued from `proxy.ts` (the only
   * layer that sees the query; a route's default export cannot read
   * `searchParams` — see "Setting a status code needs THREE conditions" in
   * `AGENTS.md`), so the target path and the 308 itself must be UNCHANGED and
   * only the query is added. Both are asserted here.
   *
   * The unit guard `lib/canonical-redirect.test.ts` covers the rule; it cannot
   * see a status line or a `Location` header, which is why these live here.
   */
  const CAMPAIGN_QUERY =
    "utm_source=e2e&utm_medium=email&gclid=e2e-gclid&_kx=e2e-kx";

  test("the flat product 308 carries the campaign query through @seo", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nested = nestedProductBase(paths);
    test.skip(!nested, "no nested product URL in this store's sitemap");

    const slug = nested!.split("/").pop()!;
    const res = await request.get(
      `${BASE_URL}/products/${slug}?${CAMPAIGN_QUERY}`,
      { maxRedirects: 0 },
    );

    expect(
      res.status(),
      "preserving the query must not change WHICH urls redirect, or the status",
    ).toBe(308);
    const location = new URL(
      res.headersArray().find((h) => h.name.toLowerCase() === "location")!
        .value,
      BASE_URL,
    );
    expect(location.pathname, "nor the target path").toBe(nested);
    expect(
      location.search,
      "a dropped gclid cannot be tied back to the click that paid for it",
    ).toBe(`?${CAMPAIGN_QUERY}`);
  });

  test("the flat collection 308 carries the campaign query through @seo", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nestedChain = categoryChains(paths).filter((c) => c.length >= 2)[0];
    test.skip(!nestedChain, "no nested collection URL in this store's sitemap");

    const nested = `/collections/${nestedChain!.join("/")}`;
    const res = await request.get(
      `${BASE_URL}/collections/${nestedChain!.at(-1)}?${CAMPAIGN_QUERY}`,
      { maxRedirects: 0 },
    );

    expect(res.status()).toBe(308);
    const location = new URL(
      res.headersArray().find((h) => h.name.toLowerCase() === "location")!
        .value,
      BASE_URL,
    );
    expect(location.pathname).toBe(nested);
    expect(location.search).toBe(`?${CAMPAIGN_QUERY}`);
  });

  test("the flat product URL still resolves, and lands on the canonical", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nested = nestedProductBase(paths);
    test.skip(!nested, "no nested product URL in this store's sitemap");

    const slug = nested!.split("/").pop()!;
    // Redirects followed: the flat shape must remain a reachable URL rather
    // than a 404, and whatever it lands on must name the nested canonical.
    const res = await request.get(`${BASE_URL}/products/${slug}`);
    expect(res.status()).toBe(200);
    const canonical = (await res.text()).match(
      /<link rel="canonical" href="([^"]+)"/,
    );
    expect(canonical, "the PDP must emit a canonical").not.toBeNull();
    expect(pathOf(canonical![1]!)).toBe(nested);

    expect(
      paths.filter((p) => p.startsWith("/products/")),
      "the sitemap must never advertise the losing flat shape",
    ).toEqual([]);
  });

  test("a root category is self-canonical and does not redirect-loop", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const rootChain = categoryChains(paths).filter((c) => c.length === 1)[0];
    test.skip(!rootChain, "no root collection URL in this store's sitemap");

    const root = `/collections/${rootChain![0]}`;
    const res = await request.get(`${BASE_URL}${root}`, { maxRedirects: 0 });
    expect(
      res.status(),
      `${root} is its own canonical — redirecting it would loop.`,
    ).toBe(200);
    const canonical = (await res.text()).match(
      /<link rel="canonical" href="([^"]+)"/,
    );
    expect(
      canonical,
      "the collection page must emit a canonical",
    ).not.toBeNull();
    expect(pathOf(canonical![1]!)).toBe(root);
  });

  /**
   * DOMAIN OF THIS TEST, and where it stops.
   *
   * It asserts the ONE property the Shopify Admin preview flow needs from this
   * route family: whether a `?preview_key=` request is redirected. A 308 drops
   * the query string, so a redirect and a surviving preview key are mutually
   * exclusive — that is the whole interaction, and it is decided entirely by
   * the public catalogue lookup the redirect is gated on.
   *
   * IT DOES NOT PROVE A DRAFT RENDERS. That needs a Shopify store with an
   * unpublished product and a live Admin key; this stack is WooCommerce, and
   * the e2e stack is local-only by hard rule. The render half is covered in
   * `app/canonical-url-shape.test.tsx`, which models the real contract from
   * `services/commerce/internal/provider/shopify/catalog.go`: the Admin API is
   * consulted only when the Storefront query returned nothing.
   *
   * What IS store-agnostic — and what this asserts — is the gate itself. A slug
   * the public catalogue cannot resolve is exactly the position a draft product
   * occupies, whatever the provider.
   */
  test("a preview request is never redirected out of its query string", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nested = nestedProductBase(paths);
    test.skip(!nested, "no nested product URL in this store's sitemap");

    const slug = nested!.split("/").pop()!;

    // A PUBLISHED product still 308s with a key attached. The exemption below
    // must come from the lookup missing, never from the mere presence of
    // `preview_key` — a request-shaped exemption would be a redirect anyone
    // could opt out of by appending a query parameter.
    const published = await request.get(
      `${BASE_URL}/products/${slug}?preview_key=e2e-not-a-real-key`,
      { maxRedirects: 0 },
    );
    expect(
      published.status(),
      "a published product must consolidate exactly as it does for ordinary traffic; preview reveals nothing extra about it",
    ).toBe(308);

    // A slug the PUBLIC catalogue cannot resolve — the position a draft
    // occupies — is not redirected, so its query string reaches the render.
    const unresolvable = await request.get(
      `${BASE_URL}/products/e2e-no-such-product-${Date.now()}?preview_key=e2e-not-a-real-key`,
      { maxRedirects: 0 },
    );
    expect(
      unresolvable.status(),
      "a 3xx here would strip ?preview_key before anything could read it, and the Admin lookup that resolves a draft would never run",
    ).toBeLessThan(300);
  });
});

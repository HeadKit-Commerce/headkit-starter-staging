import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./helpers";

/**
 * The HTTP status contract for a missing URL, asserted over real HTTP.
 *
 * LOCAL-ONLY (HARD RULE): every request here goes to the localhost Docker
 * stack, and every one is a GET. Nothing is signed in, added to a cart, or
 * purchased.
 *
 * WHY THIS LIVES AT THE HTTP LAYER. Every dynamic segment answered 200 for a
 * missing URL while rendering the not-found UI, because `notFound()` was raised
 * inside a `<Suspense>` boundary — after Cache Components had already committed
 * the 200 status line. Link checkers, crawlers and uptime monitoring read the
 * status, not the pixels, so a broken internal link was invisible and every
 * junk URL was an indexable duplicate of the not-found page. No unit test can
 * observe it: calling the page function throws `NEXT_HTTP_ERROR_FALLBACK` under
 * every arrangement, so a unit test is green under all of them. Only a request
 * to a built, running app sees the status code. `app/not-found-status.test.ts`
 * asserts the STRUCTURE that produces it and runs in the unit gate; this spec
 * asserts the property. Keep both.
 *
 * BOTH DIRECTIONS, DELIBERATELY. Gating a route on an existence check is the
 * kind of fix that can over-trigger, and a route family that 404s its REAL
 * pages takes the store down — far worse than the bug. So each family is proven
 * in both directions, and the live URLs are read from the store's own sitemap
 * rather than hard-coded, which would rot per store.
 *
 * EIGHT FAMILIES, NOT NINE. `/products/{missing}` is a DELIBERATE, ACCEPTED
 * EXCLUSION — MEASURED on a local Next 16.3 production build it answers 200
 * with two robots metas and the not-found UI, and no case below asserts
 * otherwise. The flat PDP was left un-gated on purpose so the Shopify
 * Admin draft-preview flow, which another team owns, stays untouched: the
 * public catalogue read returns null for a draft and for a missing product
 * alike, and the preview key that separates them is only readable BELOW the
 * boundary. Recorded in `docs/tickets/products-flat-url-soft-404.md`. Do not
 * "restore" a `/products/{missing}` case here — it would fail, and the gap it
 * describes is decided, not forgotten. `/products/` stays in `LIVE_PREFIXES`
 * below, because the 200 direction is still worth proving.
 */

/** Slugs no store will ever serve, on routes that still answer a real 404. */
const MISSING = [
  { family: "wordpress page", path: "/this-page-does-not-exist-xyz" },
  { family: "client", path: "/client/this-client-does-not-exist-xyz" },
  {
    family: "collection",
    path: "/collections/this-category-does-not-exist-xyz",
  },
  { family: "shop", path: "/shop/this-product-does-not-exist-xyz" },
  { family: "brand", path: "/brand/this-brand-does-not-exist-xyz" },
  { family: "news", path: "/news/this-post-does-not-exist-xyz" },
  {
    family: "project",
    path: "/projects/this-project-does-not-exist-xyz",
  },
  // The one gated route with no dynamic segment, so its condition set differs
  // from every entry above: no `generateStaticParams`, no in-page `<Suspense>`.
  // It is also the one whose 404 depends on the FIXTURE — a store that has a
  // `wholesale` WordPress page serves it, correctly — so it carries a skip.
  {
    family: "wholesale",
    path: "/wholesale",
    absentOnlyWhenUnpublished: true,
  },
] as const;

/**
 * Brand, news and project articles are cached documents with no `loading.tsx`,
 * so a missing URL answers 404. `/products/{missing}` stays a soft 404 so the
 * Shopify preview key can be read below its one boundary.
 */

/** Route prefixes to sample a REAL, live URL for from the sitemap. */
const LIVE_PREFIXES = [
  "/products/",
  "/collections/",
  "/news/",
  "/shop/",
  "/brand/",
  "/projects/",
];

/** Every `<loc>` in the sitemap, as site-relative paths. */
async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(res.status(), "sitemap.xml must be served").toBe(200);
  const xml = await res.text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    const raw = m[1]!.trim();
    try {
      return new URL(raw, BASE_URL).pathname;
    } catch {
      return raw;
    }
  });
  expect(paths.length, "an empty sitemap proves nothing").toBeGreaterThan(0);
  return paths;
}

test.describe("missing pages return a real 404 @seo", () => {
  for (const entry of MISSING) {
    const { family, path } = entry;
    const fixtureDependent =
      "absentOnlyWhenUnpublished" in entry && entry.absentOnlyWhenUnpublished;

    test(`${family}: ${path} is 404`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`);

      // A real page at a fixture-dependent path is a valid store, not a pass:
      // this run cannot observe the property, so it says so loudly rather than
      // asserting nothing. Same shape as the live-URL block below.
      test.skip(
        fixtureDependent && res.status() === 200,
        `${path} is published on this store, so its 404 path cannot be ` +
          `proven here. Unpublish it before trusting this run.`,
      );

      expect(
        res.status(),
        `${path} must answer 404. A 200 here is the soft-404 regression: the ` +
          `not-found UI renders, but every link checker, crawler and uptime ` +
          `monitor reads this status and sees a healthy page — and once the ` +
          `store's indexing switch is on, every junk URL becomes an indexable ` +
          `duplicate of the not-found page.`,
      ).toBe(404);

      const body = await res.text();

      // The fix is about the status line only — the body must be unchanged.
      expect(
        body,
        `${path} answered 404 but stopped rendering the not-found UI.`,
      ).toContain("Page not found");

      // The duplicate `robots` meta was the SAME defect, not a second one:
      // Next injects a bare `noindex` into the already-streaming body when it
      // cannot send the status. One tag means the status went out in time.
      expect(
        body.match(/<meta[^>]+name="robots"/g)?.length ?? 0,
        `${path} carries more than one robots meta. The extra bare ` +
          `\`noindex\` is Next's own injection for a not-found render it could ` +
          `no longer set a status for, so its presence means the response had ` +
          `already committed 200.`,
      ).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("real pages still return 200 @seo", () => {
  test("the homepage is 200", async ({ request }) => {
    expect(
      (await request.get(BASE_URL)).status(),
      "the homepage must serve — a 404 here means the gate over-triggered",
    ).toBe(200);
  });

  for (const prefix of LIVE_PREFIXES) {
    test(`a real ${prefix} url is 200`, async ({ request }) => {
      const paths = await sitemapPaths(request);
      const live = paths.find((p) => p.startsWith(prefix) && p !== prefix);

      // A store with no posts (or no nested shop URLs) is a valid store, and a
      // fixture gap must not read as a pass. Skip loudly instead.
      test.skip(
        !live,
        `sitemap.xml lists no ${prefix} url — cannot prove this family still ` +
          `serves 200. Seed one before trusting this run.`,
      );

      const res = await request.get(`${BASE_URL}${live}`);
      expect(
        res.status(),
        `${live} is in the store's own sitemap, so it must answer 200. A 404 ` +
          `here means the not-found gate over-triggered and this route family ` +
          `is down — a strictly worse outcome than the soft 404 it replaced.`,
      ).toBe(200);
    });
  }
});

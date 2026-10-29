import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./helpers";

/**
 * The Markdown twins and `/llms.txt`, asserted over real HTTP.
 *
 * LOCAL-ONLY (HARD RULE): localhost Docker stack, GET and HEAD only. Nothing is
 * signed in, added to a cart, or purchased.
 *
 * WHY HTTP AND NOT VITEST. `lib/markdown/proxy-rewrite.test.ts` proves the proxy
 * decides to rewrite; it cannot see that the matcher admits a `.md` path at all
 * (the catch-all excludes every dotted path), that a flat `/products/{slug}`
 * reaches the rewrite before the canonical-redirect 308 would take it, or the
 * headers a real route handler writes.
 *
 * STORE-AGNOSTIC: no slug is hard-coded. The fixtures are read from the
 * sitemap, as `canonical-url-308.spec.ts` does.
 */

const MARKDOWN = { Accept: "text/markdown" };
const BROWSER = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(res.status(), "sitemap.xml must serve").toBe(200);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]!, BASE_URL).pathname,
  );
}

/** A base product page: a `/shop/...` entry with no other entry as its parent. */
function productSlug(paths: string[]): string | undefined {
  const shop = new Set(paths.filter((p) => p.startsWith("/shop/")));
  const base = [...shop]
    .filter((p) => !shop.has(p.slice(0, p.lastIndexOf("/"))))
    .sort()[0];
  return base?.split("/").pop();
}

function collectionPath(paths: string[]): string | undefined {
  return paths
    .filter((p) => p.startsWith("/collections/") && !p.includes("/f/"))
    .sort()[0];
}

function expectMarkdown(res: {
  status(): number;
  headers(): Record<string, string>;
}): void {
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-type"]).toContain("text/markdown");
  expect(h["x-robots-tag"]).toBe("noindex");
  expect(h["vary"]).toContain("Accept");
  expect(h["link"]).toMatch(/^<https?:\/\/[^>]+>; rel="canonical"$/);
}

test.describe("Markdown representations @seo", () => {
  test("every mirrored family answers Accept: text/markdown with the contract headers", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const slug = productSlug(paths);
    const collection = collectionPath(paths);
    const targets = ["/", "/search", slug && `/products/${slug}`, collection];
    expect(targets.filter(Boolean).length).toBeGreaterThanOrEqual(3);

    for (const target of targets.filter((t): t is string => Boolean(t))) {
      const res = await request.get(`${BASE_URL}${target}`, {
        headers: MARKDOWN,
        maxRedirects: 0,
      });
      expectMarkdown(res);
      expect(await res.text(), target).toMatch(/^---\ntitle: /);
    }
  });

  test(".md reaches the same twin, with no Accept header needed", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const slug = productSlug(paths);
    test.skip(!slug, "no product in this store's sitemap");

    for (const target of ["/index.md", "/search.md", `/products/${slug}.md`]) {
      const res = await request.get(`${BASE_URL}${target}`, {
        headers: BROWSER,
        maxRedirects: 0,
      });
      expectMarkdown(res);
    }
  });

  test("the product twin's canonical is the sitemap's HTML URL, not the flat mirror URL", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const slug = productSlug(paths);
    test.skip(!slug, "no product in this store's sitemap");
    const nested = paths.find(
      (p) => p.startsWith("/shop/") && p.endsWith(`/${slug}`),
    );

    const res = await request.get(`${BASE_URL}/products/${slug}`, {
      headers: MARKDOWN,
      maxRedirects: 0,
    });
    expectMarkdown(res);
    expect(
      new URL(/<([^>]+)>/.exec(res.headers()["link"]!)![1]!).pathname,
    ).toBe(nested);
  });

  test("a browser, and a client sending */*, still get HTML at the same URLs", async ({
    request,
  }) => {
    for (const accept of [BROWSER.Accept, "*/*"]) {
      const res = await request.get(`${BASE_URL}/`, {
        headers: { Accept: accept },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
    }
    // The flat product URL is the proxy's 308, exactly as before.
    const paths = await sitemapPaths(request);
    const slug = productSlug(paths);
    if (slug) {
      const res = await request.get(`${BASE_URL}/products/${slug}`, {
        headers: BROWSER,
        maxRedirects: 0,
      });
      expect(res.status()).toBe(308);
    }
  });

  test("a page with no twin, and a missing slug, are not answered with Markdown", async ({
    request,
  }) => {
    const paths = await sitemapPaths(request);
    const nested = paths.find(
      (p) => p.startsWith("/shop/") && p.split("/").length > 3,
    );
    if (nested) {
      const res = await request.get(`${BASE_URL}${nested}`, {
        headers: MARKDOWN,
      });
      expect(res.headers()["content-type"]).toContain("text/html");
    }
    const missing = await request.get(
      `${BASE_URL}/products/no-such-product-hk.md`,
    );
    expect(missing.status()).toBe(404);
    expect(missing.headers()["x-robots-tag"]).toBe("noindex");
  });

  test("/llms.txt lists the store and its collections, and robots.txt is untouched by it", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/llms.txt`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toMatch(/^# /);
    expect(body).toContain("## Browse");
    expect(body).toContain("Accept: text/markdown");

    const robots = await (await request.get(`${BASE_URL}/robots.txt`)).text();
    // The internal route tree is under /api, which robots.txt already disallows.
    expect(robots).toMatch(/Disallow: \/api\/\*/);
    expect(robots).not.toContain("markdown");
  });
});

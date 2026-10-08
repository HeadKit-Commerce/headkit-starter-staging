/**
 * The cache profile's carve-outs: cached reads that must stay FINITE in both
 * profiles.
 *
 * `lib/cache-profile.ts` lets a store raise its cached reads to `max`, where a
 * tag purge is the only thing that refreshes an entry. That trade is
 * acceptable for content — a stale price is visibly wrong and recoverable.
 * It is not acceptable for a read whose result decides a STATUS CODE or an
 * INDEXABILITY signal: a cached-empty category at `max` pins a 404 on a real
 * page, and a cached null in `generateMetadata` pins a NOINDEX, either of them
 * until the next deploy. Those are silent, and they are the exact failures the
 * fork this came from recorded.
 *
 * So this is a lint-style tripwire, not a behavioural test. It reads the
 * sources and fails if one of the named reads acquires a `max` lifetime —
 * whether by a literal or through `cacheLifeForProfile`'s aggressive argument.
 * It cannot prove the list is complete; adding a new status-code read means
 * adding it here.
 *
 * ONE DELIBERATE EXCEPTION, not listed below: `getCachedProduct`
 * (`lib/product-cache.ts`) does feed the flat PDP's 308 and the nested route's
 * 404 probe, and the aggressive profile DOES raise it to `max`. The fork made
 * that call explicitly, with the risk stated: the theme fires
 * `headkit:product:{slug}` on every product save, so the purge path for this
 * one entry is the best-covered in the storefront. A store on the conservative
 * default keeps today's finite `days` backstop either way.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STARTER_ROOT = join(import.meta.dirname, "..");

/** Reads that decide a status code or an indexability signal. */
const FINITE_IN_BOTH_PROFILES: { file: string; fn: string; why: string }[] = [
  {
    file: "app/[...slug]/page.tsx",
    fn: "getPageData",
    why: "the landing route's 404 gate",
  },
  {
    file: "app/[...slug]/page.tsx",
    fn: "getPostsLandingSlug",
    why: "decides whether a slug is the posts landing at all",
  },
  {
    file: "app/brand/[...slug]/page.tsx",
    fn: "getBrandShell",
    why: "the brand route's 404 gate",
  },
  {
    file: "lib/collection-canonical.ts",
    fn: "getCategoryData",
    why: "the collection 404's existence check and the 308's redirect source",
  },
  {
    file: "app/news/[...slug]/page.tsx",
    fn: "getPost",
    why: "the post route's 404 gate",
  },
  {
    file: "app/projects/[...slug]/page.tsx",
    fn: "getProject",
    why: "the project route's 404 gate",
  },
  {
    file: "app/shop/[...slug]/page.tsx",
    fn: "getShopCategoryTree",
    why: "classifies every nested path, so it decides the route's status code",
  },
  {
    file: "app/shop/[...slug]/page.tsx",
    fn: "getShopCategory",
    why: "a cached null returns NOINDEX from generateMetadata",
  },
  {
    file: "lib/posts-base-path.ts",
    fn: "getPostsLanding",
    why: "decides the base path every post URL is built from",
  },
  {
    file: "lib/posts-base-path.ts",
    fn: "getPostsBasePath",
    why: "same, and feeds the posts 404 gate",
  },
  {
    file: "lib/branding.ts",
    fn: "getBranding",
    why: "carries the store's indexing switch and canonical domain",
  },
  {
    file: "lib/product-cache.ts",
    fn: "getProductStock",
    why: "is the five-minute availability read; pinning it at max would hold stock until the next deploy",
  },
];

/**
 * The text of the first lifetime call inside a function — `cacheLife(...)` or
 * `cacheLifeForProfile(...)` — from the call to its closing `);`. Deliberately
 * crude: a source scan is the only way to see a call site that a mocked test
 * would never reach.
 */
function cacheLifeCallIn(source: string, fn: string): string {
  const declaration = source.indexOf(`function ${fn}(`);
  expect(declaration, `${fn} is not declared where expected`).toBeGreaterThan(
    -1,
  );
  const match = /cacheLife(?:ForProfile)?\(/.exec(source.slice(declaration));
  expect(match, `${fn} sets no cache lifetime`).not.toBeNull();
  const call = declaration + match!.index;
  const end = source.indexOf(");", call);
  return source.slice(call, end + 2);
}

describe("reads that decide a status code stay finite in both profiles", () => {
  for (const { file, fn, why } of FINITE_IN_BOTH_PROFILES) {
    it(`${file} — ${fn} (${why})`, () => {
      const source = readFileSync(join(STARTER_ROOT, file), "utf8");
      const call = cacheLifeCallIn(source, fn);
      expect(
        call,
        `${fn} in ${file} would be pinned at \`max\` under the aggressive ` +
          `cache profile. That read ${why}, so pinning it survives until the ` +
          `next deploy. See lib/cache-profile.ts.`,
      ).not.toContain('"max"');
    });
  }
});

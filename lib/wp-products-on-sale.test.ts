import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for `headkit/v2/products?on_sale=true` — the query behind
 * `/sale`, the home page's On Sale fallback carousel, and every Load More,
 * sort and facet read on that route.
 *
 * THE DEFECT. The endpoint implemented `on_sale` as a hand-rolled two-clause
 * meta_query: `_sale_price > 0` OR `_min_variation_sale_price > 0`. The second
 * key is a WooCommerce 2.x price-cache key that modern WooCommerce no longer
 * writes — measured at ZERO rows on a WooCommerce 11.1.2 store — so the OR
 * collapsed to "the PARENT post carries a sale price", which is the definition
 * of a discounted SIMPLE product. A variable product keeps its sale prices on
 * its VARIATIONS and its own `_sale_price` is empty, so every on-sale variable
 * product was invisible. One store served 16 of its 132 on-sale products; all
 * 116 missing ones were variable. The fix asks WooCommerce instead —
 * `wc_get_product_ids_on_sale()`, the call the theme's four other on-sale
 * surfaces already make — and narrows with `post__in`.
 *
 * Two properties are load-bearing and neither is visible in a count:
 *
 *   - the result must carry BOTH product types, because the regression was
 *     type-skewed rather than short; and
 *   - a store with NOTHING on sale must return ZERO products. WP_Query IGNORES
 *     an empty `post__in` and serves the entire catalogue, so the `array(0)`
 *     sentinel is the only thing standing between "no sale items" and "every
 *     product you sell is on sale". The harness's WP_Query reproduces that
 *     core behaviour, so this assertion fails for real if the guard is dropped.
 *
 * The theme ships no PHP test runner, so this guard runs the theme's PHP
 * directly out of the vitest suite that already gates every PR — the same
 * shape as `wp-featured-brands-cap.test.ts`. `php` is preinstalled on the
 * `ubuntu-latest` CI runner. macOS has not bundled `php` since Monterey, so
 * the suite SKIPS on a developer machine without it and FAILS in CI, where a
 * silent skip would let the regression back in.
 *
 * Behavioural, not a source assertion: the harness loads the REAL endpoint
 * file unmodified and reads what it returned and what it sent to WP_Query.
 * Verified red against the pre-fix endpoint — every assertion below failed
 * except the `is_new` one. Note what the red run actually showed: the harness's
 * WP_Query does not evaluate `_sale_price` meta (it implements only the two
 * mechanisms this guard is about, `post__in` and a `_price` clause), so the old
 * code returned all 6 seeded products there rather than the 2 simple ones a
 * real WordPress would have returned. The decisive evidence is therefore the
 * KEYS the old code sent (`_sale_price`, `_min_variation_sale_price`, with no
 * `post__in`) and the no-sale case, which returned the whole catalogue for real.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/products-on-sale-harness.php",
);

interface HarnessResult {
  /** Every seeded product, so a filtered count means something. */
  catalogueTotal: number;
  noFilterPostIn: number[] | null;
  onSaleTotal: number;
  /** product type => count, for the products `on_sale=true` returned. */
  onSaleTypes: Record<string, number>;
  onSaleSlugs: string[];
  onSalePostIn: number[] | null;
  /** The meta_query keys the request sent to WP_Query. */
  onSaleMetaKeys: string[];
  composedTotal: number;
  composedSlugs: string[];
  composedMetaKeys: string[];
  composedHasPostIn: boolean;
  /** `on_sale=true` on a store where WooCommerce reports nothing on sale. */
  nothingTotal: number;
  nothingPostIn: number[] | null;
  isNewHasDateQuery: boolean;
  isNewPostIn: number[] | null;
  isNewMetaKeys: string[];
}

/** A working `php` on PATH — the harness is executed, not parsed. */
function hasPhp(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PHP_AVAILABLE = hasPhp();
const IS_CI = Boolean(process.env.CI);

const SUITE = "WordPress products endpoint: on_sale filter";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
// Carried in the suite title so the reporter says WHY it was skipped — skipIf
// itself takes no message.
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function run(): HarnessResult {
  const stdout = execFileSync("php", [HARNESS], { encoding: "utf8" });
  return JSON.parse(stdout) as HarnessResult;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  let result: HarnessResult;

  beforeAll(() => {
    // Only reachable in CI: the local run without `php` skipped above. A
    // missing runtime here means the runner image stopped shipping it, and
    // skipping would silently drop the only guard on this regression.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping. " +
          "Install php on the runner, or run locally where it skips instead.",
      );
    }
    result = run();
  });

  it("returns on-sale products of BOTH types, not just simple ones", () => {
    // The seed is 6 products, 4 on sale: 2 simple and 2 variable. The old
    // query returned the 2 simple ones and reported a total of 2.
    expect(result.catalogueTotal).toBe(6);
    expect(result.onSaleTotal).toBe(4);
    expect(result.onSaleTypes).toEqual({ simple: 2, variable: 2 });
    expect(result.onSaleSlugs).toEqual([
      "harness-product-1001",
      "harness-product-1003",
      "harness-product-1004",
      "harness-product-1006",
    ]);
  });

  it("never asks WP_Query for the dead WooCommerce 2.x price-cache key", () => {
    // `_min_variation_sale_price` matches nothing on modern WooCommerce, and a
    // `_sale_price` clause can only ever see the parent post. Neither may come
    // back by any route — `on_sale` alone needs no meta_query at all now.
    expect(result.onSaleMetaKeys).not.toContain("_min_variation_sale_price");
    expect(result.onSaleMetaKeys).not.toContain("_sale_price");
    expect(result.onSaleMetaKeys).toEqual([]);
  });

  it("returns ZERO products when the store has nothing on sale", () => {
    // Not a no-op: WP_Query IGNORES an empty post__in, so without the
    // `array(0)` sentinel this request serves the entire catalogue — every
    // product in the shop, listed as on sale.
    expect(result.nothingTotal).toBe(0);
    expect(result.nothingPostIn).toEqual([0]);
  });

  it("narrows, not widens, when composed with the price filter", () => {
    // Price 80-600 holds 1003 (100), 1004 (500) and 1005 (200); only the first
    // two are on sale. The old OR'd meta_query had the price clause overwrite
    // its `relation`, so the two filters interacted; `post__in` + `_price` is
    // a plain intersection.
    expect(result.composedTotal).toBe(2);
    expect(result.composedSlugs).toEqual([
      "harness-product-1003",
      "harness-product-1004",
    ]);
    expect(result.composedMetaKeys).toEqual(["_price"]);
    expect(result.composedHasPostIn).toBe(true);
  });

  it("passes WooCommerce's raw ids through without inflating the total", () => {
    // `wc_get_product_ids_on_sale()` returns variation ids alongside parents
    // (1,035 raw ids for 132 products on the investigated store). 9001 is a
    // variation and not a product post, so it rides in post__in and
    // contributes nothing to the result.
    expect(result.onSalePostIn).toContain(9001);
    expect(result.onSaleTotal).toBe(4);
  });

  it("leaves is_new and the unfiltered list alone", () => {
    // `is_new` is a date_query on post_date — a different mechanism, and
    // type-agnostic by construction. A request with no on-sale filter must set
    // no post__in at all.
    expect(result.isNewHasDateQuery).toBe(true);
    expect(result.isNewPostIn).toBeNull();
    expect(result.isNewMetaKeys).toEqual([]);
    expect(result.noFilterPostIn).toBeNull();
  });
});

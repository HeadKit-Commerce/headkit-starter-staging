import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for the list/summary product payload's variation stubs on
 * a variable product with NO swatch (colour) attribute — the payload every
 * collection card (`/sale`, `/shop`, category and brand grids, the home page
 * carousels) reads its strike-through price from.
 *
 * THE DEFECT. `headkit_format_summary_colourway_variations()` in
 * `integrations/wordpress/theme/inc/rest-api/headkit-products.php` builds one
 * variation stub per colourway and returned ZERO stubs when the product had
 * no colour axis. A variable parent's `regular_price` is an EMPTY STRING in
 * WooCommerce — the regular price lives only on the variations — so a
 * size-only SALE product's summary carried no regular price anywhere and the
 * storefront card (correctly) refused to strike a price it did not have.
 * Measured on the Bike Society production store, 2026-10-12: 3 of the 24
 * cards on `/sale` page one were unstruck, all three variable with size as
 * the only attribute; across all 116 on-sale variable products
 * `variations.length` equalled the colour-option count exactly, 20 at zero.
 *
 * The fix returns ONE stub for that shape — the lowest-priced variation,
 * built by the same `headkit_format_variation()` as a colourway stub. The
 * storefront's existing price resolver then strikes with no change here.
 *
 * The theme ships no PHP test runner, so this guard runs the theme's PHP
 * directly out of the vitest suite that already gates every PR — the same
 * shape as `wp-products-on-sale.test.ts`. `php` is preinstalled on the
 * `ubuntu-latest` CI runner. macOS has not bundled `php` since Monterey, so
 * the suite SKIPS on a developer machine without it and FAILS in CI, where a
 * silent skip would let the regression back in.
 *
 * Behavioural, not a source assertion: the harness loads the REAL endpoint
 * file unmodified and reads what the summary formatter returned. Verified red
 * against the pre-fix endpoint: the size-only product returned 0 stubs while
 * the colourway product returned the same two stubs it returns now.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/summary-sizeonly-variation-stub-harness.php",
);

interface StubPriceFields {
  id: number;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  attributes: Record<string, string>;
}

interface HomepageVariation {
  id: number;
  price: string;
  regularPrice: string;
  salePrice: string;
  onSale: boolean;
  attributes: { nodes: Array<{ name: string; value: string }> };
}

interface HarnessResult {
  simpleVariations: unknown[];
  /** The variable parent's own regular_price — '' in WooCommerce. */
  sizeOnlyParentRegular: string;
  sizeOnlyCount: number;
  sizeOnlyStub: StubPriceFields | null;
  sizeOnlyStubKeys: string[];
  noDefaultCount: number;
  noDefaultPickedId: number | null;
  colourwayCount: number;
  colourwayPickedIds: number[];
  colourwayStubKeys: string[];
  homepageVariationCount: number;
  homepageVariation: HomepageVariation | null;
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

const SUITE = "WordPress summary payload: size-only variable product stub";
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

  it("gives a size-only variable product exactly ONE stub carrying the regular price", () => {
    // The parent has no regular price of its own; the stub is the only place
    // the payload can carry one. Seed: three sizes at 90 / 80 / 80, regular 120.
    expect(result.sizeOnlyParentRegular).toBe("");
    expect(result.sizeOnlyCount).toBe(1);
    expect(result.sizeOnlyStub).toMatchObject({
      price: "80",
      regular_price: "120",
      sale_price: "80",
      on_sale: true,
    });
  });

  it("picks the lowest price, then the WooCommerce default, then the newest", () => {
    // 6002 (M, default) and 6003 (L, newer) both cost 80 and beat 6001 (S, 90):
    // the default wins the tie. 8001/8002 tie at 30 with no default set: the
    // most recently modified (8002) wins — the colourway path's own tie-break.
    expect(result.sizeOnlyStub?.id).toBe(6002);
    expect(result.sizeOnlyStub?.attributes).toEqual({ attribute_size: "M" });
    expect(result.noDefaultCount).toBe(1);
    expect(result.noDefaultPickedId).toBe(8002);
  });

  it("leaves the colourway path and simple products unchanged", () => {
    // One stub per colour, newest-in-colourway picks — the same two ids the
    // pre-fix endpoint returned for this seed. A simple product stays at [].
    expect(result.colourwayCount).toBe(2);
    expect(result.colourwayPickedIds).toEqual([7002, 7003]);
    expect(result.simpleVariations).toEqual([]);
  });

  it("builds the size-only stub with the colourway stub's exact shape", () => {
    // Same headkit_format_variation() call, so commerce decodes it unchanged.
    expect(result.sizeOnlyStubKeys).toEqual(result.colourwayStubKeys);
    expect(result.sizeOnlyStubKeys).toContain("regular_price");
  });

  it("carries the colour-less stub through the homepage carousel formatter", () => {
    // headkit_format_homepage_product maps stubs; it never keys or filters
    // them by colour, so a stub with only a size attribute rides through.
    expect(result.homepageVariationCount).toBe(1);
    expect(result.homepageVariation).toMatchObject({
      id: 6002,
      regularPrice: "120",
      salePrice: "80",
      onSale: true,
    });
    expect(result.homepageVariation?.attributes.nodes).toEqual([
      { name: "size", value: "M" },
    ]);
  });
});

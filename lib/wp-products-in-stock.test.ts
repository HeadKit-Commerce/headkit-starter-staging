import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for `headkit/v2/products?in_stock=true` — the WordPress
 * half of the collection grid's "In Stock" switch.
 *
 * THE DEFECT. The switch wrote `?instock=true` and the grid did not change:
 * no layer between the switch and WP_Query carried it. The v1 storefront sent
 * `stockStatus: [IN_STOCK, ON_BACKORDER]`, so "in stock" means purchasable
 * today and includes backorder — the Store API's
 * `stock_status=instock,onbackorder` (Road Bikes on the Bike Society
 * rehearsal store: 109 products, 99 in that set, 31 if backorder were left
 * out).
 *
 * Runs the theme's PHP harness, which loads the REAL endpoint file unmodified.
 * Verified red against the pre-fix endpoint (every assertion but the
 * unfiltered-catalogue one). Skips locally without `php`, FAILS in CI — the
 * same shape as `wp-products-on-sale.test.ts`.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/products-in-stock-harness.php",
);

interface StockClause {
  key: string;
  value: string[];
  compare: string;
}

interface HarnessResult {
  catalogueTotal: number;
  noFilterClauses: StockClause[];
  inStockTotal: number;
  inStockSlugs: string[];
  inStockClauses: StockClause[];
  offTotal: number;
  offClauses: StockClause[];
  pricedSlugs: string[];
  pricedRelation: string | null;
  pricedClauseCount: number;
  saleSlugs: string[];
}

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

const SUITE = "WordPress products endpoint: in_stock filter";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
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
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
    result = run();
  });

  it("keeps in-stock AND backorder products of both types, drops out-of-stock", () => {
    expect(result.catalogueTotal).toBe(6);
    expect(result.inStockTotal).toBe(4);
    expect(result.inStockSlugs).toEqual([
      "harness-product-1001",
      "harness-product-1002",
      "harness-product-1004",
      "harness-product-1005",
    ]);
  });

  it("sends one _stock_status IN (instock, onbackorder) clause", () => {
    expect(result.inStockClauses).toEqual([
      {
        key: "_stock_status",
        value: ["instock", "onbackorder"],
        compare: "IN",
      },
    ]);
  });

  it("narrows when composed with price and on_sale", () => {
    expect(result.pricedSlugs).toEqual([
      "harness-product-1002",
      "harness-product-1004",
    ]);
    expect(result.pricedRelation).toBe("AND");
    expect(result.pricedClauseCount).toBe(2);
    expect(result.saleSlugs).toEqual([
      "harness-product-1001",
      "harness-product-1005",
    ]);
  });

  it("sends no stock clause when the switch is off", () => {
    expect(result.noFilterClauses).toEqual([]);
    expect(result.offClauses).toEqual([]);
    expect(result.offTotal).toBe(6);
  });
});

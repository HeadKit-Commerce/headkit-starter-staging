import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for the `productIds` scope on `headkit/v2/product-filters`.
 *
 * `/search` sends the IDs its Atlas search matched, and the endpoint counts
 * the facet options over those products only, so the Brand / Category /
 * Colour / Size options agree with the grid instead of listing the whole
 * store. The failure this guards is silent in both directions: an EMPTY
 * `post__in` is "no restriction" to WP_Query, so a search that matched nothing
 * (or whose matches are none of them on sale) would answer with the
 * store-wide facets and look perfectly well-formed.
 *
 * The theme ships no PHP test runner, so this runs the harness
 * (`integrations/wordpress/theme/tests/filter-product-ids-harness.php`), which
 * drives the REAL handler through its real counting code over a seeded
 * catalogue and asserts its own contract, exiting non-zero on any failure. Same
 * arrangement as `wp-filter-swatch-gate.test.ts`: SKIPS on a developer machine
 * without `php`, FAILS in CI where a silent skip would drop the guard.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/filter-product-ids-harness.php",
);

interface FacetEntry {
  slug: string;
  count: number;
}

interface Payload {
  brands: FacetEntry[];
  categories: FacetEntry[];
}

interface HarnessResult {
  output: Record<string, Payload>;
  failures: string[];
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

const SUITE = "WordPress filters endpoint: productIds scope";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function run(): HarnessResult {
  // A failed harness assertion exits 1, which execFileSync throws on; read the
  // report off the error so the failure list reaches the test output.
  try {
    return JSON.parse(
      execFileSync("php", [HARNESS], { encoding: "utf8" }),
    ) as HarnessResult;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) return JSON.parse(stdout) as HarnessResult;
    throw error;
  }
}

function counts(entries: FacetEntry[] | undefined): Record<string, number> {
  return Object.fromEntries((entries ?? []).map((e) => [e.slug, e.count]));
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

  it("holds every assertion in the harness", () => {
    expect(result.failures).toEqual([]);
  });

  it("counts the facets over the scoped products only", () => {
    expect(counts(result.output.ids?.brands)).toEqual({ bell: 1, giro: 1 });
    expect(counts(result.output.ids?.categories)).toEqual({ helmets: 2 });
  });

  it("leaves the un-scoped read store-wide", () => {
    expect(counts(result.output.no_scope?.brands)).toEqual({
      bell: 1,
      giro: 2,
      shimano: 3,
    });
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for the public `headkit/v2` cache-lifetime contract in
 * `integrations/wordpress/theme/inc/rest-api/headkit-rest-cache.php`.
 *
 * WHAT BREAKS WHEN THIS DRIFTS. Each lifetime is a window in which a
 * storefront re-render triggered by a purge can still read PRE-EDIT data and
 * write it into an entry at `cacheLife("max")` that nothing expires until the
 * next purge or deploy. Measured on the Bike Society rehearsal store on
 * 2026-09-21 (`tigerheart-studios/bikesociety-v2#65`): a renamed product
 * served its old name on one URL and its new name on another, four minutes
 * after a purge that had been delivered correctly.
 *
 * So two properties are asserted, and the second matters as much as the first:
 *
 *   THE DEFAULT IS 10s EVERYWHERE — short enough that the revalidation delay
 *   derived from it (`headkit_revalidation_delay()`) is 30s rather than six
 *   minutes.
 *
 *   EVERY LIFETIME IS FILTERABLE, globally and per endpoint, and a filtered 0
 *   disables caching outright — so a store can tune or switch off any of this
 *   WITHOUT a theme release, which on a managed WordPress host means a manual
 *   push and hours of latency while the defect is live.
 *
 * Like `wp-revalidation-events.test.ts`, this runs the theme's own PHP:
 * `tests/rest-cache-harness.php` shims the slice of WordPress the helper
 * touches (a real filter registry, a response that records headers), loads the
 * REAL helper unmodified, and reports what it would publish.
 */

const THEME = resolve(__dirname, "../../../integrations/wordpress/theme");
const HARNESS = resolve(THEME, "tests/rest-cache-harness.php");
const CACHE_TAGS_PHP = resolve(THEME, "inc/headkit-cache-tags.php");
const REDIS_GO = resolve(
  __dirname,
  "../../../services/commerce/internal/cache/redis.go",
);

interface Published {
  max_age: number;
  cache_control: string;
  status: number;
  etag: string;
}

type ByEndpoint = Record<string, Published>;

interface HarnessOutput {
  default_max_age: number;
  endpoints: string[];
  defaults: ByEndpoint;
  helper_default: Published;
  global_override: ByEndpoint;
  global_sees_endpoint: ByEndpoint;
  per_endpoint: ByEndpoint;
  per_endpoint_beats_global: ByEndpoint;
  zero_per_endpoint: ByEndpoint;
  zero_global: ByEndpoint;
  negative_clamped: Published;
  legacy_signature: { cache_control: string; status: number };
}

/** The `no-store` form the helper publishes when a lifetime resolves to 0. */
const DISABLED = "no-store, no-cache, must-revalidate";

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

const SUITE = "WordPress theme: headkit/v2 REST cache lifetimes";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

let out: HarnessOutput;

function endpointEntry(by: ByEndpoint, endpoint: string): Published {
  const entry = by[endpoint];
  expect(entry, `${endpoint}: missing from harness output`).toBeDefined();
  return entry!;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
    out = JSON.parse(
      execFileSync("php", [HARNESS], { encoding: "utf8" }),
    ) as HarnessOutput;
  });

  describe("the default is 10 seconds, everywhere", () => {
    it("HK_REST_DEFAULT_MAX_AGE is 10", () => {
      expect(out.default_max_age).toBe(10);
    });

    it("every named endpoint publishes 10s with no filter registered", () => {
      // Each endpoint individually, so a failure names the one that drifted.
      for (const endpoint of out.endpoints) {
        const published = endpointEntry(out.defaults, endpoint);
        expect(published.max_age, `${endpoint}: max-age`).toBe(10);
        expect(published.cache_control, `${endpoint}: Cache-Control`).toBe(
          "public, max-age=10, s-maxage=10",
        );
      }
    });

    it("a call site that declares no lifetime gets the same 10s", () => {
      expect(out.helper_default.max_age).toBe(10);
    });

    it("names every endpoint the theme publishes, and no ghosts", () => {
      // The list is the filter surface's documentation: a store writing
      // `headkit_rest_max_age_{name}` has to know what {name} can be.
      expect([...out.endpoints].sort()).toEqual([
        "homepage",
        "menu_by_location",
        "menu_by_slug",
        "menus_by_location",
        "menus_list",
        "product_filters",
        "product_full",
        "product_slugs",
        "product_stock",
        "product_summary",
        "products_list",
      ]);
      expect(Object.keys(out.defaults).sort()).toEqual(
        [...out.endpoints].sort(),
      );
    });
  });

  describe("a store can tune every lifetime without a theme release", () => {
    it("the global filter moves every endpoint at once", () => {
      for (const endpoint of out.endpoints) {
        expect(
          endpointEntry(out.global_override, endpoint).max_age,
          `${endpoint}: global filter ignored`,
        ).toBe(45);
      }
    });

    it("the global filter is told which endpoint it is deciding for", () => {
      // Without the endpoint argument a store could only set one house number.
      expect(
        endpointEntry(out.global_sees_endpoint, "products_list").max_age,
      ).toBe(120);
      for (const endpoint of out.endpoints) {
        if (endpoint === "products_list") continue;
        expect(
          endpointEntry(out.global_sees_endpoint, endpoint).max_age,
          `${endpoint}: should have been left at the default`,
        ).toBe(10);
      }
    });

    it("a per-endpoint filter moves exactly one endpoint", () => {
      // The motivating case: the product LIST cached longer while the PDP,
      // which carried the defect, stays short.
      expect(endpointEntry(out.per_endpoint, "products_list").max_age).toBe(
        300,
      );
      for (const endpoint of out.endpoints) {
        if (endpoint === "products_list") continue;
        expect(
          endpointEntry(out.per_endpoint, endpoint).max_age,
          `${endpoint}: a per-endpoint filter leaked`,
        ).toBe(10);
      }
    });

    it("the per-endpoint filter overrides the global one", () => {
      expect(
        endpointEntry(out.per_endpoint_beats_global, "product_full").max_age,
      ).toBe(5);
      expect(
        endpointEntry(out.per_endpoint_beats_global, "products_list").max_age,
      ).toBe(45);
    });
  });

  describe("a filtered 0 disables caching", () => {
    it("per endpoint, leaving the others alone", () => {
      const off = endpointEntry(out.zero_per_endpoint, "product_filters");
      expect(off.max_age).toBe(0);
      // `max-age=0` still lets a shared cache STORE and revalidate. A store
      // asking for 0 is asking for no cache, so nothing may be stored.
      expect(off.cache_control).toBe(DISABLED);
      expect(endpointEntry(out.zero_per_endpoint, "product_full").max_age).toBe(
        10,
      );
    });

    it("globally, for every endpoint at once", () => {
      for (const endpoint of out.endpoints) {
        expect(
          endpointEntry(out.zero_global, endpoint).cache_control,
          `${endpoint}: still cacheable`,
        ).toBe(DISABLED);
      }
    });

    it("a negative filter value is clamped to disabled, never published", () => {
      expect(out.negative_clamped.max_age).toBe(0);
      expect(out.negative_clamped.cache_control).toBe(DISABLED);
    });
  });

  it("a caller on the pre-0.4.63 signature keeps its old lifetime", () => {
    // Silently re-reading an old `$max_age` as the new `$endpoint` would cache
    // for the default while looking correct at the call site.
    expect(out.legacy_signature.cache_control).toBe(
      "public, max-age=60, s-maxage=60",
    );
    expect(out.legacy_signature.status).toBe(200);
  });

  describe("the layers under the header agree with it", () => {
    /**
     * Purge, not TTL, invalidates commerce's Redis L2 in front of
     * `GetProducts` / `GetProductFilters`. `cache.DefaultTTLSeconds` is the
     * backstop when that purge fails, so it must strictly outlive the theme's
     * REST ceiling — the same contract `TestDefaultTTLExpiresBeforeRepairSend`
     * asserts from the Go side (`DefaultTTLSeconds` > `HK_REST_MAX_AGE_CEILING`).
     */
    it("commerce's L2 default TTL outlives HK_REST_MAX_AGE_CEILING", () => {
      const ceiling = /define\('HK_REST_MAX_AGE_CEILING',\s*(\d+)\s*\)/.exec(
        readFileSync(CACHE_TAGS_PHP, "utf8"),
      );
      const ttl = /DefaultTTLSeconds\s*=\s*(\d+)/.exec(
        readFileSync(REDIS_GO, "utf8"),
      );
      expect(ceiling?.[1], "HK_REST_MAX_AGE_CEILING not found").toBeDefined();
      expect(ttl?.[1], "cache.DefaultTTLSeconds not found").toBeDefined();
      expect(Number(ttl![1])).toBeGreaterThan(Number(ceiling![1]));
    });
  });
});

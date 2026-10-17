import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI driver for the theme's two Klaviyo harnesses (checkout plan v3 §4).
 *
 * `klaviyo-started-checkout-harness.php` — the theme's Started Checkout sender
 * listened on hooks no WooCommerce version fires, so a headless checkout sent
 * no Started Checkout with items. It now listens on
 * `woocommerce_store_api_cart_update_customer_from_request`, and advertises
 * `extensions.headkit-klaviyo.started_checkout` on the Store API cart so
 * commerce stops sending its own item-less copy.
 *
 * `klaviyo-cart-rebuild-harness.php` — `POST /headkit/v2/cart/rebuild-from-klaviyo`
 * rebuilds the plugin's `CartRebuildKey` (`normal_products`) into the Store API
 * session the storefront's Cart-Token names, which is what the storefront's
 * `/cart?wck_rebuild_cart=` route relies on.
 *
 * The theme ships no PHP test runner, so each guard is an executable harness
 * that loads the REAL theme file against recording shims. `php` is
 * preinstalled on `ubuntu-latest`; this SKIPS on a machine without it but
 * FAILS in CI, where a silent skip would drop the only guard on both contracts.
 */

const THEME_TESTS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests",
);

/** A working `php` on PATH — the harnesses are executed, not parsed. */
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

const SUITE = "WordPress theme: Klaviyo Started Checkout and cart rebuild";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
// Carried in the suite title so the reporter says WHY it was skipped — skipIf
// itself takes no message.
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

/** Run one harness; its own failure messages are the thrown error. */
function runHarness(file: string): { assertions: number; ok: boolean } {
  const stdout = execFileSync("php", [resolve(THEME_TESTS, file)], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as { assertions: number; ok: boolean };
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    // Only reachable in CI: a local run without `php` skipped above.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping. " +
          "Install php on the runner, or run locally where it skips instead.",
      );
    }
  });

  it("sends Started Checkout from the update-customer hook and advertises it", () => {
    const result = runHarness("klaviyo-started-checkout-harness.php");
    expect(result.ok).toBe(true);
    // A harness that stopped asserting would also report ok:true.
    expect(result.assertions).toBeGreaterThanOrEqual(30);
  });

  it("rebuilds the plugin's cart key into the Store API session", () => {
    const result = runHarness("klaviyo-cart-rebuild-harness.php");
    expect(result.ok).toBe(true);
    expect(result.assertions).toBeGreaterThanOrEqual(49);
  });
});

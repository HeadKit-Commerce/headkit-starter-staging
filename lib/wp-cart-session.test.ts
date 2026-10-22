import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the cart session lifetime
 * (`integrations/wordpress/theme/inc/headkit-cart-session.php`).
 *
 * A HeadKit cart is a WooCommerce Store API session whose life is the
 * Cart-Token `exp`: `time() + apply_filters('wc_session_expiration', 2 days)`
 * in WooCommerce 11.2.1's `CartTokenUtils`. The theme sets 30 days for every
 * session — WooCommerce's warning threshold, never above it — overridable per
 * store with the `HEADKIT_CART_SESSION_TTL` constant or the
 * `headkit_cart_session_ttl` filter. The storefront half (keeping the fresh
 * token so the lifetime slides) is `lib/cart-actions.ts`.
 *
 * Runs the theme's PHP harness, which loads the REAL file unmodified. Skips
 * locally without `php`, FAILS in CI — the same shape as
 * `wp-products-in-stock.test.ts`.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/cart-session-harness.php",
);

const DAY = 86_400;
const HOUR = 3_600;

interface HarnessResult {
  scenario: string;
  storeApiTokenSeconds: number;
  classicLoggedInSeconds: number;
  classicExpiringSeconds: number;
  wouldWarn: boolean;
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

const SUITE = "WordPress cart session lifetime";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function run(scenario: string): HarnessResult {
  if (!PHP_AVAILABLE) {
    throw new Error(
      "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
        "ships PHP preinstalled — so this suite fails rather than skipping.",
    );
  }
  const stdout = execFileSync("php", [HARNESS, scenario], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as HarnessResult;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  it("gives every session 30 days, guests and logged-in shoppers alike", () => {
    const r = run("default");
    expect(r.storeApiTokenSeconds).toBe(30 * DAY);
    expect(r.classicLoggedInSeconds).toBe(30 * DAY);
    expect(r.classicExpiringSeconds).toBe(29 * DAY);
  });

  it("stays inside WooCommerce's 30-day warning threshold", () => {
    // set_session_expiration warns on expiration > 30d OR expiring > 29d;
    // a 1-hour gap at 30 days (30d - 1h expiring) would trip the second.
    expect(run("default").wouldWarn).toBe(false);
  });

  it("clamps an override above 30 days to 30 days", () => {
    const r = run("over");
    expect(r.storeApiTokenSeconds).toBe(30 * DAY);
    expect(r.classicExpiringSeconds).toBe(29 * DAY);
    expect(r.wouldWarn).toBe(false);
  });

  it("honours HEADKIT_CART_SESSION_TTL defined in wp-config.php", () => {
    const r = run("constant");
    expect(r.storeApiTokenSeconds).toBe(7 * DAY);
    expect(r.classicLoggedInSeconds).toBe(7 * DAY);
    expect(r.classicExpiringSeconds).toBe(6 * DAY);
  });

  it("honours the headkit_cart_session_ttl filter", () => {
    const r = run("filter");
    expect(r.storeApiTokenSeconds).toBe(48 * HOUR);
    expect(r.classicExpiringSeconds).toBe(47 * HOUR);
  });

  it("leaves WooCommerce's own defaults when the lifetime is 0", () => {
    const r = run("off");
    expect(r.storeApiTokenSeconds).toBe(2 * DAY);
    expect(r.classicLoggedInSeconds).toBe(7 * DAY);
    expect(r.classicExpiringSeconds).toBe(DAY);
  });

  it("never sets the expiring mark to zero or below for a short lifetime", () => {
    const r = run("short");
    expect(r.storeApiTokenSeconds).toBe(30 * 60);
    expect(r.classicExpiringSeconds).toBe(30 * 60);
  });
});

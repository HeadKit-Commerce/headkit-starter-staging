import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the cart-read session extension
 * (`integrations/wordpress/theme/inc/headkit-cart-read-extend.php`).
 *
 * WooCommerce 11.2.1's Store API saves a session row only when the session
 * data changed, and then with the INCOMING Cart-Token's `exp`. A shopper who
 * only browses therefore carries an ever-fresher token (the storefront keeps
 * it, `lib/cart-actions.ts` `getCartAction`) while the row keeps the expiry of
 * their last change, and `woocommerce_cleanup_sessions` deletes the cart under
 * them. The theme extends the row on a cart read, at most once a day.
 *
 * Runs the theme's PHP harness, which loads the REAL file (and the real
 * 30-day lifetime) unmodified. Skips locally without `php`, FAILS in CI — the
 * same shape as `wp-cart-session.test.ts`.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/cart-read-extend-harness.php",
);

const DAY = 86_400;
const HOUR = 3_600;

interface HarnessResult {
  scenario: string;
  responseStatus: number;
  queries: number;
  rowExists: boolean;
  rowSecondsLeft: number | null;
  tokenSecondsLeft: number;
  rowMatchesToken: boolean;
}

/** Seconds left, allowing for a clock tick inside the harness run. */
function expectSecondsLeft(r: HarnessResult, seconds: number): void {
  expect(r.rowSecondsLeft).not.toBeNull();
  expect(Math.abs((r.rowSecondsLeft ?? 0) - seconds)).toBeLessThanOrEqual(1);
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

const SUITE = "WordPress cart read extends the session row";
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
  it("a read renews an aged row to the expiry of the token it returns", () => {
    const r = run("aged");
    expect(r.rowMatchesToken).toBe(true);
    expectSecondsLeft(r, 30 * DAY);
    expect(r.queries).toBe(1);
  });

  it("the unversioned /wc/store/cart route is covered too", () => {
    expect(run("unversioned").rowMatchesToken).toBe(true);
  });

  it("renews once the row has less than the lifetime minus a day left", () => {
    expect(run("due").rowMatchesToken).toBe(true);
  });

  it("leaves a row renewed within the last day alone", () => {
    const r = run("fresh");
    expectSecondsLeft(r, 30 * DAY - HOUR);
    expect(r.queries).toBe(1);
  });

  it("wins over WooCommerce's own save, which writes the incoming token's exp", () => {
    const r = run("dirty");
    expect(r.rowMatchesToken).toBe(true);
  });

  it("never creates a row that does not exist", () => {
    expect(run("no-row").rowExists).toBe(false);
  });

  it.each(["invalid-token", "no-token", "post", "other-route", "error"])(
    "%s: no query, row untouched",
    (scenario) => {
      const r = run(scenario);
      expect(r.queries).toBe(0);
      expectSecondsLeft(r, 5 * DAY);
    },
  );

  it("a short lifetime renews only near its end (90% rule)", () => {
    expectSecondsLeft(run("short-due"), 10 * 60);
    expectSecondsLeft(run("short-fresh"), 5 * 60);
  });
});

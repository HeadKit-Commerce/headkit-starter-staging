import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI driver for the theme's allowed billing / shipping countries harness.
 *
 * `GET /headkit/v2/settings` carries the store's selling and shipping
 * locations so a checkout can refuse an out-of-area address BEFORE taking a
 * payment. Without them the storefront only learns the restriction from
 * WooCommerce's post-payment refusal
 * (`400 woocommerce_rest_invalid_address_country`) — measured on the Bike
 * Society rehearsal store on 2026-10-15, after a Google Pay payment had
 * already succeeded.
 *
 * The theme ships no PHP test runner, so the regression guard is an executable
 * harness (`integrations/wordpress/theme/tests/settings-countries-harness.php`)
 * which stands up a `WC()->countries` that resolves the three selling modes and
 * the shipping "same as selling" fallback the way `WC_Countries` does, loads
 * the REAL endpoint file unmodified, and asserts the payload for nine store
 * shapes. An ungated harness runs only when someone remembers to run it, so
 * this spec invokes it out of the vitest suite that already gates every PR.
 *
 * `php` is preinstalled on `ubuntu-latest`, so CI needs no toolchain setup.
 * macOS has not bundled `php` since Monterey, so this SKIPS on a developer
 * machine without it but FAILS in CI, where a silent skip would drop the only
 * guard on this contract.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/settings-countries-harness.php",
);

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

const SUITE = "WordPress settings endpoint: allowed billing/shipping countries";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
// Carried in the suite title so the reporter says WHY it was skipped — skipIf
// itself takes no message.
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

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

  it("resolves every selling and shipping mode the way WooCommerce does", () => {
    // The harness exits non-zero and prints the failing assertions to stderr,
    // which execFileSync surfaces as the thrown error — so its own messages
    // are the failure output, not a generic exit-code complaint.
    const stdout = execFileSync("php", [HARNESS], { encoding: "utf8" });
    const result = JSON.parse(stdout) as { assertions: number; ok: boolean };

    expect(result.ok).toBe(true);
    // A harness that stopped asserting would also report ok:true.
    expect(result.assertions).toBeGreaterThanOrEqual(26);
  });
});

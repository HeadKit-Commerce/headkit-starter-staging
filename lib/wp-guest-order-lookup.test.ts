import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the theme's guest order lookup
 * (`GET headkit/v2/customer/orders/{orderNumber}`,
 * `integrations/wordpress/theme/inc/rest-api/headkit-orders.php`, theme 0.4.94).
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME ROUTE. On 2026-10-24 an attacker
 * enumerated Bike Society production orders through this route: the billing
 * email was checked only WHEN one was sent, so an order number alone answered
 * status, totals, dates and payment method, and a 404-vs-403 split revealed
 * which numbers existed. The route now refuses without a credential (email or
 * order key) and answers ONE 404 for not-found and mismatch alike. The theme
 * has no test runner, so the harness runs the real file against shims and this
 * suite is what fails when either rule is lost.
 *
 * `php` is preinstalled on `ubuntu-latest`. macOS has not bundled `php` since
 * Monterey, so this SKIPS locally without it — and FAILS in CI.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/guest-order-lookup-harness.php",
);

interface Outcome {
  stage: "permission" | "handler";
  http: number | null;
  code: string | null;
  message: string | null;
  orderNumber: string | null;
  fields: number;
  /** wc_get_orders / wc_get_order calls made — 0 means refused before any lookup. */
  lookups: number;
}

interface HarnessOutput {
  permission_callback: string;
  scenarios: Record<string, Outcome>;
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
const SUITE = "WordPress guest order lookup";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;

let output: HarnessOutput | undefined;
function run(): HarnessOutput {
  if (!output) {
    const stdout = execFileSync("php", [HARNESS], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    output = JSON.parse(stdout) as HarnessOutput;
  }
  return output;
}
function scenario(name: string): Outcome {
  const got = run().scenarios[name];
  if (!got) {
    throw new Error(`the harness reported no scenario named ${name}`);
  }
  return got;
}

const NOT_FOUND = {
  stage: "handler",
  http: 404,
  code: "order_not_found",
  message: "Order not found",
  orderNumber: null,
  fields: 0,
};

describe.skipIf(SKIPPING)(
  SKIPPING ? `${SUITE} [skipped: requires \`php\` on PATH]` : SUITE,
  () => {
    beforeAll(() => {
      if (!PHP_AVAILABLE) {
        throw new Error(
          "`php` is not on PATH. CI is expected to provide it, so this suite fails rather than skipping.",
        );
      }
    });

    it("no longer registers the route with an open permission callback", () => {
      expect(run().permission_callback).toBe(
        "headkit_guest_order_lookup_permission",
      );
    });

    it("refuses an order number alone BEFORE any lookup (the reproduction)", () => {
      for (const name of [
        "reproduction_number_only",
        "number_only_unknown",
        "empty_email",
      ]) {
        const got = scenario(name);
        expect(got.stage).toBe("permission");
        expect(got.http).toBe(400);
        expect(got.code).toBe("missing_credential");
        expect(got.lookups).toBe(0);
        expect(got.fields).toBe(0);
      }
    });

    it("answers with the order when the billing email matches (case- and space-insensitive)", () => {
      for (const name of [
        "right_email",
        "right_email_case_space",
        "right_email_numeric_fallback",
      ]) {
        const got = scenario(name);
        expect(got.http).toBe(200);
        expect(got.orderNumber).toBeTruthy();
        expect(got.fields).toBeGreaterThan(10);
      }
    });

    it("answers with the order when the order key matches", () => {
      expect(scenario("right_key").http).toBe(200);
      expect(scenario("right_key_via_meta_number").orderNumber).toBe(
        "BS-278942",
      );
      expect(scenario("no_email_on_order_right_key").http).toBe(200);
      expect(scenario("wrong_email_right_key").http).toBe(200);
    });

    it("answers ONE identical 404 for a mismatch and for a missing order, so numbers cannot be probed", () => {
      const names = [
        "wrong_email",
        "wrong_key",
        "key_case_changed",
        "other_orders_email",
        "unknown_order_with_email",
        "unknown_order_with_key",
        "no_email_on_order_any_email",
      ];
      const bodies = names.map((n) => {
        const { lookups: _lookups, ...rest } = scenario(n);
        return rest;
      });
      for (const body of bodies) {
        expect(body).toEqual(NOT_FOUND);
      }
      // Byte-for-byte: every refusal serialises to the same document.
      const distinct = new Set(bodies.map((b) => JSON.stringify(b)));
      expect(distinct.size).toBe(1);
    });
  },
);

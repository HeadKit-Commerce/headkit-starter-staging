import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the Woo-admin refund body the headkit-payments gateway POSTs
 * (`process_refund` in `integrations/wordpress/theme/inc/headkit-payment.php`).
 *
 * WHY. The amount used to be `intval(floatval($amount) * 100)`: 19.99 * 100 is
 * 1998.9999999999998 in IEEE double, so Stripe refunded A$19.98 for a A$19.99
 * refund WooCommerce recorded (4.35 -> 434, 1.15 -> 114, 9.95 -> 994), and a
 * JPY refund was multiplied by 100. The amount now rounds at the currency's ISO
 * minor unit for Stripe, and keeps hundredths for PayPal, whose dashboard-api
 * endpoint always divides by 100.
 *
 * The body also carries `idempotency_key` for commerce to hand Stripe, built so
 * an admin retry after a timeout sends the SAME key (WooCommerce deletes the
 * failed refund, so the refund's own id would change on retry).
 *
 * `php` is preinstalled on `ubuntu-latest`. This SKIPS on a developer machine
 * without it and FAILS in CI.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/refund-amount-harness.php",
);

interface WireCall {
  ok: boolean;
  url: string | null;
  body: Record<string, unknown> | null;
}

interface HarnessOutput {
  minor: Record<string, number>;
  legacy: Record<string, number>;
  wire: Record<string, WireCall>;
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

const SUITE = "WordPress refund amount and idempotency key";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

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

function wire(name: string): WireCall {
  const got = run().wire[name];
  if (!got) {
    throw new Error(`the harness reported no wire call named ${name}`);
  }
  return got;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  it.each([
    ["aud_19_99", 1999, 1998],
    ["aud_4_35", 435, 434],
    ["aud_1_15", 115, 114],
    ["aud_9_95", 995, 994],
  ])(
    "rounds %s to %i where the old formula truncated to %i",
    (name, want, was) => {
      expect(run().minor[name]).toBe(want);
      expect(run().legacy[name]).toBe(was);
    },
  );

  it.each([
    ["jpy_1000", 1000],
    ["krw_15000", 15000],
    ["lowercase_jpy", 1000],
    ["kwd_1_234", 1234],
    ["aud_1359_whole", 135900],
    ["aud_float_input", 1999],
    ["full_refund_null", 0],
    ["full_refund_zero", 0],
  ])("converts %s at the currency's ISO minor unit -> %i", (name, want) => {
    expect(run().minor[name]).toBe(want);
  });

  it("keeps hundredths for PayPal, whose endpoint divides by 100", () => {
    expect(run().minor.paypal_aud_19_99).toBe(1999);
    expect(run().minor.paypal_jpy_1000).toBe(100000);
  });

  it("POSTs the rounded amount and an idempotency key to commerce", () => {
    const got = wire("stripe_aud_19_99");
    expect(got.ok).toBe(true);
    expect(got.url).toMatch(/\/woocommerce\/refund$/);
    expect(got.body?.amount).toBe(1999);
    expect(got.body?.idempotency_key).toBe("headkit-refund-278970-0-1999");
    expect(wire("stripe_jpy_1000").body?.amount).toBe(1000);
  });

  it("sends PayPal the rounded amount and no idempotency key", () => {
    const got = wire("paypal_aud_19_99");
    expect(got.url).toMatch(/\/woocommerce\/refund-paypal$/);
    expect(got.body?.amount).toBe(1999);
    expect(got.body).not.toHaveProperty("idempotency_key");
  });

  it("sends the same key on an admin retry and a new one after a completed refund", () => {
    expect(wire("retry_second").body?.idempotency_key).toBe(
      wire("retry_first").body?.idempotency_key,
    );
    expect(wire("after_one_paid").body?.idempotency_key).toBe(
      "headkit-refund-278973-1-1999",
    );
    // The refund in flight is saved but not yet flagged refunded_payment.
    expect(wire("in_flight_ignored").body?.idempotency_key).toBe(
      "headkit-refund-278974-0-1999",
    );
  });
});

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the commerce -> WordPress checkout signature (checkout plan v2,
 * D9): `integrations/wordpress/theme/inc/headkit-checkout-signature.php`, the
 * Store API hook that records the verdict, and the gate in the gateway's
 * `process_payment` that acts on it.
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME GATE. The headkit-payments gateway
 * marks an order paid on the word of the finalize request, and
 * `POST /wp-json/wc/store/v1/checkout` is public — so an unsigned request with
 * `payment_status=paid` produces a Processing order with no money taken. The
 * `reproduction_unsigned_paid` shape is exactly that request. This release only
 * LOGS it (the order is still paid, as before, and now carries an ERROR line
 * and an order note); when enforcement becomes the default its expected outcome
 * flips from `paid_and_logged` to `downgraded`, which `enforced_unsigned`
 * already demonstrates.
 *
 * The harness runs the REAL hook closure and the REAL gateway class from an
 * unmodified `inc/headkit-payment.php` against recording shims
 * (`tests/support/payment-gateway-shims.php`).
 *
 * `php` is preinstalled on `ubuntu-latest`, so no toolchain setup is required.
 * macOS has not bundled `php` since Monterey, so this SKIPS on a developer
 * machine without it — and FAILS in CI, where a silent skip would drop the
 * only guard on a money path.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/checkout-signature-harness.php",
);

/** What one finalize did to the order, as the harness reports it. */
interface FinalizeResult {
  /** paid · paid_and_logged · downgraded · not_paid */
  outcome: string;
  result: string | null;
  orderStatus: string;
  paymentCompleteCalls: number;
  /** The verdict recorded with the status (`_headkit_payments_status_signature`). */
  signature: string;
  /** ERROR lines on the headkit-checkout-signature log source. */
  signatureErrors: string[];
  notes: string[];
}

interface HarnessOutput {
  scenarios: Record<string, FinalizeResult>;
  vectors: Record<string, string>;
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

const SUITE = "WordPress checkout signature gate";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

let output: HarnessOutput | undefined;

/** The harness runs once; its stderr is the gateway's own error_log noise. */
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

/**
 * One named scenario. A missing one is a harness change, not a soft assertion
 * — throwing keeps every call site a defined value under
 * `noUncheckedIndexedAccess`.
 */
function scenario(name: string): FinalizeResult {
  const got = run().scenarios[name];
  if (!got) {
    throw new Error(
      `the harness reported no scenario named ${name}; it was renamed or removed`,
    );
  }
  return got;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    // Only reachable in CI: a local run without `php` skipped above.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  it("still pays an unsigned paid finalize, and now logs and notes it (log-only release)", () => {
    // The reproduction. When enforcement becomes the default this flips to
    // "downgraded" — change it deliberately, together with the default.
    const got = scenario("reproduction_unsigned_paid");
    expect(got.outcome).toBe("paid_and_logged");
    expect(got.orderStatus).toBe("processing");
    expect(got.paymentCompleteCalls).toBe(1);
    expect(got.signature).toBe("missing_signature");
    expect(got.signatureErrors).toHaveLength(1);
    expect(got.signatureErrors[0]).toMatch(/order=\d+ /);
    expect(got.signatureErrors[0]).toContain("reason=missing_signature");
    expect(got.signatureErrors[0]).toContain("action=log_only");
    expect(got.notes.join("\n")).toContain(
      "without a valid HeadKit signature (reason: missing_signature)",
    );
  });

  it("pays a finalize commerce signed, silently", () => {
    const got = scenario("signed_valid");
    expect(got.outcome).toBe("paid");
    expect(got.signature).toBe("valid");
    expect(got.signatureErrors).toEqual([]);
    expect(got.notes.join("\n")).not.toContain("HeadKit signature");
  });

  it.each([
    ["signed_other_store_key", "bad_signature"],
    ["stale_timestamp", "stale_timestamp"],
    ["tampered_body", "bad_signature"],
    ["no_token_on_site", "no_secret"],
    ["unsigned_paypal_paid", "missing_signature"],
  ])("logs %s as %s and leaves today's behaviour unchanged", (name, reason) => {
    const got = scenario(name);
    expect(got.outcome).toBe("paid_and_logged");
    expect(got.signature).toBe(reason);
    expect(got.signatureErrors[0]).toContain(`reason=${reason}`);
  });

  it("treats a status from the $_POST fallback as unsigned", () => {
    const got = scenario("post_fallback_paid");
    expect(got.outcome).toBe("paid_and_logged");
    expect(got.signatureErrors[0]).toContain("reason=unsigned_post_fallback");
  });

  it("does not let a signed request launder a status an unsigned one set", () => {
    // The verdict is stored WITH the status: a signed POST that carries no
    // payment_status keeps the earlier unsigned PUT's verdict.
    const got = scenario("unsigned_put_then_signed_post");
    expect(got.outcome).toBe("paid_and_logged");
    expect(got.signature).toBe("missing_signature");
  });

  it.each(["unsigned_pending", "unsigned_failed"])(
    "only gates statuses that mark the order paid (%s)",
    (name) => {
      const got = scenario(name);
      expect(got.outcome).toBe("not_paid");
      expect(got.signatureErrors).toEqual([]);
    },
  );

  it.each(["enforced_unsigned", "enforced_by_filter"])(
    "downgrades an unsigned paid finalize to pending once enforcement is switched on (%s)",
    (name) => {
      const got = scenario(name);
      expect(got.outcome).toBe("downgraded");
      expect(got.paymentCompleteCalls).toBe(0);
      expect(got.orderStatus).toBe("pending");
      expect(got.signatureErrors[0]).toContain("action=downgraded_to_pending");
    },
  );

  it("still pays a signed finalize under enforcement", () => {
    expect(scenario("enforced_signed_valid").outcome).toBe("paid");
  });

  it("verifies commerce's pinned cross-language vector and the ±300 s window", () => {
    const v = run().vectors;
    // Same body, key, timestamp and expected HMAC as
    // services/commerce/internal/provider/woocommerce/checkout_signature_test.go.
    expect(v.commerce_vector).toBe("valid");
    expect(v.uppercase_hex).toBe("valid");
    expect(v.skew_plus_300).toBe("valid");
    expect(v.skew_minus_300).toBe("valid");
    expect(v.skew_plus_301).toBe("stale_timestamp");
    expect(v.skew_minus_301).toBe("stale_timestamp");
    expect(v.non_numeric_timestamp).toBe("bad_timestamp");
    expect(v.missing_signature).toBe("missing_signature");
    expect(v.no_secret).toBe("no_secret");
  });
});

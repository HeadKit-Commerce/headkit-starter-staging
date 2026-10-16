import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the theme route commerce consults before refunding a post-payment
 * refusal: `GET headkit/v2/checkout-session/{id}/order`
 * (`integrations/wordpress/theme/inc/rest-api/headkit-checkout-session.php`).
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME ROUTE. The theme ships no PHP test
 * runner, and this route is the only thing standing between a finalize race and
 * a refunded-but-shipped order. On the 2026-10-16 staging incident two
 * finalizes of one Stripe Checkout Session ran 45 ms apart; the webhook created
 * order 278942 with stock reduced 1→0 and the confirmation emails sent, and 70
 * ms later the success page's own finalize was refused by WooCommerce with
 * `woocommerce_rest_product_out_of_stock` — the cart's last unit having gone to
 * its own winner — and commerce refunded the payment. WooCommerce validates the
 * cart BEFORE the theme's `headkit_duplicate_session` guard can fire, so that
 * refusal is byte-identical to the one a shopper gets when somebody else bought
 * the item. This route is the record that separates them.
 *
 * Both directions move money, which is why both are asserted:
 *
 *   a false `exists: true`  strands a genuinely refused shopper's payment;
 *   a false `exists: false` refunds an order the merchant is about to ship.
 *
 * The harness shims the slice of WordPress/WooCommerce the endpoint touches
 * (including a `$wpdb` that answers the prepared SELECT against a seeded
 * options table — the endpoint reads the claim row directly, never through
 * `get_option()`), loads the REAL endpoint file unmodified, fires
 * `rest_api_init` so the route registration runs too, and reports what each
 * store shape returned.
 *
 * `php` is preinstalled on `ubuntu-latest`, so no toolchain setup is required.
 * macOS has not bundled `php` since Monterey, so this SKIPS on a developer
 * machine without it — and FAILS in CI, where a silent skip would drop the only
 * guard on a money path.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/checkout-session-order-harness.php",
);

/** One lookup response, as the endpoint shapes it. */
interface LookupResult {
  session_id: string;
  exists: boolean;
  order_id?: string;
  order_key?: string;
  status?: string;
  source: string;
}

interface HarnessOutput {
  /** Every route the endpoint file registered on `rest_api_init`. */
  routes: string[];
  results: Record<string, LookupResult>;
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

const SUITE = "WordPress checkout-session order lookup";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function lookup(): HarnessOutput {
  const stdout = execFileSync("php", [HARNESS], { encoding: "utf8" });
  return JSON.parse(stdout) as HarnessOutput;
}

/**
 * One named store shape from the harness. A missing shape is a harness change,
 * not a soft assertion — throwing here keeps every call site a defined value
 * under `noUncheckedIndexedAccess`.
 */
function shape(name: string): LookupResult {
  const got = lookup().results[name];
  if (!got) {
    throw new Error(
      `the harness reported no shape named ${name}; it was renamed or removed`,
    );
  }
  return got;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    // Only reachable in CI: a local run without `php` skipped above. A missing
    // runtime here means the runner image stopped shipping it, and skipping
    // would silently drop the guard.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  it("registers the route commerce reads", () => {
    // Commerce builds this exact path (session_order_provider.go). A renamed
    // segment or a regex that rejects a `cs_test_…` id would make every lookup
    // a 404, which commerce reads as "theme too old" and falls back from.
    expect(lookup().routes).toContain(
      "headkit/v2/checkout-session/(?P<session_id>[A-Za-z0-9_\\-]+)/order",
    );
  });

  it("reports the winner when the atomic claim row names a live order", () => {
    const got = shape("claim_processing");
    expect(got.exists).toBe(true);
    expect(got.order_id).toBe("278942");
    expect(got.order_key).toBe("wc_order_winner");
    expect(got.status).toBe("processing");
    // The claim row is the source that is committed BEFORE stock is reduced,
    // which is why it is the only one populated in time for a 70 ms race.
    expect(got.source).toBe("claim");
  });

  it("reports a checkout-draft claim holder as an existing order", () => {
    // A draft claim holder is a finalize IN FLIGHT. The duplicate-session guard
    // 409s against it, so a reader that called it absent would license the
    // refund the guard exists to prevent. Commerce does not adopt it as a
    // confirmation — it refuses to refund and logs for reconciliation.
    const got = shape("claim_draft");
    expect(got.exists).toBe(true);
    expect(got.status).toBe("checkout-draft");
  });

  it.each([
    ["claim_failed", "a failed order"],
    ["claim_cancelled", "a cancelled order"],
    ["claim_missing", "an order that no longer exists"],
  ])("reports no order when the claim row names %s", (name) => {
    // Mirrors the guard's compare-and-swap takeover: a dead winner must not
    // wedge the session, and a session whose only order is dead can be
    // refunded.
    const got = shape(name);
    expect(got.exists).toBe(false);
    expect(got.source).toBe("none");
  });

  it("falls back to the order meta for orders predating the claim row", () => {
    const got = shape("meta_only");
    expect(got.exists).toBe(true);
    expect(got.order_id).toBe("278946");
    expect(got.source).toBe("meta");
  });

  it("does not treat a checkout-draft carrying the meta as an order", () => {
    // The legacy belt mirrors the guard's status list, which excludes
    // checkout-draft: a draft with this meta never took a claim row and is not
    // evidence of a placed order.
    expect(shape("meta_draft_excluded").exists).toBe(false);
  });

  it("reports no order when neither record exists — the only answer that may license a refund", () => {
    expect(shape("nothing").exists).toBe(false);
  });

  it("never answers for a different session", () => {
    // The session id is the whole key. Leaking one session's winner to another
    // would refuse a refund that is owed.
    const got = shape("other_session");
    expect(got.exists).toBe(false);
    expect(got.session_id).toBe("cs_test_unrelated");
  });

  it("reports no order for an empty session id", () => {
    expect(shape("empty_session").exists).toBe(false);
  });
});

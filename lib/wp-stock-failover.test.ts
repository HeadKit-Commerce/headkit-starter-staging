import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the paid-finalize stock fail-over + claim-before-capture
 * (checkout plan v3 Part 2 §3, PR F): `integrations/wordpress/theme/inc/headkit-stock-failover.php`.
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME MONEY PATH. At finalize the theme
 * claims against admin `stock_quantity` (POS/feeds win over the web hold). On
 * a signed AUTHORIZED finalize (manual capture) it records
 * `_headkit_stock_claim_short_total` and leaves the order pending so commerce
 * can cancel the auth instead of capturing. On a signed PAID finalize when
 * part of the bag is gone, it creates the order anyway, parks On hold, and
 * refunds the short lines (safety net when money already stuck). Nothing in
 * the storefront can observe any of that, so this suite drives the theme
 * harness (`tests/support/stock-failover-shims.php`).
 *
 * The harness EXECUTES the claim statement by meaning, not as SQL; whether
 * MySQL/MariaDB accept it is a rehearsal-store check, named in the PR.
 *
 * `php` is preinstalled on `ubuntu-latest`. This SKIPS on a developer machine
 * without it and FAILS in CI, where a silent skip would drop the only guard.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/stock-failover-harness.php",
);

interface Refund {
  amount: string;
  lineItems: Record<
    string,
    { qty: number; refund_total: string; refund_tax: Record<string, string> }
  >;
  restock: boolean;
  refundedPayment: boolean;
}

interface ShortfallRecord {
  state: string;
  allShort: boolean;
  refundTotal: string;
  shippingRefund: string;
  cashAmount: string;
  giftCardAmount: string;
  attempts: number;
  lines: { itemId: number; quantity: number; refundAmount: string }[];
}

/** What one scenario left behind, as the harness reports it. */
interface Scenario {
  finalize: { stopped: string; status: number; code?: string };
  status: string;
  statusHistory: string[];
  record: ShortfallRecord | null;
  claimShortTotal: number | null;
  items: Record<
    string,
    { claimed: number | ""; short: number | ""; reduced: number | "" }
  >;
  stock: Record<string, number>;
  rowsLeft: number;
  gatewayCalls: { amount: string }[];
  refunds: Refund[];
  emails: Record<string, boolean>;
  mail: { to: string; subject: string }[];
  ran: { delay: number }[];
  notes: string[];
  claimSql: string[];
}

interface HarnessOutput {
  scenarios: Record<string, Scenario>;
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
const SUITE = "WordPress paid-finalize stock fail-over";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

let output: HarnessOutput | undefined;

/** The harness runs once and exits non-zero when its own assertions fail. */
function run(): HarnessOutput {
  if (!output) {
    const stdout = execFileSync("php", [HARNESS], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    output = JSON.parse(stdout) as HarnessOutput;
  }
  return output;
}

function scenario(name: string): Scenario {
  const got = run().scenarios[name];
  if (!got) {
    throw new Error(
      `the harness reported no scenario named ${name}; it was renamed or removed`,
    );
  }
  return got;
}

function record(s: Scenario): ShortfallRecord {
  if (!s.record) {
    throw new Error("expected a shortfall record on the order");
  }
  return s.record;
}

function firstRefund(s: Scenario): Refund {
  const refund = s.refunds[0];
  if (!refund) {
    throw new Error("expected a refund record");
  }
  return refund;
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

  it("leaves an in-stock order exactly as it was", () => {
    const s = scenario("signed_in_stock");
    expect(s.status).toBe("processing");
    expect(s.record).toBeNull();
    expect(s.gatewayCalls).toEqual([]);
    expect(s.rowsLeft).toBe(0);
  });

  it("creates the order when another shopper's live hold has the last unit, and leaves that unit alone", () => {
    const before = scenario("one_short_held_by_other_before_settle");
    expect(before.finalize.stopped).toBe("paid");
    expect(before.status).toBe("on-hold");
    // The held unit stays for its holder; the other line is reduced.
    expect(before.stock["101"]).toBe(1);
    expect(before.stock["102"]).toBe(3);
    expect(before.items["11"]).toMatchObject({
      claimed: 0,
      short: 1,
      reduced: 0,
    });
    expect(record(before).state).toBe("scheduled");
    expect(before.emails.customer_on_hold_order).toBe(false);
    expect(before.emails.new_order).toBe(true);
  });

  it("refunds the short line through the gateway first, records it unrestocked, keeps shipping, then releases the order", () => {
    const s = scenario("one_short_held_by_other");
    expect(s.gatewayCalls).toEqual([
      expect.objectContaining({ amount: "17.27" }),
    ]);
    const refund = firstRefund(s);
    expect(refund.amount).toBe("17.27");
    expect(refund.restock).toBe(false);
    expect(refund.refundedPayment).toBe(true);
    expect(Object.keys(refund.lineItems)).toEqual(["11"]);
    expect(s.statusHistory).toEqual(["on-hold", "processing"]);
    // One customer email: the confirmation, after the refund exists.
    expect(s.emails.customer_partially_refunded_order).toBe(false);
    expect(s.emails.customer_processing_order).toBe(true);
    expect(record(s)).toMatchObject({
      state: "refunded",
      refundTotal: "17.27",
      shippingRefund: "0.00",
    });
  });

  it("changes nothing on an unsigned finalize", () => {
    const s = scenario("unsigned_same_cart");
    expect(s.finalize).toMatchObject({
      stopped: "validate_cart",
      status: 409,
    });
    expect(s.claimSql).toEqual([]);
    expect(s.record).toBeNull();
  });

  it("claims against admin stock on authorized finalize without capturing or refunding", () => {
    const s = scenario("authorized_same_cart");
    expect(s.finalize.stopped).toBe("authorized");
    expect(s.status).toBe("pending");
    expect(s.claimShortTotal).toBe(1);
    expect(s.items["11"]).toMatchObject({ claimed: 0, short: 1 });
    expect(s.gatewayCalls).toEqual([]);
    expect(s.ran).toEqual([]);
    expect(record(s).state).toBe("detected");
  });

  it("records claim_short_total=0 when authorized and fully covered so commerce may capture", () => {
    const s = scenario("authorized_in_stock");
    expect(s.finalize.stopped).toBe("authorized");
    expect(s.claimShortTotal).toBe(0);
    expect(s.items["11"]?.claimed).toBe(1);
    expect(s.stock["101"]).toBe(5);
    expect(s.rowsLeft).toBeGreaterThanOrEqual(1);
  });

  it("does not let the order's own hold invent units when admin stock is already 0", () => {
    const auth = scenario("authorized_admin_zero_own_hold");
    expect(auth.claimShortTotal).toBe(1);
    expect(auth.items["11"]).toMatchObject({ claimed: 0, short: 1 });
    expect(auth.stock["101"]).toBe(0);

    const paid = scenario("paid_admin_zero_own_hold");
    expect(paid.items["11"]).toMatchObject({ claimed: 0, short: 1 });
    expect(paid.stock["101"]).toBe(0);
    expect(paid.gatewayCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not let the order's own hold invent units when admin stock is already 0", () => {
    const s = scenario("paid_admin_zero_own_hold");
    expect(s.finalize.stopped).toBe("paid");
    expect(s.items["11"]).toMatchObject({ claimed: 0, short: 1 });
    expect(s.stock["101"]).toBe(0);
    expect(s.status).toBe("refunded");
    expect(s.gatewayCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("refunds one unit's share of a line when only part of it is short", () => {
    const s = scenario("partial_quantity");
    expect(s.items["11"]).toMatchObject({ claimed: 2, short: 1 });
    expect(s.gatewayCalls[0]?.amount).toBe("5.75");
    expect(s.status).toBe("processing");
  });

  it("refunds shipping too and ends Refunded when every line is short, with the fully-refunded email the only one", () => {
    const s = scenario("only_line_short");
    expect(s.statusHistory).toEqual(["on-hold", "refunded"]);
    expect(s.gatewayCalls[0]?.amount).toBe("201.00");
    expect(firstRefund(s).lineItems["90"]?.refund_total).toBe("22.73");
    expect(s.emails).toEqual({
      new_order: true,
      customer_on_hold_order: false,
      customer_refunded_order: true,
    });
    expect(s.stock["101"]).toBe(0);
    expect(record(s)).toMatchObject({
      allShort: true,
      shippingRefund: "25.00",
    });
  });

  it("spreads a parent's stock over its variations in line order", () => {
    const s = scenario("variations_share_parent_stock");
    expect(s.items["11"]?.claimed).toBe(2);
    expect(s.items["12"]).toMatchObject({ claimed: 0, short: 1 });
    expect(s.stock["200"]).toBe(0);
    expect(s.claimSql).toHaveLength(1);
  });

  it("never shortens a backorders-allowed line, and counts an unmanaged out-of-stock line as short", () => {
    expect(scenario("backorders_allowed").record).toBeNull();
    const unmanaged = scenario("unmanaged_out_of_stock");
    expect(unmanaged.items["11"]?.short).toBe(1);
    expect(unmanaged.gatewayCalls[0]?.amount).toBe("33.00");
  });

  it("caps the cash part at what was captured and leaves the gift-card part as an admin step", () => {
    const s = scenario("gift_card_remainder");
    expect(s.gatewayCalls[0]?.amount).toBe("70.00");
    expect(firstRefund(s).amount).toBe("70.00");
    expect(record(s)).toMatchObject({
      cashAmount: "70.00",
      giftCardAmount: "10.00",
    });
    // The other line ships: a partial refund, not Refunded.
    expect(s.status).toBe("processing");
    expect(s.notes.join("\n")).toMatch(
      /ACTION NEEDED — AUD 10\.00 .*GC-HARNESS/,
    );
    expect(scenario("gift_card_credited_by_filter").notes.join("\n")).toContain(
      "credited back to gift card GC-HARNESS",
    );
  });

  it("never sends a gateway refund of 0", () => {
    const s = scenario("cash_zero");
    expect(s.gatewayCalls).toEqual([]);
    expect(s.refunds).toEqual([]);
    expect(record(s).giftCardAmount).toBe("50.00");
  });

  it("retries a failed gateway refund at +5 and +30 minutes, then emails the merchant once and stays On hold", () => {
    const s = scenario("gateway_fails_three_times");
    expect(s.gatewayCalls).toHaveLength(3);
    expect(s.ran.map((r) => r.delay)).toEqual([0, 300, 1800]);
    expect(s.refunds).toEqual([]);
    expect(s.status).toBe("on-hold");
    expect(record(s)).toMatchObject({ state: "failed", attempts: 3 });
    expect(s.mail).toHaveLength(1);
    expect(s.emails.customer_processing_order).toBeUndefined();

    const recovered = scenario("gateway_fails_then_succeeds");
    expect(recovered.mail).toEqual([]);
    expect(recovered.status).toBe("processing");
  });

  it("is idempotent per order: a re-run moves no money, a lost record is retried with the same gateway amount", () => {
    expect(scenario("settle_runs_twice").gatewayCalls).toHaveLength(1);
    const s = scenario("record_fails_after_gateway");
    expect(s.gatewayCalls).toHaveLength(2);
    expect(s.gatewayCalls[0]?.amount).toBe(s.gatewayCalls[1]?.amount);
    expect(s.refunds).toHaveLength(1);
  });

  it("does not pay a parked order twice", () => {
    const s = scenario("duplicate_finalize_of_parked_order");
    expect(s.finalize.stopped).toBe("payment_complete_refused");
    expect(s.status).toBe("on-hold");
    expect(record(s).state).toBe("scheduled");
  });

  it("guards the claim: same-second write read back, deadlock claims nothing, stale claim meta cleared", () => {
    expect(scenario("same_second_identical_claim").record).toBeNull();
    const deadlock = scenario("claim_deadlocks");
    expect(deadlock.items["11"]).toMatchObject({ claimed: 0, short: 1 });
    expect(deadlock.stock["101"]).toBe(4);
    const stale = scenario("stale_claim_from_failed_attempt");
    expect(stale.stock["101"]).toBe(3);
    expect(stale.record).toBeNull();
  });

  it("counts only other orders' unexpired checkout-draft / pending holds, on both finalize routes", () => {
    expect(scenario("expired_and_cancelled_holds_ignored").record).toBeNull();
    const route = scenario("order_route_claims_too");
    expect(route.statusHistory[0]).toBe("on-hold");
    expect(route.stock["101"]).toBe(1);
    const sql = scenario("one_short_held_by_other").claimSql[0] ?? "";
    expect(sql.match(/FOR UPDATE/g)).toHaveLength(2);
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toContain("`expires` > NOW()");
  });

  it("keeps PR C's /checkout/{id} safety from refusing a held draft the fail-over claimed", () => {
    // Out of stock outright: core's re-reserve throws before it reads a
    // quantity, so C would answer 409 to a paid order.
    const out = scenario("held_draft_out_of_stock_signed");
    expect(out.finalize.stopped).toBe("paid");
    expect(out.status).toBe("processing");
    expect(out.refunds).toHaveLength(1);
    const held = scenario("held_draft_order_route_signed");
    expect(held.statusHistory).toEqual(["pending", "on-hold", "processing"]);
    // Unsigned: C's safety is untouched and still refuses rather than oversell.
    expect(scenario("held_draft_order_route_unsigned").finalize).toMatchObject({
      stopped: "order_processed",
      status: 409,
    });
  });

  it("keeps an amount-mismatch order On hold after the refund", () => {
    const s = scenario("amount_mismatch_stays_on_hold");
    expect(s.status).toBe("on-hold");
    expect(s.refunds).toHaveLength(1);
  });
});

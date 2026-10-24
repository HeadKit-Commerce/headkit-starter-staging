import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the checkout stock hold (checkout plan v3, section 1 "Hold"):
 * `integrations/wordpress/theme/inc/headkit-stock-hold.php`.
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME FILE. The hold is the only thing that
 * stops two shoppers paying for the last unit: commerce calls it when the
 * shopper presses Pay, before Stripe or PayPal confirms. Every rule it applies
 * — only a signed call may place or release a hold, the minutes rule, the
 * per-line refusal, the release that keeps the draft, the draft pin at
 * finalize — decides whether a shopper is charged for something WooCommerce
 * then refuses. The theme has no test runner; this drives its executable
 * harness, which loads the REAL file against a reservation table that behaves
 * like WooCommerce 10.9.4's (`tests/support/stock-hold-shims.php`).
 *
 * `php` is preinstalled on `ubuntu-latest`, so this needs no toolchain setup.
 * It SKIPS on a developer machine without `php` and FAILS in CI, where a silent
 * skip would drop the only guard on this path.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/stock-hold-harness.php",
);

interface Issue {
  key: string;
  product_id: number;
  name: string;
  quantity: number;
  code: string;
  available: number;
}

interface HoldResult {
  status: string;
  order_id: number;
  order_key?: string;
  minutes?: number;
  expires_at?: string;
}

interface Scenario {
  status: number;
  code: string;
  result: HoldResult | null;
  issues: Issue[];
  /** Live reservation rows: {order_id: {product_id: qty}}. */
  rows: Record<string, Record<string, number>>;
  orders: number;
  sessionDraft: number;
  draftStatus: string | null;
  draftMeta: { session: string; hold: string } | null;
  notes: string[];
  calls: string[];
  actions: string[];
  expiresInSeconds?: number;
  otherRows?: number;
}

interface PinResult {
  sessionDraft: number;
  logs: string[];
}

interface SafetyResult {
  error: string;
  status: string;
  rows: Record<string, Record<string, number>>;
  calls: string[];
}

interface ReadLine {
  quantity: number;
  maximum: number;
  error: string;
}

interface ReadResult {
  /** The cart response's lines, keyed by cart item key. */
  lines: Record<string, ReadLine>;
  /** The quantities left in the cart session afterwards. */
  session: Record<string, number>;
}

interface HarnessOutput {
  minutes: Record<string, number>;
  scenarios: Record<string, Scenario>;
  pin: { heldOrderId: number; cases: Record<string, PinResult> };
  cancel: Record<string, boolean>;
  safety: Record<string, SafetyResult>;
  read: Record<string, ReadResult | number>;
  registration: {
    updateCallbackNamespace: string;
    endpointDataNamespace: string;
    endpointDataEndpoint: string;
    cartDataOutsideHold: unknown;
    schemaKeys: string[];
    hooks: Record<string, number>;
  };
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

const SUITE = "WordPress checkout stock hold";
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

function pick<T>(group: Record<string, T>, name: string): T {
  const got = group[name];
  if (got === undefined) {
    throw new Error(
      `the harness reported nothing named ${name}; it was renamed or removed`,
    );
  }
  return got;
}

const scenario = (name: string): Scenario => pick(run().scenarios, name);

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  describe("minutes: the store's setting when it is 1-10, otherwise 5", () => {
    it.each([
      ['""', 5],
      ['"0"', 5],
      ['"60"', 5],
      ['"11"', 5],
      ['"abc"', 5],
      ['"-3"', 5],
      ["false", 5],
      ['"1"', 1],
      ['"7"', 7],
      ['"10"', 10],
      ['" 4 "', 4],
      ["int 3", 3],
    ])("setting %s holds for %i minutes", (label, minutes) => {
      expect(pick(run().minutes, label)).toBe(minutes);
    });

    it("applies the rule to the reservation itself, not only the reply", () => {
      expect(scenario("hold_store_setting_3").expiresInSeconds).toBe(180);
      expect(scenario("hold_store_setting_blank").expiresInSeconds).toBe(300);
      expect(scenario("hold_creates_draft").notes).toEqual([
        "Stock hold of 5 minutes applied",
      ]);
    });
  });

  describe("only commerce may place or release a hold", () => {
    it.each([
      "unsigned_hold",
      "other_store_key_hold",
      "site_without_token_hold",
    ])("%s is refused 401 and writes nothing", (name) => {
      const got = scenario(name);
      expect(got.status).toBe(401);
      expect(got.code).toBe("headkit_stock_hold_unauthorized");
      expect(got.rows).toEqual({});
      expect(got.orders).toBe(0);
      expect(got.calls).toEqual([]);
    });

    it("refuses an unsigned release and leaves the hold in place", () => {
      const got = scenario("release_unsigned");
      expect(got.status).toBe(401);
      expect(got.rows).toEqual({ "300100": { "501": 1 } });
    });

    it("answers 400 to an unknown operation", () => {
      expect(scenario("unknown_op").status).toBe(400);
    });
  });

  describe("hold", () => {
    it("creates the session's draft at the Pay click and reserves on it", () => {
      const got = scenario("hold_creates_draft");
      expect(got.status).toBe(200);
      expect(got.result).toMatchObject({
        status: "held",
        order_id: 300100,
        order_key: "wc_order_key_300100",
        minutes: 5,
      });
      expect(got.rows).toEqual({ "300100": { "501": 1 } });
      expect(got.sessionDraft).toBe(300100);
      expect(got.draftStatus).toBe("checkout-draft");
      expect(got.draftMeta).toEqual({ session: "t_shopper_one", hold: "yes" });
      // The same first-touch hooks WooCommerce fires at Place Order.
      expect(got.actions).toEqual([
        "woocommerce_store_api_checkout_order_created",
        "woocommerce_store_api_checkout_update_order_meta",
      ]);
    });

    it("reuses the session's draft instead of creating a second order", () => {
      const got = scenario("hold_reuses_session_draft");
      expect(got.orders).toBe(1);
      expect(got.calls).toEqual([
        "update_order_from_cart:300100",
        "reserve:300100",
      ]);
      expect(got.result?.order_id).toBe(300100);
    });

    it("answers held to a second hold in the same second without letting core delete the rows", () => {
      // Control: core's own re-reserve in the same second throws and wipes the rows.
      const trap = scenario("core_same_second_trap");
      expect(trap.code).toBe("woocommerce_product_not_enough_stock");
      expect(trap.rows).toEqual({});

      const got = scenario("second_hold_same_second");
      expect(got.status).toBe(200);
      expect(got.result?.status).toBe("held");
      expect(got.rows).toEqual({ "300100": { "501": 1 } });
      expect(got.calls.filter((c) => c.startsWith("reserve:"))).toHaveLength(1);
    });

    it("refuses Pay when admin stock is 0 even though this session's hold still claims the unit", () => {
      const got = scenario("hold_admin_zero_while_own_hold");
      expect(got.status).toBe(409);
      expect(got.code).toBe("headkit_stock_hold_refused");
      expect(got.issues).toEqual([
        expect.objectContaining({
          product_id: 501,
          code: "out_of_stock",
          available: 0,
        }),
      ]);
      // Inventing hold rows are released — no payment, no Woo order.
      expect(got.rows).toEqual({});
      expect(got.draftStatus).toBe("checkout-draft");
    });

    it("refuses Pay when admin stock is short of the bag under an existing hold", () => {
      const got = scenario("hold_admin_short_while_own_hold");
      expect(got.status).toBe(409);
      expect(got.code).toBe("headkit_stock_hold_refused");
      expect(got.issues).toEqual([
        expect.objectContaining({
          product_id: 501,
          quantity: 2,
          code: "insufficient_stock",
          available: 1,
        }),
      ]);
      expect(got.rows).toEqual({});
    });

    it("refreshes the hold on a later Pay click", () => {
      const got = scenario("hold_again_a_minute_later");
      expect(got.result?.status).toBe("held");
      expect(got.expiresInSeconds).toBe(300);
      expect(got.calls.filter((c) => c.startsWith("reserve:"))).toHaveLength(2);
    });

    it("refuses a unit another shopper holds, naming the line, and leaves their hold alone", () => {
      const got = scenario("last_unit_held_by_another");
      expect(got.status).toBe(409);
      expect(got.code).toBe("headkit_stock_hold_refused");
      expect(got.issues).toEqual([
        {
          key: "item1",
          product_id: 501,
          name: "Base Layer - White, Small",
          quantity: 1,
          code: "out_of_stock",
          available: 0,
        },
      ]);
      expect(got.otherRows).toBe(1);
      // Our draft holds nothing, and is kept for the retry.
      expect(got.rows).toEqual({ "300100": { "501": 1 } });
      expect(got.draftStatus).toBe("checkout-draft");
    });

    it("does not count a lapsed hold of another shopper", () => {
      expect(scenario("other_hold_lapsed").result?.status).toBe("held");
    });

    it("reports what is left when a line is short", () => {
      expect(scenario("want_three_two_left").issues).toEqual([
        expect.objectContaining({
          code: "insufficient_stock",
          quantity: 3,
          available: 2,
        }),
      ]);
    });

    it("splits shared parent stock across variation lines in cart order", () => {
      expect(scenario("variations_share_parent_stock").issues).toEqual([
        expect.objectContaining({
          key: "item2",
          code: "insufficient_stock",
          available: 1,
        }),
      ]);
      expect(scenario("variations_share_parent_stock_enough").rows).toEqual({
        "300100": { "600": 4 },
      });
    });

    it("never holds or refuses a backorder-allowed line", () => {
      expect(scenario("backorder_line_with_held_line").rows).toEqual({
        "300100": { "701": 1 },
      });
      const only = scenario("only_backorder_line");
      expect(only.result).toMatchObject({ status: "not_required", minutes: 0 });
      expect(only.rows).toEqual({});
    });

    it("refuses a line the store will not sell at all before reserving anything", () => {
      const notPurchasable = scenario("not_purchasable_line");
      expect(notPurchasable.status).toBe(409);
      expect(notPurchasable.issues).toEqual([
        expect.objectContaining({
          product_id: 800,
          code: "not_purchasable",
          available: 0,
        }),
      ]);
      expect(notPurchasable.calls).not.toContain("reserve:300100");
      expect(scenario("out_of_stock_line").issues).toEqual([
        expect.objectContaining({ code: "out_of_stock", available: 0 }),
      ]);
    });

    it("answers not_required when the store does not manage stock", () => {
      expect(scenario("store_not_managing_stock").result?.status).toBe(
        "not_required",
      );
    });

    it("refuses an empty cart without creating a draft", () => {
      const got = scenario("empty_cart");
      expect(got.status).toBe(409);
      expect(got.code).toBe("woocommerce_rest_cart_empty");
      expect(got.orders).toBe(0);
    });
  });

  describe("release", () => {
    it.each(["release_held_draft", "release_session_draft_without_id"])(
      "%s deletes the rows and keeps the draft for the retry",
      (name) => {
        const got = scenario(name);
        expect(got.result).toEqual({ status: "released", order_id: 300100 });
        expect(got.rows).toEqual({});
        expect(got.draftStatus).toBe("checkout-draft");
      },
    );

    it("never releases a hold another cart session placed", () => {
      const got = scenario("release_other_sessions_hold");
      expect(got.result?.status).toBe("not_held");
      expect(got.otherRows).toBe(1);
    });
  });

  describe("draft pin at finalize", () => {
    it("points the cart session at the held draft named in a signed finalize", () => {
      const { heldOrderId, cases } = run().pin;
      expect(pick(cases, "signed_own_hold").sessionDraft).toBe(heldOrderId);
      expect(pick(cases, "pending_own_hold").sessionDraft).toBe(heldOrderId);
    });

    it.each([
      ["unsigned", "unsigned finalize"],
      ["wrong_key", "is not a hold of session"],
      ["other_session", "is not a hold of session=t_shopper_two"],
      ["already_processing", "is not a hold of session"],
    ])("refuses to pin on %s", (name, log) => {
      const got = pick(run().pin.cases, name);
      expect(got.sessionDraft).toBe(0);
      expect(got.logs.join("\n")).toContain(log);
    });

    it("does nothing for a finalize that names no hold", () => {
      const got = pick(run().pin.cases, "no_id");
      expect(got.sessionDraft).toBe(0);
      expect(got.logs).toEqual([]);
    });
  });

  it("exempts a pending headkit-payments order from WooCommerce's unpaid-order cancel, and only that", () => {
    expect(run().cancel).toEqual({
      headkit_payments_pending: false,
      cod_pending: true,
      cod_core_said_no: false,
    });
  });

  describe("safety on POST /checkout/{id} for a held draft", () => {
    it("moves a live held draft to pending (so emails fire) without re-reserving", () => {
      expect(pick(run().safety, "live_hold")).toMatchObject({
        error: "",
        status: "pending",
        calls: [],
      });
    });

    it("re-reserves a lapsed hold when the stock is still there", () => {
      const got = pick(run().safety, "lapsed_stock_still_there");
      expect(got.error).toBe("");
      expect(got.calls).toEqual(["reserve:300100"]);
      expect(got.rows).toEqual({ "300100": { "501": 1 } });
    });

    it("refuses with WooCommerce's own 409 when the lapsed hold's stock is gone, and leaves the order a DRAFT", () => {
      // A draft reads as "in flight" to commerce's existing-order lookup, which
      // never adopts or refunds on one (plan v3 PR B). A pending order would be
      // adopted as placed — unpaid, and exempt from the unpaid-order cancel.
      const got = pick(run().safety, "lapsed_stock_gone");
      expect(got.error).toBe("409 woocommerce_rest_product_out_of_stock");
      expect(got.status).toBe("checkout-draft");
    });

    it.each(["post_checkout_route", "order_without_hold"])(
      "leaves %s alone",
      (name) => {
        expect(pick(run().safety, name)).toMatchObject({
          error: "",
          status: "checkout-draft",
          calls: [],
        });
      },
    );
  });

  describe("a cart READ never silently clamps a line other shoppers' holds leave short (manual test B6)", () => {
    const read = (name: string): ReadResult =>
      pick(run().read, name) as ReadResult;
    const PARTIAL = "woocommerce_rest_product_partially_out_of_stock";

    // The line keeps its quantity, so the storefront sees it short: the
    // maximum (commerce's stockQuantity) is what the holds leave, and the
    // cart error is the one commerce maps to INSUFFICIENT_STOCK.
    it.each([
      ["get_partial_hold", 2, 1],
      ["get_partial_hold_again", 2, 1],
      ["get_items_route_partial_hold", 2, 1],
      ["get_three_one_held", 3, 2],
      ["get_over_raw_stock_and_held", 2, 1],
    ])(
      "%s: quantity %i kept, maximum %i, reported short",
      (name, quantity, maximum) => {
        const got = read(name);
        expect(got.lines.item1).toEqual({ quantity, maximum, error: PARTIAL });
        expect(got.session.item1).toBe(quantity);
      },
    );

    it.each([
      "post_update_item_partial_hold",
      "post_add_item_partial_hold",
      "post_extensions_partial_hold",
      "post_checkout_partial_hold",
      "get_checkout_route_partial_hold",
    ])("%s still clamps to what the holds leave, as before", (name) => {
      const got = read(name);
      expect(got.lines.item1).toEqual({ quantity: 1, maximum: 1, error: "" });
      expect(got.session.item1).toBe(1);
    });

    it.each([
      ["get_fully_held", { quantity: 1, maximum: 1, error: PARTIAL }],
      ["get_no_hold", { quantity: 2, maximum: 2, error: "" }],
      ["get_over_raw_stock", { quantity: 1, maximum: 1, error: "" }],
      ["get_own_draft_holds", { quantity: 2, maximum: 2, error: "" }],
      ["get_backorder", { quantity: 2, maximum: 9999, error: "" }],
    ])("%s is unchanged", (name, line) => {
      expect(read(name).lines.item1).toEqual(line);
    });

    it("never raises a product's add-to-cart limit, nor a limit read outside normalize_cart()", () => {
      expect(pick(run().read, "filter_without_cart_item")).toBe(1);
      expect(pick(run().read, "filter_outside_normalize")).toBe(1);
    });
  });

  it("registers the cart/extensions callback, the cart extension and its five hooks", () => {
    expect(run().registration).toEqual({
      updateCallbackNamespace: "headkit-stock-hold",
      endpointDataNamespace: "headkit-stock-hold",
      endpointDataEndpoint: "cart",
      cartDataOutsideHold: null,
      schemaKeys: ["status", "order_id", "order_key", "minutes", "expires_at"],
      hooks: {
        rest_request_before_callbacks: 1,
        woocommerce_store_api_checkout_update_customer_from_request: 1,
        woocommerce_cancel_unpaid_order: 1,
        woocommerce_store_api_checkout_order_processed: 1,
        woocommerce_store_api_product_quantity_limit: 1,
      },
    });
  });
});

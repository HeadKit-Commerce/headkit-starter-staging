import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  AU_ADDRESS,
  COMMERCE_URL,
  HOLD,
  STORE_API_URL,
  THEME_TOKEN,
  cartWith,
  confirmIntent,
  createPaymentIntent,
  deliverStripeEvent,
  errorCode,
  eventually,
  getIntent,
  holdCheckoutStock,
  intentId,
  lapseHolds,
  ordersForPaymentIntent,
  processExpressCheckout,
  releaseCheckoutStock,
  reservedRows,
  resetHoldProducts,
  runActionScheduler,
  setOption,
  setPrice,
  setStock,
  stockOf,
  stripeAccount,
  stripeApi,
  stripeRefunds,
  themeHoldCall,
  wooOrder,
  wpEval,
} from "./stock-hold-helpers";

/**
 * Checkout stock hold, server side (checkout plan v3) — every case the
 * browser adds nothing to. `stock-hold-ui.spec.ts` covers what the shopper
 * sees.
 *
 * LOCAL-ONLY (HARD RULE): the local stack only, Stripe TEST mode only.
 *
 * PRECONDITIONS, asserted in beforeAll rather than assumed:
 *   - the e2e store has `checkoutStockHoldEnabled: true` and WordPress holds
 *     for 1 minute (`scripts/e2e-ci-stack.sh up` sets both);
 *   - STRIPE_SECRET_KEY is the sk_test_ key commerce runs with
 *     (`scripts/e2e-ci-stack.sh ignore-list` skips this file without one).
 *
 * Money moves through REAL Stripe TEST PaymentIntents (the Express path:
 * createPaymentIntent places the hold itself), confirmed server-side with
 * Stripe's test payment methods — the same API call a wallet confirm makes.
 * Webhooks are delivered by the spec itself, signed with the local secret
 * (`deliverStripeEvent`), wrapped around the live PaymentIntent.
 *
 * A "lapse" is made by expiring the reservation rows (`lapseHolds`), which is
 * all the passage of the hold's minutes changes; nothing waits a minute out.
 */

// Each test resets the fixtures it touches, so the tests are independent and
// a failure does not skip the rest.

const ALL = Object.values(HOLD);

// Playwright's 30 s default is too tight for this file, and it is time, not a
// hang. Every case drives real Stripe TEST calls (~1-2 s each from a CI runner)
// and a `docker exec wp eval` per fixture reset, and the cases that finalize an
// order add a 5-6 s WooCommerce ProcessCheckout per order.
//
// Measured on 16 CI Playwright reports (2026-10-24..28, one worker): the plain
// cases pass in 5-28 s (p95 <= 24.5 s); the five SETTLE cases below were cut at
// 30 s in 52 of 109 attempts ("every line short": 24 of 28), always on a Stripe
// or gateway call that was merely in flight (`Request context disposed`), never
// on the settle poll's own 90 s deadline. Their passes ran 13-33 s at the
// median with the longest at 37.6 s, so their real duration is only known from
// below.
//
//   - CASE_TIMEOUT: ~3.5x the slowest plain pass, for every case in the file.
//   - SETTLE_CASE_TIMEOUT: the settle poll's own 90 s deadline plus ~90 s for
//     the steps ahead of it, so a refund that never comes still fails with the
//     poll's message ("the short order never reached Refunded") instead of a
//     bare timeout. It is a ceiling, not a wait: a healthy run does not use it.
const CASE_TIMEOUT = 90_000;
const SETTLE_CASE_TIMEOUT = 180_000;

/** Build a paid Express order for `lines`: hold, confirm with a good card, finalize. */
async function buyNow(
  api: APIRequestContext,
  lines: Record<string, number>,
): Promise<{ orderId: number; pi: string }> {
  const cart = await cartWith(api, lines);
  const intent = await createPaymentIntent(api, cart);
  expect(intent.errors, JSON.stringify(intent.errors)).toBeUndefined();
  const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
  const confirmed = await confirmIntent(api, pi, "pm_card_visa");
  expect(confirmed.status).toBe("succeeded");
  const done = await processExpressCheckout(api, cart, pi);
  expect(done.errors, JSON.stringify(done.errors)).toBeUndefined();
  return { orderId: Number(done.data!.commerce.processCheckout.orderId), pi };
}

test.describe("Stock hold — server side (plan v3)", () => {
  test.describe.configure({ timeout: CASE_TIMEOUT });

  test.beforeAll(async ({ request }) => {
    resetHoldProducts(ALL);
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const hold = await holdCheckoutStock(request, cart);
    expect(
      hold.data?.commerce.holdCheckoutStock.status,
      "the e2e store must have checkoutStockHoldEnabled on (scripts/e2e-ci-stack.sh up sets it) — a NOT_REQUIRED here means every case below would pass vacuously",
    ).toBe("HELD");
    expect(
      hold.data?.commerce.holdCheckoutStock.holdMinutes,
      "WordPress must hold for 1 minute (woocommerce_hold_stock_minutes=1)",
    ).toBe(1);
    resetHoldProducts(ALL);
  });

  test.beforeEach(() => {
    resetHoldProducts(ALL);
  });

  test("an UNSIGNED hold call is refused 401 and writes nothing (case 26)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const unsigned = await themeHoldCall(request, cart, { op: "hold" }, false);
    expect(unsigned.status()).toBe(401);
    expect((await unsigned.json()).code).toBe(
      "headkit_stock_hold_unauthorized",
    );
    expect(reservedRows(HOLD.lastUnit), "no row may be written").toEqual([]);

    // The same call signed with the store's token is the one that holds, so
    // the 401 above is the signature and nothing else.
    const signed = await themeHoldCall(request, cart, { op: "hold" }, true);
    expect(signed.status()).toBe(200);
    expect(reservedRows(HOLD.lastUnit)).toHaveLength(1);
  });

  test("an UNSIGNED paid finalize is downgraded to pending; no stock moves (case 25)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.three]: 1 });
    const res = await request.post(`${STORE_API_URL}/checkout`, {
      headers: { "Content-Type": "application/json", "Cart-Token": cart },
      data: {
        billing_address: {
          first_name: AU_ADDRESS.firstName,
          last_name: AU_ADDRESS.lastName,
          address_1: AU_ADDRESS.address1,
          city: AU_ADDRESS.city,
          state: AU_ADDRESS.state,
          postcode: AU_ADDRESS.postcode,
          country: AU_ADDRESS.country,
          email: "unsigned-probe@example.com",
        },
        shipping_address: {
          first_name: AU_ADDRESS.firstName,
          last_name: AU_ADDRESS.lastName,
          address_1: AU_ADDRESS.address1,
          city: AU_ADDRESS.city,
          state: AU_ADDRESS.state,
          postcode: AU_ADDRESS.postcode,
          country: AU_ADDRESS.country,
        },
        payment_method: "headkit-payments",
        payment_data: [{ key: "payment_status", value: "paid" }],
      },
    });
    expect(
      res.status(),
      "WooCommerce answers 202 Accepted for an order left pending",
    ).toBe(202);
    const orderId = Number((await res.json()).order_id);
    const order = wooOrder(orderId);
    expect(order.status, "never Processing on a visitor's word").toBe(
      "pending",
    );
    expect(order.signature).toBe("missing_signature");
    expect(stockOf(HOLD.three), "no stock reduced").toBe(3);
    wpEval(`wc_get_order(${orderId})->update_status('cancelled'); echo 'ok';`);
  });

  test("card on the PaymentIntent path: one order, signed finalize, hold note, rows gone (cases 1 and A)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const intent = await createPaymentIntent(request, cart);
    expect(intent.errors).toBeUndefined();
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    const held = await getIntent(request, pi);
    const draft = Number(held.metadata.headkit_hold_order_id);
    expect(draft, "the held draft rides on the PaymentIntent").toBeGreaterThan(
      0,
    );
    expect(reservedRows(HOLD.lastUnit)).toEqual([
      expect.objectContaining({ order_id: draft, stock_quantity: 1 }),
    ]);

    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const done = await processExpressCheckout(request, cart, pi);
    expect(done.errors, JSON.stringify(done.errors)).toBeUndefined();
    const orderId = Number(done.data!.commerce.processCheckout.orderId);

    expect(orderId, "the finalize completes THAT draft").toBe(draft);
    const order = wooOrder(orderId);
    expect(order.status).toBe("processing");
    expect(order.signature).toBe("valid");
    expect(
      order.notes.some((n) => /Stock hold of 1 minutes? applied/.test(n)),
    ).toBe(true);
    expect(reservedRows(HOLD.lastUnit), "rows gone after the finalize").toEqual(
      [],
    );
    expect(stockOf(HOLD.lastUnit), "stock reduced exactly once").toBe(0);
    expect(ordersForPaymentIntent(pi)).toEqual([orderId]);
  });

  test("decline releases the hold and keeps the draft; the retry completes the SAME draft (case 8)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const first = await createPaymentIntent(request, cart);
    const pi1 = intentId(first.data!.commerce.createPaymentIntent.clientSecret);
    const draft = Number(
      (await getIntent(request, pi1)).metadata.headkit_hold_order_id,
    );

    const declined = await confirmIntent(
      request,
      pi1,
      "pm_card_chargeDeclined",
    );
    expect(declined.error?.code ?? declined.status).toBe("card_declined");

    const release = await releaseCheckoutStock(request, cart, {
      paymentIntentId: pi1,
    });
    expect(release.data?.commerce.releaseCheckoutStock).toEqual({
      status: "RELEASED",
      paymentIntentStatus: "requires_payment_method",
    });
    expect(reservedRows(HOLD.lastUnit), "rows gone after the decline").toEqual(
      [],
    );
    expect(wooOrder(draft).status, "the draft is kept for the retry").toBe(
      "checkout-draft",
    );

    const second = await createPaymentIntent(request, cart);
    expect(second.errors).toBeUndefined();
    const pi2 = intentId(
      second.data!.commerce.createPaymentIntent.clientSecret,
    );
    expect(
      Number((await getIntent(request, pi2)).metadata.headkit_hold_order_id),
      "the retry holds the same draft",
    ).toBe(draft);
    expect((await confirmIntent(request, pi2, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const done = await processExpressCheckout(request, cart, pi2);
    expect(Number(done.data!.commerce.processCheckout.orderId)).toBe(draft);
    const order = wooOrder(draft);
    expect(order.status).toBe("processing");
    expect(
      order.notes.filter((n) => /Stock hold of/.test(n)),
      "both holds are on the one order",
    ).toHaveLength(2);
  });

  test("3D Secure in progress KEEPS the hold; once cancelled it is released (case 8b)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);

    const challenged = await confirmIntent(
      request,
      pi,
      "pm_card_authenticationRequired",
    );
    expect(challenged.status).toBe("requires_action");
    const kept = await releaseCheckoutStock(request, cart, {
      paymentIntentId: pi,
    });
    expect(kept.data?.commerce.releaseCheckoutStock).toEqual({
      status: "KEPT",
      paymentIntentStatus: "requires_action",
    });
    expect(
      reservedRows(HOLD.lastUnit),
      "a challenge in progress is not a failed payment",
    ).toHaveLength(1);

    await stripeApi(
      request,
      "POST",
      `payment_intents/${pi}/cancel`,
      {},
      await stripeAccount(request),
    );
    const released = await releaseCheckoutStock(request, cart, {
      paymentIntentId: pi,
    });
    expect(released.data?.commerce.releaseCheckoutStock).toEqual({
      status: "RELEASED",
      paymentIntentStatus: "canceled",
    });
    expect(reservedRows(HOLD.lastUnit)).toEqual([]);
  });

  test("two buyers, last unit, Pay at the same moment: exactly one hold, the other refused with available 0 (case 10)", async ({
    request,
  }) => {
    // Both carts exist before either pays; once one holds, WooCommerce would
    // refuse the other's add-to-cart outright.
    const a = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const b = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const [ra, rb] = await Promise.all([
      createPaymentIntent(request, a),
      createPaymentIntent(request, b),
    ]);
    const outcomes = [ra, rb].map((r) => (r.errors ? errorCode(r) : "HELD"));
    expect(outcomes.sort()).toEqual(["CART_ITEM_UNAVAILABLE", "HELD"]);
    const loser = [ra, rb].find((r) => r.errors)!;
    expect(
      JSON.stringify(loser.errors![0]!.extensions),
      "the loser's issue carries available 0",
    ).toMatch(/"available":0/);
    expect(reservedRows(HOLD.lastUnit), "exactly one hold").toHaveLength(1);
  });

  test("a backorder line is never held; a stock line beside it is (case 16)", async ({
    request,
  }) => {
    const only = await cartWith(request, { [HOLD.backorder]: 1 });
    const none = await holdCheckoutStock(request, only);
    expect(none.data?.commerce.holdCheckoutStock.status).toBe("NOT_REQUIRED");
    expect(reservedRows(HOLD.backorder)).toEqual([]);

    const mixed = await cartWith(request, {
      [HOLD.backorder]: 1,
      [HOLD.plenty]: 1,
    });
    const held = await holdCheckoutStock(request, mixed);
    expect(held.data?.commerce.holdCheckoutStock.status).toBe("HELD");
    expect(reservedRows(HOLD.plenty)).toHaveLength(1);
    expect(
      reservedRows(HOLD.backorder),
      "the backorder line is not held",
    ).toEqual([]);
  });

  test("a slow WordPress: refused inside the 6 s deadline with the retry message, and no orphan row is left (hold timeout, F4)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    setOption("hk_e2e_slow_hold_seconds", "8");
    try {
      const started = Date.now();
      const hold = await holdCheckoutStock(request, cart);
      const took = Date.now() - started;
      expect(errorCode(hold)).toBe("CHECKOUT_STOCK_HOLD_UNAVAILABLE");
      expect(hold.errors![0]!.message).toBe(
        "We couldn't reserve your items just now. Please try again — you have not been charged.",
      );
      expect(
        took,
        "commerce gives up at its deadline, not WordPress's",
      ).toBeLessThan(8_000);

      const intent = await createPaymentIntent(request, cart);
      expect(errorCode(intent), "no PaymentIntent is created either").toBe(
        "CHECKOUT_STOCK_HOLD_UNAVAILABLE",
      );
    } finally {
      setOption("hk_e2e_slow_hold_seconds", null);
    }
    // WordPress finishes the slow holds after commerce gave up; commerce's
    // best-effort release must clean them up rather than leave the unit held
    // for the store's minutes.
    await eventually(
      () => reservedRows(HOLD.lastUnit).length === 0,
      30_000,
      "a hold that landed after commerce's deadline was not released",
    );
  });

  test("a lapsed hold frees the unit for the next buyer (case 9)", async ({
    request,
  }) => {
    const a = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const b = await cartWith(request, { [HOLD.lastUnit]: 1 });
    expect(
      (await holdCheckoutStock(request, a)).data?.commerce.holdCheckoutStock
        .status,
    ).toBe("HELD");
    expect(errorCode(await holdCheckoutStock(request, b))).toBe(
      "CART_ITEM_UNAVAILABLE",
    );
    lapseHolds(HOLD.lastUnit);
    expect(
      (await holdCheckoutStock(request, b)).data?.commerce.holdCheckoutStock
        .status,
      "after the lapse the other buyer holds it",
    ).toBe("HELD");
  });

  test("a theme from before the hold: the hold fails CLOSED and nothing is charged (case 24)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    setOption("hk_e2e_old_theme", "yes");
    try {
      expect(errorCode(await holdCheckoutStock(request, cart))).toBe(
        "CHECKOUT_STOCK_HOLD_UNAVAILABLE",
      );
      expect(errorCode(await createPaymentIntent(request, cart))).toBe(
        "CHECKOUT_STOCK_HOLD_UNAVAILABLE",
      );
      expect(reservedRows(HOLD.lastUnit)).toEqual([]);
    } finally {
      setOption("hk_e2e_old_theme", null);
    }
  });

  test("hold lapsed and the only unit sold elsewhere: the paid order is placed, then fully refunded incl. shipping (cases 7/12)", async ({
    request,
  }) => {
    test.setTimeout(SETTLE_CASE_TIMEOUT);
    const cart = await cartWith(request, { [HOLD.lastUnit]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    lapseHolds(HOLD.lastUnit);
    await buyNow(request, { [HOLD.lastUnit]: 1 });
    expect(stockOf(HOLD.lastUnit)).toBe(0);

    const paid = await confirmIntent(request, pi, "pm_card_visa");
    expect(paid.status).toBe("succeeded");
    const done = await processExpressCheckout(request, cart, pi);
    expect(
      done.errors,
      "a captured payment always becomes an order",
    ).toBeUndefined();
    const orderId = Number(done.data!.commerce.processCheckout.orderId);
    expect(
      wooOrder(orderId).status,
      "parked On hold until the refund exists",
    ).toBe("on-hold");

    runActionScheduler();
    const order = await eventually(
      () => {
        runActionScheduler();
        const o = wooOrder(orderId);
        return o.status === "refunded" ? o : null;
      },
      90_000,
      "the short order never reached Refunded",
      3_000,
    );
    expect(
      await stripeRefunds(request, pi),
      "card refunded the whole capture, shipping included",
    ).toEqual([paid.amount]);
    expect(stockOf(HOLD.lastUnit), "never negative, never restocked").toBe(0);
    expect(
      order.notes.some((n) => /payment amount mismatch/.test(n)),
      "the totals agree, so the amount guard stays out of it (case 33)",
    ).toBe(false);
    expect(
      order.notes.some((n) => /Processing order/.test(n)),
      "no Processing confirmation for an order that ends Refunded",
    ).toBe(false);
  });

  test("one line short of two: only that line refunded, to the cent; shipping kept; Processing (cases 11, 14 shape, 34)", async ({
    request,
  }) => {
    test.setTimeout(SETTLE_CASE_TIMEOUT);
    resetHoldProducts([HOLD.plenty], { [HOLD.plenty]: 1 });
    const cart = await cartWith(request, { [HOLD.plenty]: 1, [HOLD.three]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    lapseHolds(HOLD.plenty);
    await buyNow(request, { [HOLD.plenty]: 1 });

    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const done = await processExpressCheckout(request, cart, pi);
    expect(done.errors).toBeUndefined();
    const orderId = Number(done.data!.commerce.processCheckout.orderId);

    const order = await eventually(
      () => {
        runActionScheduler();
        const o = wooOrder(orderId);
        return o.status === "processing" && o.refunds.length > 0 ? o : null;
      },
      90_000,
      "the partly short order never reached Processing with its refund",
      3_000,
    );
    expect(
      order.refunds.map((r) => r.amount),
      "the short line's total, 19.99",
    ).toEqual(["19.99"]);
    expect(
      await stripeRefunds(request, pi),
      "Stripe refunds exactly 1999 cents",
    ).toEqual([1999]);
    expect(stockOf(HOLD.three), "the line that was there was sold").toBe(2);
    expect(stockOf(HOLD.plenty)).toBe(0);

    // Case 35: Stripe then reports the refund WooCommerce initiated
    // (charge.refunded). It must not be synced back as a second WooCommerce
    // refund.
    const live = await getIntent(request, pi);
    const charge = await stripeApi<Record<string, unknown>>(
      request,
      "GET",
      `charges/${live.latest_charge}`,
      {},
      await stripeAccount(request),
    );
    const synced = await deliverStripeEvent(
      request,
      "charge.refunded",
      charge,
      await stripeAccount(request),
    );
    expect(synced.status, synced.body).toBe(200);
    expect(
      wooOrder(orderId).refunds.map((r) => r.amount),
      "still exactly one refund row (case 35)",
    ).toEqual(["19.99"]);
  });

  test("every line short: the whole capture refunded incl. shipping, Refunded (case 13)", async ({
    request,
  }) => {
    test.setTimeout(SETTLE_CASE_TIMEOUT);
    resetHoldProducts([HOLD.plenty], { [HOLD.plenty]: 1 });
    const cart = await cartWith(request, {
      [HOLD.lastUnit]: 1,
      [HOLD.plenty]: 1,
    });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    lapseHolds(HOLD.lastUnit);
    lapseHolds(HOLD.plenty);
    await buyNow(request, { [HOLD.lastUnit]: 1, [HOLD.plenty]: 1 });

    const paid = await confirmIntent(request, pi, "pm_card_visa");
    expect(paid.status).toBe("succeeded");
    const done = await processExpressCheckout(request, cart, pi);
    expect(done.errors).toBeUndefined();
    const orderId = Number(done.data!.commerce.processCheckout.orderId);
    await eventually(
      () => {
        runActionScheduler();
        return wooOrder(orderId).status === "refunded";
      },
      90_000,
      "an all-short order never reached Refunded",
      3_000,
    );
    expect(await stripeRefunds(request, pi)).toEqual([paid.amount]);
  });

  test("3 ordered, a stock sync leaves 2: one unit's share refunded, stock to 0, Processing (cases 14 and 20)", async ({
    request,
  }) => {
    test.setTimeout(SETTLE_CASE_TIMEOUT);
    const cart = await cartWith(request, { [HOLD.three]: 3 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    // A POS or middleware sync zeroes one unit while the hold has lapsed.
    lapseHolds(HOLD.three);
    setStock(HOLD.three, 2);

    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const done = await processExpressCheckout(request, cart, pi);
    expect(done.errors).toBeUndefined();
    const orderId = Number(done.data!.commerce.processCheckout.orderId);
    const order = await eventually(
      () => {
        runActionScheduler();
        const o = wooOrder(orderId);
        return o.status === "processing" && o.refunds.length > 0 ? o : null;
      },
      90_000,
      "the short unit was never refunded",
      3_000,
    );
    expect(
      order.refunds.map((r) => r.amount),
      "one unit, 12.00",
    ).toEqual(["12.00"]);
    expect(await stripeRefunds(request, pi)).toEqual([1200]);
    expect(
      stockOf(HOLD.three),
      "claimed 2, never negative, not restocked",
    ).toBe(0);
  });

  test("a refund of 0 is refused by WooCommerce and by commerce (0-refund)", async ({
    request,
  }) => {
    const { orderId, pi } = await buyNow(request, { [HOLD.three]: 1 });
    const wc = wpEval(
      `$r = wc_create_refund(['order_id' => ${orderId}, 'amount' => 0, 'refund_payment' => true]); echo is_wp_error($r) ? 'ERR:' . $r->get_error_message() : 'REFUND:' . $r->get_id();`,
    );
    // A GATEWAY refund of 0 (a manual 0.00 refund moves no money and stays
    // allowed): WooCommerce deletes the refund it saved when the gateway
    // refuses, so no row is left either.
    expect(wc).toMatch(/^ERR:Refund amount must be greater than zero/);
    expect(wooOrder(orderId).refunds).toEqual([]);

    const res = await request.post(`${COMMERCE_URL}/woocommerce/refund`, {
      headers: {
        Authorization: `Bearer ${THEME_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { charge: pi, amount: 0, order_id: orderId },
    });
    expect(res.status(), "never read as 'refund everything'").toBe(400);
    expect(await stripeRefunds(request, pi)).toEqual([]);
  });

  test("same-draft race after a failed attempt: two finalizes and the webhook at once give ONE paid order, no 403 (case 22)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.three]: 1 });
    const first = await createPaymentIntent(request, cart);
    const pi1 = intentId(first.data!.commerce.createPaymentIntent.clientSecret);
    await confirmIntent(request, pi1, "pm_card_chargeDeclined");
    await releaseCheckoutStock(request, cart, { paymentIntentId: pi1 });

    const second = await createPaymentIntent(request, cart);
    const pi = intentId(second.data!.commerce.createPaymentIntent.clientSecret);
    const draft = Number(
      (await getIntent(request, pi)).metadata.headkit_hold_order_id,
    );
    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const live = await getIntent(request, pi);
    const account = await stripeAccount(request);

    const results = await Promise.all([
      processExpressCheckout(request, cart, pi),
      processExpressCheckout(request, cart, pi),
      deliverStripeEvent(
        request,
        "payment_intent.succeeded",
        live as unknown as Record<string, unknown>,
        account,
      ),
    ]);
    for (const r of results.slice(0, 2)) {
      const res = r as Awaited<ReturnType<typeof processExpressCheckout>>;
      expect(
        JSON.stringify(res.errors ?? []),
        "no reservation refusal from the paid finalize",
      ).not.toMatch(/403|not_enough_stock|out_of_stock/);
    }
    expect(
      ordersForPaymentIntent(pi),
      "one order for the PaymentIntent",
    ).toEqual([draft]);
    expect(wooOrder(draft).status).toBe("processing");
    expect(stockOf(HOLD.three), "stock reduced once").toBe(2);
  });

  test("Express, tab closed after paying: the webhook creates the order at once (F3)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.three]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    const draft = Number(
      (await getIntent(request, pi)).metadata.headkit_hold_order_id,
    );
    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    // No processCheckout: the browser is gone.
    const delivered = await deliverStripeEvent(
      request,
      "payment_intent.succeeded",
      (await getIntent(request, pi)) as unknown as Record<string, unknown>,
      await stripeAccount(request),
    );
    expect(delivered.status, delivered.body).toBe(200);
    expect(
      ordersForPaymentIntent(pi),
      "the order exists after the FIRST delivery",
    ).toEqual([draft]);
    expect(wooOrder(draft).status).toBe("processing");
    expect(stockOf(HOLD.three)).toBe(2);
  });

  test("Express, browser finalize and webhook race: one order (F3)", async ({
    request,
  }) => {
    const cart = await cartWith(request, { [HOLD.three]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
      "succeeded",
    );
    const live = await getIntent(request, pi);
    const account = await stripeAccount(request);
    const [browser, hook] = await Promise.all([
      processExpressCheckout(request, cart, pi),
      deliverStripeEvent(
        request,
        "payment_intent.succeeded",
        live as unknown as Record<string, unknown>,
        account,
      ),
    ]);
    expect(hook.status, hook.body).toBe(200);
    const orders = ordersForPaymentIntent(pi);
    expect(orders, "exactly one order").toHaveLength(1);
    if (!browser.errors) {
      expect(Number(browser.data!.commerce.processCheckout.orderId)).toBe(
        orders[0],
      );
    }
    expect(stockOf(HOLD.three), "stock reduced once").toBe(2);
  });

  test("amount guard plus shortfall: a flagged order stays On hold after the settle step refunds its short line (case 33)", async ({
    request,
  }) => {
    test.setTimeout(SETTLE_CASE_TIMEOUT);
    resetHoldProducts([HOLD.plenty], { [HOLD.plenty]: 1 });
    const cart = await cartWith(request, { [HOLD.three]: 1, [HOLD.plenty]: 1 });
    const intent = await createPaymentIntent(request, cart);
    const pi = intentId(intent.data!.commerce.createPaymentIntent.clientSecret);
    // Two things go wrong after the PaymentIntent is priced: the price of one
    // line moves (so WooCommerce totals the order above what Stripe captured —
    // the ENG-784 guard's case), and the other line's hold lapses and its last
    // unit sells elsewhere (the fail-over's case).
    setPrice(HOLD.three, "14.00");
    try {
      lapseHolds(HOLD.plenty);
      await buyNow(request, { [HOLD.plenty]: 1 });
      expect((await confirmIntent(request, pi, "pm_card_visa")).status).toBe(
        "succeeded",
      );
      // The browser is gone; the webhook places the order.
      const delivered = await deliverStripeEvent(
        request,
        "payment_intent.succeeded",
        (await getIntent(request, pi)) as unknown as Record<string, unknown>,
        await stripeAccount(request),
      );
      expect(delivered.status, delivered.body).toBe(200);
      const [orderId] = ordersForPaymentIntent(pi);
      expect(orderId, "the webhook placed the order").toBeGreaterThan(0);
      const flagged = wooOrder(orderId!);
      expect(flagged.status).toBe("on-hold");
      expect(
        flagged.notes.some((n) => /payment amount mismatch/.test(n)),
        "the amount guard flagged it",
      ).toBe(true);

      const settled = await eventually(
        () => {
          runActionScheduler();
          const o = wooOrder(orderId!);
          return o.refunds.length > 0 ? o : null;
        },
        90_000,
        "the short line was never refunded",
        3_000,
      );
      expect(
        settled.refunds.map((r) => r.amount),
        "only the short line",
      ).toEqual(["19.99"]);
      expect(
        settled.status,
        "the settle step must not move an order the amount guard flagged",
      ).toBe("on-hold");
    } finally {
      setPrice(HOLD.three, "12.00");
    }
  });
});

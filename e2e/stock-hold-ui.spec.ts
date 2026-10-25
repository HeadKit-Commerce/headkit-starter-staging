import { test, expect, request } from "@playwright/test";
import type { APIRequestContext, Frame, Page } from "@playwright/test";
import {
  BASE_URL,
  CARD_DECLINED,
  CARD_OK,
  awaitOrderConfirmation,
  fillCard,
  fillContactStep,
  fillShipToHomeStep,
  fillShippingOptionsStep,
  installCartCookie,
  payAndAwaitSuccess,
  payButton,
  stripeSessionAnyKey,
} from "./helpers";
import {
  HOLD,
  STORE_API_URL,
  cartWith,
  eventually,
  holdCheckoutStock,
  reservedRows,
  resetHoldProducts,
  setOption,
  setStock,
  stockOf,
  stripeAccount,
  stripeApi,
  wooOrder,
} from "./stock-hold-helpers";

/**
 * Checkout stock hold, as the shopper sees it (checkout plan v3) — the
 * starter's Payment Element on a Checkout Session, with the store flag on and
 * a 1-minute hold. `stock-hold-api.spec.ts` covers the server-only cases.
 *
 * LOCAL-ONLY (HARD RULE): the local stack only, Stripe TEST cards only.
 *
 * Every test builds its carts from the stock-hold fixtures, resets their stock
 * and drops their holds first. "Another shopper" is a second Store API cart
 * whose hold is placed through commerce exactly as a Pay click places it.
 */

// Each test resets the fixtures it touches, so the tests are independent and
// a failure does not skip the rest. One retry, as the paid-checkout specs
// have: a browser confirm can be held up on Stripe's side (see
// checkout-purchase.spec.ts).
test.describe.configure({ retries: 1 });

const ALL = Object.values(HOLD);
const CARD_3DS = "4000002760003184";
const UNAVAILABLE = (name: string) =>
  `Unfortunately ${name} is now unavailable and has been removed from your cart. You have not been charged.`;
const HOLD_FAILED =
  "We couldn't reserve your items just now. Please try again — you have not been charged.";

/** Contact → Delivery → Shipping options, as every checkout spec walks them. */
async function walkToPayment(page: Page, email: string): Promise<void> {
  await fillContactStep(page, email);
  await fillShipToHomeStep(page);
  await fillShippingOptionsStep(page);
}

/** The error screen the plan forbids on any stock outcome. */
async function expectNoErrorScreen(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
}

/**
 * Stripe's TEST 3D Secure challenge, wherever it mounts: the modal nests the
 * issuer page several frames deep, so find the frame that carries its buttons.
 */
async function challengeFrame(page: Page, timeoutMs = 60_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const n = await frame
        .locator("#test-source-authorize-3ds, #test-source-fail-3ds")
        .count()
        .catch(() => 0);
      if (n > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Stripe's 3D Secure test challenge never appeared");
}

/**
 * Press one of the challenge's buttons and wait until the challenge has gone.
 * The issuer page answers a click only once its own script has loaded, which
 * is after the button is already in the DOM, so an early click can be
 * swallowed; it is retried until the challenge actually closes.
 */
async function clickChallenge(
  page: Page,
  button: "#test-source-authorize-3ds" | "#test-source-fail-3ds",
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const frame = await challengeFrame(page);
    const target = frame.locator(button);
    await target.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await target.click().catch(() => {});
    const closed = await eventually(
      async () => {
        for (const f of page.frames()) {
          const n = await f
            .locator(button)
            .count()
            .catch(() => 0);
          if (n > 0) return false;
        }
        return true;
      },
      8_000,
      "challenge still open",
      500,
    ).catch(() => false);
    if (closed) return;
  }
  throw new Error(`Stripe's 3D Secure challenge did not close after ${button}`);
}

async function openCheckout(page: Page, cart: string): Promise<void> {
  await installCartCookie(page.context(), cart);
  await page.goto(`${BASE_URL}/checkout`);
}

let api: APIRequestContext;

test.describe("Stock hold — the shopper's checkout (plan v3)", () => {
  test.beforeAll(async () => {
    api = await request.newContext();
  });
  test.afterAll(async () => {
    await api.dispose();
  });
  test.beforeEach(() => {
    test.setTimeout(240_000);
    resetHoldProducts(ALL);
  });

  test("card: Pay holds, one order completes the held draft, rows gone (case 1)", async ({
    page,
  }) => {
    const cart = await cartWith(api, { [HOLD.plenty]: 1 }, { address: false });
    await openCheckout(page, cart);
    await walkToPayment(page, "hold-card@example.com");
    await fillCard(page, CARD_OK);
    const sessionId = await payAndAwaitSuccess(page);
    const { orderId } = await awaitOrderConfirmation(page);

    const order = wooOrder(orderId);
    expect(order.status).toBe("processing");
    expect(order.signature).toBe("valid");
    expect(order.notes.filter((n) => /Stock hold of/.test(n))).toHaveLength(1);
    expect(reservedRows(HOLD.plenty)).toEqual([]);
    expect(stockOf(HOLD.plenty)).toBe(49);
    const session = await stripeSessionAnyKey(api, sessionId);
    expect(
      session.metadata.headkit_hold_order_id,
      "the session names the held draft",
    ).toBe(String(orderId));

    // The e2e store is hold-first (scripts/e2e-ci-stack.sh): the card was only
    // AUTHORIZED at confirm and commerce's webhook captured it after the stock
    // re-check — the paid path this spec now exercises.
    const account = await stripeAccount(api);
    const read = await stripeApi<{ payment_intent: string | null }>(
      api,
      "GET",
      `checkout/sessions/${sessionId}`,
      {},
      account,
    );
    const intent = await stripeApi<{
      status: string;
      amount_received: number;
      payment_method_options?: { card?: { capture_method?: string } };
    }>(api, "GET", `payment_intents/${read.payment_intent}`, {}, account);
    expect(
      intent.payment_method_options?.card?.capture_method,
      "hold-first: the card was held, not captured at confirm",
    ).toBe("manual");
    expect(intent.status, "captured after the stock re-check").toBe(
      "succeeded",
    );
  });

  test("decline: the hold is released, the shopper stays on Payment, the retry completes the same draft (case 8)", async ({
    page,
  }) => {
    const cart = await cartWith(api, { [HOLD.plenty]: 1 }, { address: false });
    await openCheckout(page, cart);
    await walkToPayment(page, "hold-retry@example.com");
    await fillCard(page, CARD_DECLINED);
    await payButton(page).click();
    await expect(
      page.getByText(/your card (was|has been) declined/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expectNoErrorScreen(page);
    await eventually(
      () => reservedRows(HOLD.plenty).length === 0,
      20_000,
      "the declined attempt's hold was not released",
    );

    await expect(payButton(page)).toBeEnabled({ timeout: 30_000 });
    await fillCard(page, CARD_OK);
    await page.waitForTimeout(2_000);
    await payAndAwaitSuccess(page);
    const { orderId } = await awaitOrderConfirmation(page);
    const order = wooOrder(orderId);
    expect(order.status).toBe("processing");
    expect(
      order.notes.filter((n) => /Stock hold of/.test(n)),
      "both attempts held the one draft that became the order",
    ).toHaveLength(2);
  });

  test("3D Secure in progress keeps the hold; failing it releases and stays on Payment (case 8b)", async ({
    page,
  }) => {
    const cart = await cartWith(api, { [HOLD.plenty]: 1 }, { address: false });
    await openCheckout(page, cart);
    await walkToPayment(page, "hold-3ds-fail@example.com");
    await fillCard(page, CARD_3DS);
    await payButton(page).click();
    await challengeFrame(page);

    expect(
      reservedRows(HOLD.plenty),
      "the row stays while the challenge is open",
    ).toHaveLength(1);

    // Look the frame up again: the issuer page re-renders while it loads, and
    // a handle taken before the row check above can point at a frame that is
    // gone, so the click lands nowhere.
    await clickChallenge(page, "#test-source-fail-3ds");
    await expect(page.getByText(/unable to authenticate/i).first()).toBeVisible(
      { timeout: 60_000 },
    );
    await expectNoErrorScreen(page);
    await eventually(
      () => reservedRows(HOLD.plenty).length === 0,
      20_000,
      "a failed challenge did not release the hold",
    );
  });

  test("3D Secure completed: one order (case 8b)", async ({ page }) => {
    const cart = await cartWith(api, { [HOLD.plenty]: 1 }, { address: false });
    await openCheckout(page, cart);
    await walkToPayment(page, "hold-3ds-ok@example.com");
    await fillCard(page, CARD_3DS);
    await payButton(page).click();
    await clickChallenge(page, "#test-source-authorize-3ds");
    await page.waitForURL(/\/checkout\/success\?session_id=/, {
      timeout: 90_000,
    });
    const { orderId } = await awaitOrderConfirmation(page);
    expect(wooOrder(orderId).status).toBe("processing");
    expect(reservedRows(HOLD.plenty)).toEqual([]);
  });

  test("C1 — a line held by another shopper at checkout entry is removed with its alert; the page stays and shows the corrected cart (case 27)", async ({
    page,
  }) => {
    const mine = await cartWith(
      api,
      {
        [HOLD.plenty]: 1,
        [HOLD.lastUnit]: 1,
      },
      { address: false },
    );
    const theirs = await cartWith(
      api,
      { [HOLD.lastUnit]: 1 },
      { address: false },
    );
    expect(
      (await holdCheckoutStock(api, theirs)).data?.commerce.holdCheckoutStock
        .status,
    ).toBe("HELD");

    await openCheckout(page, mine);
    await expect(page.getByText(UNAVAILABLE("Hold Last Unit"))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/checkout$/);
    await expectNoErrorScreen(page);
    // S2: the summary on THIS load is the corrected cart.
    const summary = page.locator("main");
    await expect(summary.getByText("Hold Plenty").first()).toBeVisible();
    await expect(
      summary.locator("p", { hasText: /^Hold Last Unit$/ }),
      "the removed line is gone from the summary on the same load",
    ).toHaveCount(0);
  });

  test("B6 — a line another shopper's hold leaves short at checkout entry is reduced with its alert; paying completes the reduced quantity", async ({
    page,
  }) => {
    const mine = await cartWith(api, { [HOLD.three]: 3 }, { address: false });
    const theirs = await cartWith(api, { [HOLD.three]: 1 }, { address: false });
    expect(
      (await holdCheckoutStock(api, theirs)).data?.commerce.holdCheckoutStock
        .status,
    ).toBe("HELD");

    // Theme 0.4.85: a plain cart read no longer rewrites the line to what the
    // hold leaves; it stays 3 and reports the 2 that are left.
    const read = await api.get(`${STORE_API_URL}/cart`, {
      headers: { "Cart-Token": mine },
    });
    expect(read.status()).toBe(200);
    const [line] = (
      (await read.json()) as {
        items: { quantity: number; quantity_limits: { maximum: number } }[];
      }
    ).items;
    expect(line?.quantity, "the read did not clamp the line").toBe(3);
    expect(line?.quantity_limits.maximum, "what the hold leaves").toBe(2);

    await openCheckout(page, mine);
    await expect(
      page
        .getByText(
          "Unfortunately only 2 × Hold Three are available. Your cart has been updated. You have not been charged.",
        )
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/checkout$/);
    await expectNoErrorScreen(page);

    await walkToPayment(page, "hold-b6@example.com");
    await fillCard(page, CARD_OK);
    await payAndAwaitSuccess(page);
    const { orderId } = await awaitOrderConfirmation(page);
    const order = wooOrder(orderId);
    expect(order.status).toBe("processing");
    expect(order.lineQty).toEqual({ [HOLD.three]: 2 });
    expect(stockOf(HOLD.three), "only the 2 paid for were sold").toBe(1);
  });

  test("bag emptied by the correction: the bag with the alert, never the error page (case 29)", async ({
    page,
  }) => {
    const mine = await cartWith(
      api,
      { [HOLD.lastUnit]: 1 },
      { address: false },
    );
    const theirs = await cartWith(
      api,
      { [HOLD.lastUnit]: 1 },
      { address: false },
    );
    await holdCheckoutStock(api, theirs);

    await openCheckout(page, mine);
    await page.waitForURL(/[?&]bag_alerts=/, { timeout: 30_000 });
    await expectNoErrorScreen(page);
    await expect(
      page.getByText(UNAVAILABLE("Hold Last Unit")).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("C2 — a line that sells out during Delivery is corrected on entering Payment, with its alert (case 28)", async ({
    page,
  }) => {
    const mine = await cartWith(
      api,
      {
        [HOLD.plenty]: 1,
        [HOLD.lastUnit]: 1,
      },
      { address: false },
    );
    await openCheckout(page, mine);
    await fillContactStep(page, "hold-c2@example.com");
    await fillShipToHomeStep(page);
    setStock(HOLD.lastUnit, 0);
    await fillShippingOptionsStep(page).catch(() => {
      /* the correction may re-render the step; the alert below is the assertion */
    });
    await expect(
      page.getByText(UNAVAILABLE("Hold Last Unit")).first(),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page).toHaveURL(/\/checkout/);
    await expectNoErrorScreen(page);
  });

  test("C3 — another shopper holds a line at the moment of Pay: per-item alert, no error screen, nothing charged; paying again completes (S1)", async ({
    page,
  }) => {
    const mine = await cartWith(
      api,
      {
        [HOLD.plenty]: 1,
        [HOLD.lastUnit]: 1,
      },
      { address: false },
    );
    const theirs = await cartWith(
      api,
      { [HOLD.lastUnit]: 1 },
      { address: false },
    );
    await openCheckout(page, mine);
    await walkToPayment(page, "hold-c3@example.com");
    await fillCard(page, CARD_OK);

    await holdCheckoutStock(api, theirs);
    await payButton(page).click();
    await expect(
      page.getByText(UNAVAILABLE("Hold Last Unit")).first(),
    ).toBeVisible({ timeout: 45_000 });
    await expectNoErrorScreen(page);
    await expect(page).toHaveURL(/\/checkout/);
    expect(stockOf(HOLD.plenty), "nothing was sold").toBe(50);

    await expect(payButton(page)).toBeEnabled({ timeout: 45_000 });
    await fillCard(page, CARD_OK).catch(() => {
      /* the element may have kept the card */
    });
    await page.waitForTimeout(2_000);
    await payAndAwaitSuccess(page);
    const { orderId } = await awaitOrderConfirmation(page);
    const order = wooOrder(orderId);
    expect(order.status).toBe("processing");
    expect(Object.keys(order.lineQty)).toEqual([HOLD.plenty]);
  });

  test("hold times out: the retry message on Payment, nothing charged (hold timeout)", async ({
    page,
  }) => {
    const cart = await cartWith(api, { [HOLD.plenty]: 1 }, { address: false });
    await openCheckout(page, cart);
    await walkToPayment(page, "hold-slow@example.com");
    await fillCard(page, CARD_OK);
    setOption("hk_e2e_slow_hold_seconds", "8");
    try {
      await payButton(page).click();
      await expect(page.getByText(HOLD_FAILED).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      setOption("hk_e2e_slow_hold_seconds", null);
    }
    await expectNoErrorScreen(page);
    await expect(page).toHaveURL(/\/checkout/);
    expect(stockOf(HOLD.plenty), "nothing was sold").toBe(50);
  });
});

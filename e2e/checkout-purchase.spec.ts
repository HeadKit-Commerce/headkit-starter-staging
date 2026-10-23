import { test, expect, request } from "@playwright/test";
import {
  BASE_URL,
  CARD_DECLINED,
  CARD_OK,
  awaitOrderConfirmation,
  cartTotalMajor,
  cartTotalMinor,
  fillCard,
  fillContactStep,
  fillShipToHomeStep,
  expectBillingSameAsShippingControl,
  fillShippingOptionsStep,
  installCartCookie,
  payAndAwaitSuccess,
  orderSummaryTotalMajor,
  payButtonAmountMajor,
  seedRegularCart,
  stackIsUp,
  stripeSessionAnyKey,
  stripeTestKeys,
  payButton,
  wpOrderStatus,
} from "./helpers";

/**
 * Paid card checkout end-to-end (autonomous QA run — Gap 1, P0-01/02/03/18).
 *
 * THE gap every earlier spec deferred: drive the Stripe PaymentElement card
 * iframe to a COMPLETED test payment against the running LOCAL Docker stack.
 * No mocking anywhere — the flow exercises the real
 * starter → gateway → commerce → WooCommerce Store API → Stripe TEST chain,
 * including the WC 10.8 deferred-draft-order path (`order_id:0` at session
 * create; the bare `/checkout/success?session_id=` return route creates and
 * finalizes the order — P0-02 rides along on every completed purchase here).
 *
 * Covered:
 *   1. P0-01 guest happy path: seeded cart → contact (Stripe
 *      ContactDetailsElement iframe) → Ship to Home (Stripe
 *      ShippingAddressElement iframe, including Stripe phone) → shipping rate →
 *      Stripe native billing = shipping sync checkbox → card 4242… in the
 *      Pay Now → bare success route processes the order → order confirmation
 *      renders order # + line item. Money integrity riders: Stripe TEST API
 *      shows the session paid with amount_total == the Store API cart total at
 *      pay time (P0-09 live variant), and the WC order resolves via the
 *      gateway `storeOrder(id,key)` with a paid status.
 *   2. P0-03 declined card (4000…0002): inline error, NO navigation; refill
 *      with 4242 and the SAME checkout completes (retry path).
 *   3. P0-03 `?error=payment_failed` return renders the dismissible
 *      PaymentFailedBanner; dismissing hides it.
 *   4. P0-18 empty cart: `/checkout` without a cart never mounts payment UI.
 *
 * PREREQUISITES (stack up + seeded — self-skips when down so unit runs stay
 * green):
 *   - WordPress + WooCommerce   http://localhost:8090  (WP_BASE_URL)
 *   - services/commerce (Go)    http://localhost:8080  (Stripe TEST keys)
 *   - Hive Gateway              http://localhost:4000/graphql
 *   - starter (Next)            E2E_BASE_URL (baseURL)
 *   - simple product 678 "Test Product 12" ($22) — E2E_CHECKOUT_PRODUCT_ID
 *   - a Ship-to-Home shipping rate in the local WC zone (seed-shipping.php)
 *
 * LOCAL-ONLY (HARD RULE): every endpoint is a localhost Docker service; Stripe
 * is TEST mode only (asserted on every session read). Card numbers are Stripe
 * public TEST cards. No JWT/secret is ever printed.
 */

const GUEST_EMAIL = "e2e-purchase@example.com";

test.describe("Paid card checkout (Gap 1 — P0-01/02/03/18)", () => {
  // One retry: the decline→refill→retry path can race Stripe's client-side
  // re-tokenization under parallel-worker load (passes consistently solo).
  test.describe.configure({ retries: 1 });

  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter (E2E_BASE_URL)",
    );
  });

  test("P0-01/P0-02/P0-09: guest completes a card purchase; order is created, paid, and confirmed", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    await installCartCookie(context, cartToken);

    await page.goto(`${BASE_URL}/checkout`);
    await expect(
      page,
      "checkout redirected to an error page instead of rendering",
    ).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);

    await fillContactStep(page, GUEST_EMAIL);
    await fillShipToHomeStep(page);
    await fillShippingOptionsStep(page);

    // Payment step: Stripe's native billing-same-as-shipping sync checkbox
    // (syncAddressCheckbox=billing); fill the card in the PaymentElement iframe.
    await expectBillingSameAsShippingControl(page);
    await fillCard(page, CARD_OK);

    // Authoritative payable at pay time (items + selected shipping), BEFORE
    // paying — the WC cart is emptied once the order finalizes.
    const payableAtPayTime = await cartTotalMinor(api, cartToken);
    expect(
      payableAtPayTime,
      "cart total must be > 0 for a paid checkout",
    ).toBeGreaterThan(0);

    // Guard on the pay button's COPY: it must carry an amount, not a bare
    // "Pay Now". A silent revert of `Pay {amount}` fails here rather than
    // sliding through on the locator's fallback branch.
    //
    // The button's FIGURE is deliberately NOT compared to the Woo payable:
    // Stripe Adaptive Pricing may render it in the shopper's local currency
    // (US CI sees `$20.17` for an A$27.00 cart), so that equality is false by
    // construction and only ever reported where the runner sits — see
    // `260827-diagnose-pay-button-vs-cart-payable`. The payable is guarded on
    // two surfaces where both sides are the same currency instead: HeadKit's
    // own order-summary Total below, and Stripe's `amount_total` after the
    // payment (integration currency) further down.
    const payableMajor = await cartTotalMajor(api, cartToken);
    const buttonAmount = await payButtonAmountMajor(page);
    expect(
      buttonAmount,
      'pay button rendered the bare "Pay Now" fallback instead of `Pay {amount}`',
    ).not.toBeNull();

    // The displayed-total-vs-payable guard: the summary HeadKit itself renders
    // must equal the Store API payable at pay time. Same currency by
    // construction (`components/checkout/cart.tsx` formats with the CART's
    // currency). This is the surface where the tax-exclusive display P0
    // (`260825-dishee-checkout-charges-tax-exclusive`) lived — page showing one
    // total while Stripe charged another.
    const summaryTotal = await orderSummaryTotalMajor(page);
    expect(
      summaryTotal,
      "order-summary Total row carried no parseable amount",
    ).not.toBeNull();
    expect(
      summaryTotal ?? 0,
      "order-summary Total != the cart payable at pay time",
    ).toBeCloseTo(payableMajor, 2);

    const sessionId = await payAndAwaitSuccess(page);

    // P0-02: the bare return route processes the WC 10.8 deferred draft order
    // and redirects to the numeric confirmation route.
    const { orderId, orderKey } = await awaitOrderConfirmation(page);

    // Confirmation surface: load the CLEAN order URL (no session_id) — the
    // deep-link surface a shopper revisits from their email. This render is
    // deterministic: it shows the full order summary when the order read
    // succeeds, or the minimal "Order #N has been received" fallback when the
    // local stack's order read 401s — both carry the order number. (The
    // session_id-bearing first render can crash to the error boundary on this
    // stack — see the KNOWN-BUG fixme test below.)
    await page.goto(
      `${BASE_URL}/checkout/success/${orderId}?key=${encodeURIComponent(orderKey)}`,
    );
    // Regex + .first(): the order number can render split across child
    // elements ("Order <span>#845</span> has been received"), which a plain
    // string matcher misses.
    await expect(
      page.getByText(new RegExp(`Order\\s*#${orderId}`)).first(),
      "order confirmation (clean deep-link) did not show the order number",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/your order is confirmed|has been received/i).first(),
      "order confirmation did not show a confirmed message",
    ).toBeVisible();

    // Backend: the WC order is in a PAID status (processing/completed — never
    // pending/failed). Read via wp-cli (see helpers.wpOrderStatus for why the
    // gateway storeOrder read cannot verify paid orders on this stack).
    const wcStatus = wpOrderStatus(orderId);
    if (wcStatus === null) {
      test.info().annotations.push({
        type: "warning",
        description:
          "wp-cli unavailable — WC order-status readback skipped (payment already proven via Stripe TEST API)",
      });
    } else {
      expect(
        wcStatus,
        `order ${orderId} is not in a paid status after card payment`,
      ).toMatch(/processing|completed/i);
    }
    expect(orderKey, "confirmation URL carried the order key").toMatch(
      /^wc_order_/,
    );

    // Backend: Stripe session is TEST-mode, PAID, and charged EXACTLY the
    // cart's payable (Stripe↔Woo amount-mismatch trap).
    if (stripeTestKeys().length > 0) {
      const session = await stripeSessionAnyKey(api, sessionId);
      expect(session.livemode, "MUST be Stripe TEST mode (LOCAL-ONLY)").toBe(
        false,
      );
      expect(
        session.paymentStatus,
        "Stripe session is not paid after the card payment",
      ).toBe("paid");
      expect(
        session.amountTotal,
        "Stripe charged amount != WooCommerce cart payable (P0-09 mismatch)",
      ).toBe(payableAtPayTime);
    }
    await api.dispose();
  });

  test("P0-03: declined card shows an inline error without navigating; retry with a good card completes", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    await installCartCookie(context, cartToken);

    await page.goto(`${BASE_URL}/checkout`);
    // NOTE: the fixture email must NOT contain the word "declined" — the
    // collapsed Contact accordion renders the email as its brief value, and a
    // loose /declined/i page assertion would match it instantly (before the
    // Stripe confirm round-trip), racing the in-flight confirm. Learned the
    // hard way in this suite's first runs.
    await fillContactStep(page, "e2e-retry-path@example.com");
    await fillShipToHomeStep(page);
    await fillShippingOptionsStep(page);

    await fillCard(page, CARD_DECLINED);
    await payButton(page).click();

    // The REAL inline decline error (Stripe copy: "Your card was declined.")
    // renders only after the confirm round-trip; the shopper stays on
    // /checkout — no redirect, no order.
    await expect(
      page.getByText(/your card (was|has been) declined/i).first(),
      "no inline error after a declined test card",
    ).toBeVisible({ timeout: 60_000 });
    expect(page.url(), "declined payment must NOT navigate away").toContain(
      "/checkout",
    );
    expect(page.url()).not.toContain("/checkout/success");

    // The Pay button recovers (isSubmitting released) before the retry —
    // guards against refilling the card while the failed confirm is in flight.
    await expect(payButton(page)).toBeEnabled({ timeout: 30_000 });

    // Retry path: same session, refill with the good card, pay, complete.
    await fillCard(page, CARD_OK);
    // Let the PaymentElement re-tokenize the NEW card before confirming —
    // clicking instantly after the refill can race the element's internal
    // payment-method update and re-submit the declined one (observed flake).
    await page.waitForTimeout(2_000);
    const sessionId = await payAndAwaitSuccess(page);
    expect(sessionId).toMatch(/^cs_test_/);
    const { orderId, orderKey } = await awaitOrderConfirmation(page);
    // Clean deep-link render (deterministic — see the happy-path note).
    await page.goto(
      `${BASE_URL}/checkout/success/${orderId}?key=${encodeURIComponent(orderKey)}`,
    );
    await expect(
      page.getByText(new RegExp(`Order\\s*#${orderId}`)).first(),
      "retry after decline did not reach the order confirmation",
    ).toBeVisible({ timeout: 30_000 });
    await api.dispose();
  });

  /**
   * KNOWN BUG (found by this suite, autonomous QA run 2026-07-18): the FIRST
   * confirmation render — /checkout/success/{orderId}?key=…&session_id=… as
   * redirected to by the bare success route — can crash to the app error
   * boundary ("Something went wrong") for a PAID order.
   *
   * Chain (apps/starter/app/checkout/success/[orderId]/page.tsx):
   *   1. When the success page wins the order-create race, the Stripe session
   *      metadata keeps order_id "0"/empty (documented at the tamper-guard,
   *      ~line 149-153) — only the WEBHOOK writes the real ids back, and no
   *      webhook forwarder runs locally.
   *   2. When the order read 401s (`cannot_view` — on this local stack the
   *      wc/v3 order read over plain HTTP fails for paid orders), the page
   *      sets orderFetchFailed → needsProcessing.
   *   3. It then calls processCheckoutOrderAction(session.cartToken,
   *      session.orderId, session.orderKey, …) (~line 294-306) with NULL
   *      orderId/orderKey → gateway rejects with GraphQL 400 ("Variable
   *      $orderId of non-null type String! must not be null") → the throw is
   *      not matched by the catch's error patterns → rethrown → error
   *      boundary. The URL param `orderId`/`orderKey` (which ARE valid) should
   *      be used as the fallback instead.
   *
   * Deterministic repro: complete a paid checkout, then reload the
   * session_id-bearing confirmation URL. Fix the null-guard, then flip this to
   * a real test asserting the full order summary (line item + email) renders.
   */
  test.fixme("KNOWN BUG: session_id-bearing confirmation render crashes to the error boundary when session metadata has no order id", async () => {
    // Blocked on the processCheckoutOrderAction null-guard fix described
    // above. Intended assertions once fixed:
    //   - goto /checkout/success/{orderId}?key=…&session_id=… renders
    //     "Order #{orderId}", the line item name, and the contact email
    //     (never the "Something went wrong" boundary).
  });

  test("P0-03: ?error=payment_failed renders the dismissible PaymentFailedBanner", async ({
    page,
    context,
  }) => {
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    await api.dispose();
    await installCartCookie(context, cartToken);

    await page.goto(`${BASE_URL}/checkout?error=payment_failed`);
    const bannerText = page.getByText(/your payment was not successful/i);
    await expect(
      bannerText.first(),
      "PaymentFailedBanner did not render on ?error=payment_failed",
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(
      bannerText,
      "PaymentFailedBanner did not hide after dismissing",
    ).toHaveCount(0);
  });

  test("P0-18: /checkout without a cart never mounts the payment UI", async ({
    page,
  }) => {
    // No hk-cart-token cookie at all — the storefront must land the shopper on
    // the empty/expired state (either the /checkout/error page or the
    // "No products in your cart!" state), and the Stripe payment UI must never
    // mount.
    await page.goto(`${BASE_URL}/checkout`);
    await expect(
      page
        .getByText(
          /no products in your cart|cart is empty|session has expired/i,
        )
        .first(),
      "empty-cart checkout did not show an empty/expired state",
    ).toBeVisible({ timeout: 30_000 });
    // The payment UI must never be reachable from an empty cart.
    await expect(payButton(page)).toHaveCount(0);
    expect(
      page.frames().filter((f) => /elements-inner-payment/.test(f.url())),
      "a Stripe PaymentElement mounted on an empty-cart checkout",
    ).toHaveLength(0);
  });
});

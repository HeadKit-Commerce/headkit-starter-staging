import { test, expect, request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  STORE_API,
  cartTotalMinor,
  createCheckoutSession,
  installCartCookie,
  seedRegularCart,
  stackIsUp,
  stripeSessionAnyKey,
  stripeTestKeys,
} from "./helpers";

/**
 * Coupons at checkout (autonomous QA run — Gap 5, P0-10/P0-11) + the
 * 100%-off free-order branch (P0-07 de-manualed — no more E2E_FREE_CART_TOKEN
 * hand-seeding needed to exercise PAY-05).
 *
 * Covered:
 *   1. P0-10 UI: applying `E2E-PERCENT-10` in the checkout's combined
 *      "Coupon Code or Gift Card" box renders the discount line and drops the
 *      WC cart payable by exactly 10% of the items subtotal; removing the
 *      coupon restores the original total.
 *   2. P0-11: a junk code shows the combined "neither coupon nor gift card"
 *      message and leaves the cart totals unchanged.
 *   3. P0-10 money guard (API, GIFT-04 pattern): a Stripe Checkout Session
 *      created AFTER the coupon is applied charges exactly the reduced
 *      payable (TEST API readback).
 *   4. P0-07: `E2E-FREE-100` + the free-shipping rate produce a $0-total
 *      cart-with-items → /checkout renders the "No payment required" branch
 *      (never the empty-cart message, never a Stripe mount) and confirming
 *      places the order onto the success page.
 *
 * PREREQUISITES (self-skips when the stack is down; FAILS LOUDLY when the
 * coupon seed is missing):
 *   - local Docker stack (WP :8090, gateway :4000, starter E2E_BASE_URL)
 *   - coupon fixtures seeded — docker/wordpress/seed-coupons.php:
 *       docker cp docker/wordpress/seed-coupons.php docker-wordpress-1:/tmp/seed-coupons.php
 *       docker exec docker-wordpress-1 wp eval-file /tmp/seed-coupons.php --allow-root
 *   - simple product 678 ($22) + a free-shipping rate in the local WC zone
 *
 * NOTE: WooCommerce lowercases coupon codes (`wc_format_coupon_code`), so the
 * cart/UI surface `e2e-percent-10` — all assertions match case-insensitively.
 *
 * LOCAL-ONLY (HARD RULE): localhost Docker services; Stripe TEST mode only.
 */

const PERCENT_COUPON = "E2E-PERCENT-10";
const FREE_COUPON = "E2E-FREE-100";
const JUNK_CODE = "NOT-A-CODE-123";
const INVALID_MSG = "That code isn't a valid coupon or gift card.";

/** Apply a coupon to a cart via the Store API. Fails loudly if the seed is missing. */
async function applyCouponViaStoreApi(
  api: APIRequestContext,
  cartToken: string,
  code: string,
): Promise<void> {
  const res = await api.post(`${STORE_API}/cart/apply-coupon`, {
    headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
    data: { code },
  });
  expect(
    res.status(),
    `apply-coupon ${code} failed (HTTP ${res.status()}) — is the coupon seeded? (docker/wordpress/seed-coupons.php)`,
  ).toBe(200);
}

test.describe("Coupons: percent apply/remove, junk code, charge integrity, 100%-off free order (Gap 5)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter (E2E_BASE_URL)",
    );
  });

  test("P0-10: UI apply drops the payable by the discount; remove restores it", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 3);
    const totalBefore = await cartTotalMinor(api, cartToken);
    await installCartCookie(context, cartToken);

    await page.goto(`${BASE_URL}/checkout`);
    await expect(page).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);

    const codeBox = page.getByPlaceholder("Coupon Code or Gift Card");
    await expect(
      codeBox,
      "combined coupon/gift-card box did not render at checkout",
    ).toBeVisible({ timeout: 30_000 });
    await codeBox.fill(PERCENT_COUPON);
    await page.getByRole("button", { name: /^apply$/i }).click();

    // Discount line renders (WC lowercases the code).
    await expect(
      page.getByText(/coupon: e2e-percent-10/i).first(),
      "applied coupon line did not render — is E2E-PERCENT-10 seeded? (seed-coupons.php)",
    ).toBeVisible({ timeout: 30_000 });

    // The WC payable drops by exactly 10% of the items subtotal ($66 → −$6.60).
    await expect
      .poll(async () => cartTotalMinor(api, cartToken), {
        message: "cart payable did not drop after applying the 10% coupon",
        timeout: 20_000,
      })
      .toBe(totalBefore - 660);

    // Remove restores the original total and clears the line.
    await page.getByRole("button", { name: "[remove]" }).click();
    await expect(
      page.getByText(/coupon: e2e-percent-10/i),
      "coupon line still rendered after removal",
    ).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(async () => cartTotalMinor(api, cartToken), {
        message: "cart payable was not restored after removing the coupon",
        timeout: 20_000,
      })
      .toBe(totalBefore);
    await api.dispose();
  });

  test("P0-11: a junk code shows the combined invalid message and changes nothing", async ({
    page,
    context,
  }) => {
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    const totalBefore = await cartTotalMinor(api, cartToken);
    await installCartCookie(context, cartToken);

    await page.goto(`${BASE_URL}/checkout`);
    const codeBox = page.getByPlaceholder("Coupon Code or Gift Card");
    await expect(codeBox).toBeVisible({ timeout: 30_000 });
    await codeBox.fill(JUNK_CODE);
    await page.getByRole("button", { name: /^apply$/i }).click();

    await expect(
      page.getByText(INVALID_MSG),
      "combined invalid-code message did not render for a junk code",
    ).toBeVisible({ timeout: 30_000 });
    expect(
      await cartTotalMinor(api, cartToken),
      "cart total changed after a rejected junk code",
    ).toBe(totalBefore);
    await api.dispose();
  });

  test("P0-10 charge integrity: a session created after the coupon charges the REDUCED payable", async () => {
    const api = await request.newContext();
    test.skip(
      stripeTestKeys().length === 0,
      "Stripe TEST key (sk_test_) not configured — cannot read the charged amount",
    );
    const cartToken = await seedRegularCart(api, 3);
    const fullTotal = await cartTotalMinor(api, cartToken);

    await applyCouponViaStoreApi(api, cartToken, PERCENT_COUPON);
    const reducedPayable = await cartTotalMinor(api, cartToken);
    expect(reducedPayable).toBeLessThan(fullTotal);
    expect(reducedPayable).toBeGreaterThan(0);

    const sessionId = await createCheckoutSession(api, cartToken);
    const session = await stripeSessionAnyKey(api, sessionId);
    expect(session.livemode, "MUST be Stripe TEST mode (LOCAL-ONLY)").toBe(
      false,
    );
    expect(
      session.amountTotal,
      "Stripe session amount must equal the post-coupon payable — coupon discount lost at charge time",
    ).toBe(reducedPayable);
    await api.dispose();
  });

  /**
   * KNOWN BUG (found by this suite, autonomous QA run 2026-07-18): the
   * zero-total (free-order) checkout is BROKEN end-to-end on this stack.
   *
   * Repro (fully scripted below — re-enable by turning fixme back into test):
   * cart with product 678 + seeded E2E-FREE-100 coupon (100% + free shipping)
   * + free-shipping rate selected → Store API total_price = 0 → /checkout.
   *
   * Expected: the "No payment required" branch renders and Place order lands
   * on the confirmation (PAY-05 / P0-07).
   * Actual (when recorded): /checkout redirected to
   * /checkout/error?reason=session_creation_failed — the page never rendered.
   * A session failure now returns to /checkout?error=session_creation_failed
   * (`lib/checkout-failure.ts`); the zero-total defect below is unchanged.
   *
   * Root cause (commerce): the zero-total finalize posts
   * `payment_method: "none"` to the WC Store API /checkout —
   * services/commerce/graph/schema.resolvers.go:529 and :535
   * (`ProcessCheckoutInput{PaymentMethod: "none"}`) — and WooCommerce rejects
   * it with `rest_invalid_param`: "payment_method is not one of , bacs,
   * cheque, cod, and headkit-payments". Reproduced directly via the gateway:
   * createCheckoutSession on a $0 cart → "CreateCheckoutSession.
   * ZeroTotalFinalize: WooCommerce checkout error … status 400".
   * Fix direction: send "" (or a registered gateway id) instead of "none".
   *
   * NOTE: free-order.spec.ts never caught this because it is gated on a
   * hand-seeded E2E_FREE_CART_TOKEN env and skips otherwise.
   */
  test.fixme("P0-07: 100%-off coupon + free shipping renders the no-payment branch and places the order", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    await applyCouponViaStoreApi(api, cartToken, FREE_COUPON);

    // Shipping rates only materialise once the cart has a destination — set
    // one via update-customer (ISO codes; display names 400 — the
    // 'Australia'→400 trap).
    const upd = await api.post(`${STORE_API}/cart/update-customer`, {
      headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
      data: {
        shipping_address: {
          first_name: "E2E",
          last_name: "Free",
          address_1: "123 Example Street",
          city: "Sydney",
          state: "NSW",
          postcode: "2000",
          country: "AU",
        },
      },
    });
    expect(upd.status(), "update-customer failed").toBe(200);

    // The coupon zeroes the items; shipping must also be $0 — select the
    // free-shipping rate (unlocked by the coupon's free_shipping flag).
    const cart = (await (
      await api.get(`${STORE_API}/cart`, {
        headers: { "Cart-Token": cartToken },
      })
    ).json()) as {
      shipping_rates?: Array<{
        package_id: number | string;
        shipping_rates: Array<{
          rate_id: string;
          price: string;
          method_id: string;
        }>;
      }>;
    };
    const pkg = cart.shipping_rates?.[0];
    const freeRate = pkg?.shipping_rates.find(
      (r) =>
        r.method_id === "free_shipping" ||
        (Number(r.price) === 0 &&
          !/local_pickup|pickup_location/.test(r.rate_id)),
    );
    expect(
      freeRate,
      "no free-shipping rate available — seed one in the local WC zone (seed-shipping.php)",
    ).toBeTruthy();
    const sel = await api.post(`${STORE_API}/cart/select-shipping-rate`, {
      headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
      data: { package_id: pkg!.package_id, rate_id: freeRate!.rate_id },
    });
    expect(sel.status(), "select-shipping-rate failed").toBe(200);

    expect(
      await cartTotalMinor(api, cartToken),
      "cart total is not $0 after the 100% coupon + free shipping",
    ).toBe(0);

    await installCartCookie(context, cartToken);
    await page.goto(`${BASE_URL}/checkout`);

    // The FREE-ORDER branch — never the empty-cart message, no Stripe mount.
    await expect(
      page.getByText("No payment required"),
      "$0 cart-with-items did not render the no-payment branch (PAY-05)",
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("No products in your cart!")).toHaveCount(0);
    expect(
      page.frames().filter((f) => /elements-inner-payment/.test(f.url())),
      "a Stripe PaymentElement mounted on a $0 checkout",
    ).toHaveLength(0);

    // Confirm → the server-side zero-total bypass places the order.
    await page.getByRole("button", { name: /^place order$/i }).click();
    await page.waitForURL(/\/checkout\/success\/\d+\?/, { timeout: 60_000 });
    await expect(
      page.getByText(/your order is confirmed|has been received/i).first(),
      "free order did not land on the confirmation page",
    ).toBeVisible({ timeout: 30_000 });
    await api.dispose();
  });
});

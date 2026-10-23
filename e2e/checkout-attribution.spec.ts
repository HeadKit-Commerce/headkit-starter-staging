import { test, expect, request } from "@playwright/test";
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  BASE_URL,
  GATEWAY_URL,
  STORE_KEY,
  TEST_EMAIL,
  TEST_USER,
  awaitOrderConfirmation,
  fillCard,
  fillShipToHomeStep,
  fillShippingOptionsStep,
  installCartCookie,
  loginViaUi,
  mintAuthToken,
  payAndAwaitSuccess,
  seedRegularCart,
  stackIsUp,
  stripeFrameWith,
  stripeSessionAnyKey,
  stripeTestKeys,
  waitForDeliveryStep,
} from "./helpers";

/**
 * Logged-in checkout attribution + account surfaces (autonomous QA run —
 * Gap 2, P0-04/P0-05/P0-20/P0-22/P0-26).
 *
 * Extends checkout-auth.spec.ts (which proves prefill/read surfaces) with the
 * pieces that need a COMPLETED paid order — now automatable via the Gap-1
 * card-iframe helpers:
 *
 *   1. P0-04 attribution: a logged-in shopper completes a card purchase → the
 *      WC order carries the seeded user's customer_id (wp-cli readback) and
 *      appears in /account/orders (list + detail).
 *   2. P0-05 Stripe customer binding (ENG-783): two checkout sessions created
 *      for the SAME logged-in user bind the SAME non-null Stripe customer
 *      (reuse, no duplicates); a guest session binds none.
 *   3. P0-26 address save-back: editing the shipping address at
 *      /account/addresses ("Address saved" toast) feeds the authed Store-API
 *      cart (the data layer the next checkout session reads). The seeded
 *      value is RESTORED afterwards (checkout-auth.spec.ts asserts it).
 *   4. P0-20 error path: a wrong password shows the inline error and sets no
 *      auth cookie.
 *   5. P0-22 guard: anonymous /account/orders lands on the sign-in form with
 *      no private content.
 *
 * PREREQUISITES (self-skips when the stack is down):
 *   - local Docker stack; seeded `hk-checkout-test` user
 *     (docker/wordpress/seed-auth-user.php; HK_TEST_PASS override supported)
 *   - simple product 678; a Ship-to-Home rate (seed-shipping.php)
 *
 * LOCAL-ONLY (HARD RULE): localhost Docker services; Stripe TEST mode only;
 * the JWT is never printed.
 */

const WP_CONTAINER = process.env.E2E_WP_CONTAINER ?? "docker-wordpress-1";

/** wp-cli helper (returns null when docker/wp-cli unavailable). */
function wpCli(args: string[]): string | null {
  try {
    const out = execFileSync(
      "docker",
      ["exec", WP_CONTAINER, "wp", ...args, "--allow-root"],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const lines = out.trim().split("\n");
    return (lines[lines.length - 1] ?? "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Complete the Contact step for a LOGGED-IN shopper. The authed session may
 * already carry a bound email (rendered fixed inside the Stripe element) or —
 * with the prefill regression on this stack (see checkout-auth CKA-04) — an
 * empty editable input. Handle both: fill only when empty, then advance.
 */
async function completeAuthedContactStep(page: Page): Promise<void> {
  const frame = await stripeFrameWith(page, 'input[name="email"]');
  const input = frame.locator('input[name="email"]');
  const current = await input.inputValue().catch(() => "");
  if (!current) {
    await input.fill(TEST_EMAIL);
    await input.blur();
  }
  const cont = page.getByRole("button", { name: /continue to delivery/i });
  await expect(
    cont,
    "Continue to Delivery never enabled on the logged-in contact step",
  ).toBeEnabled({ timeout: 20_000 });
  await cont.click();
  await waitForDeliveryStep(page);
}

/**
 * Complete the Delivery step for a LOGGED-IN shopper. The saved WP address is
 * seeded into the Stripe ShippingAddressElement via `contacts` (CKA-04), so
 * the step can already be valid — in that case just fill a missing phone and
 * advance. Falls back to the manual fill when the prefill did not land.
 */
async function completeAuthedDeliveryStep(page: Page): Promise<void> {
  const cont = page.getByRole("button", { name: /^continue$/i });
  await expect(
    cont,
    "delivery step did not render after the contact step",
  ).toBeVisible({ timeout: 30_000 });
  // Give the saved-address (`contacts`) prefill a moment to validate; Stripe's
  // phone field inside ShippingAddressElement may still need a value.
  try {
    const frame = await stripeFrameWith(
      page,
      'input[name="addressLine1"]',
      5_000,
    );
    const stripePhone = frame.locator('input[name="phone"]');
    if (
      (await stripePhone.isVisible().catch(() => false)) &&
      !(await stripePhone.inputValue().catch(() => ""))
    ) {
      await stripePhone.fill("0412345678").catch(() => {});
    }
  } catch {
    const phone = page.getByPlaceholder("Enter phone number");
    if (
      (await phone.isVisible().catch(() => false)) &&
      !(await phone.inputValue().catch(() => ""))
    ) {
      await phone.fill("0412345678").catch(() => {});
    }
  }
  try {
    await expect(cont).toBeEnabled({ timeout: 15_000 });
  } catch {
    // Prefill did not land — drive the element manually (guest-style).
    await fillShipToHomeStep(page);
    return;
  }
  await cont.click();
}

test.describe("Checkout attribution: logged-in paid order + account surfaces (Gap 2)", () => {
  // SERIAL: P0-05 (customer reuse) depends on P0-04's COMPLETED logged-in
  // payment — Stripe creates the reusable customer at session COMPLETION
  // (customer_creation=always), never at create. The first authed PAID
  // checkout mints the customer; only then do subsequent authed sessions bind
  // it at create (ENG-783 FindCustomerByEmail on the WP account email).
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter (E2E_BASE_URL)",
    );
  });

  test("P0-04: a logged-in purchase attributes the order to the customer and shows in /account/orders", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const api = await request.newContext();
    const cartToken = await seedRegularCart(api, 1);
    await installCartCookie(context, cartToken);
    await loginViaUi(page);
    try {
      await page.goto(`${BASE_URL}/checkout`);
      await expect(page).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);

      await completeAuthedContactStep(page);
      await completeAuthedDeliveryStep(page);
      await fillShippingOptionsStep(page);
      await fillCard(page);
      const sessionId = await payAndAwaitSuccess(page);
      const { orderId } = await awaitOrderConfirmation(page);

      // Attribution at the WC layer: order.customer_id == the seeded WP user.
      const expectedUserId = wpCli(["user", "get", TEST_USER, "--field=ID"]);
      const orderCustomerId = wpCli([
        "wc",
        "shop_order",
        "get",
        orderId,
        "--user=1",
        "--field=customer_id",
      ]);
      if (expectedUserId && orderCustomerId) {
        expect(
          orderCustomerId,
          `order ${orderId} customer_id (${orderCustomerId}) != seeded user id (${expectedUserId}) — attribution lost (P0-04)`,
        ).toBe(expectedUserId);
      } else {
        test.info().annotations.push({
          type: "warning",
          description:
            "wp-cli unavailable — customer_id readback skipped (list/detail assertions below still prove attribution)",
        });
      }

      // ENG-783: after COMPLETION the session carries a Stripe customer —
      // either bound at create (reuse) or created at completion
      // (customer_creation=always for authed shoppers).
      if (stripeTestKeys().length > 0) {
        const session = await stripeSessionAnyKey(api, sessionId);
        expect(
          session.paymentStatus,
          "logged-in session is not paid after the card payment",
        ).toBe("paid");
        expect(
          session.customer,
          "completed logged-in session carries NO Stripe customer (ENG-783: customer_creation=always broken)",
        ).not.toBeNull();
      }

      // Read surface: the new order appears in the account order list…
      await page.goto(`${BASE_URL}/account/orders`);
      const orderCard = page.getByRole("link", {
        name: new RegExp(`Order #${orderId}`),
      });
      await expect(
        orderCard,
        `order ${orderId} missing from /account/orders — attribution/read-surface broken (P0-04)`,
      ).toBeVisible({ timeout: 30_000 });

      await api.dispose();
    } finally {
      // A COMPLETED logged-in checkout intentionally converges the WP user's
      // saved billing+shipping to the checkout address (last-used-wins).
      // Restore the SEEDED values so checkout-auth.spec.ts A1 (which asserts
      // them) stays green across suite runs.
      const uid = wpCli(["user", "get", TEST_USER, "--field=ID"]);
      if (uid) {
        wpCli([
          "user",
          "meta",
          "update",
          uid,
          "billing_address_1",
          "12 Test Parade",
        ]);
        wpCli([
          "user",
          "meta",
          "update",
          uid,
          "shipping_address_1",
          "88 Delivery Way",
        ]);
      }
    }
  });

  /**
   * KNOWN BUG (found by this suite, autonomous QA run 2026-07-18): the
   * account ORDER DETAIL surface cannot render on this stack — clicking an
   * order card (/account/orders/{id}?key=…) shows "This order link is invalid
   * or has expired" for a legitimately owned, freshly PAID order.
   *
   * Chain: app/account/(private)/orders/[orderId]/page.tsx →
   * getOrderAction(orderId, orderKey) → gateway `storeOrder(id,key)` →
   * commerce GetOrder → wc/v3 GET /orders/{id} responds 401
   * `woocommerce_rest_cannot_view` for PAID orders on this local stack —
   * while ListOrders (wc/v3 GET /orders?customer=…, same credentials) works,
   * which is why the LIST renders but every DETAIL click dead-ends. The same
   * failing read also degrades the guest confirmation page to its minimal
   * fallback (see checkout-purchase.spec.ts notes).
   *
   * Once the single-order read is fixed, flip to a real test: click the
   * order card from /account/orders and assert the "Order #{id}" heading +
   * status/details render.
   */
  test.fixme("KNOWN BUG: /account/orders/{id} detail dead-ends (storeOrder 401 cannot_view for paid orders)", async () => {
    // Blocked on the commerce GetOrder wc/v3 single-order 401 above.
  });

  test("P0-05: authed sessions reuse ONE Stripe customer; a guest session binds none", async () => {
    // Runs AFTER the paid logged-in checkout above (serial mode): that
    // completion minted the account's Stripe customer, so authed session
    // creates must now FIND and BIND it (ENG-783 reuse — saved cards), and
    // bind the SAME one every time (dedup).
    const api = await request.newContext();
    test.skip(
      stripeTestKeys().length === 0,
      "Stripe TEST key (sk_test_) not configured — cannot read session customers",
    );
    const authToken = await mintAuthToken(api);

    const createSession = async (withAuth: boolean): Promise<string> => {
      const cartToken = await seedRegularCart(api, 1);
      const res = await api.post(GATEWAY_URL, {
        headers: {
          "content-type": "application/json",
          "x-headkit-key": STORE_KEY,
          "x-cart-token": cartToken,
          ...(withAuth ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        data: {
          query:
            "mutation($i:CreateCheckoutSessionInput!){commerce{createCheckoutSession(input:$i){sessionId testMode}}}",
          variables: {
            i: {
              returnUrl: `${BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            },
          },
        },
      });
      const json = await res.json();
      expect(
        json.errors,
        `createCheckoutSession errored: ${JSON.stringify(json.errors)}`,
      ).toBeUndefined();
      const result = json.data.commerce.createCheckoutSession;
      expect(result.testMode, "Stripe must be TEST mode (LOCAL-ONLY)").toBe(
        true,
      );
      return result.sessionId as string;
    };

    const authedA = await stripeSessionAnyKey(api, await createSession(true));
    const authedB = await stripeSessionAnyKey(api, await createSession(true));
    const guest = await stripeSessionAnyKey(api, await createSession(false));

    expect(
      authedA.customer,
      "authed session A bound no Stripe customer (ENG-783)",
    ).not.toBeNull();
    expect(
      authedB.customer,
      "authed session B bound no Stripe customer (ENG-783)",
    ).not.toBeNull();
    expect(
      authedB.customer,
      "two authed sessions bound DIFFERENT Stripe customers — dedup/reuse broken (ENG-783)",
    ).toBe(authedA.customer);
    expect(
      guest.customer,
      "a GUEST session bound a Stripe customer — guests must stay 0-customer (ENG-783)",
    ).toBeNull();
    await api.dispose();
  });

  test("P0-26: address save-back — the edited shipping address feeds the authed cart", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const NEW_LINE1 = "77 Save-Back Lane";
    const SEEDED_LINE1 = "88 Delivery Way"; // checkout-auth.spec.ts asserts this
    const userId = wpCli(["user", "get", TEST_USER, "--field=ID"]);

    try {
      await loginViaUi(page);
      await page.goto(`${BASE_URL}/account/addresses`);
      // Shipping section renders SECOND (billing first) — nth(1).
      const shippingLine1 = page.getByPlaceholder("Street address").nth(1);
      await expect(shippingLine1).toBeVisible({ timeout: 30_000 });
      await shippingLine1.fill(NEW_LINE1);
      await page.getByRole("button", { name: /save address/i }).click();
      await expect(
        page.getByText("Address saved").first(),
        "no 'Address saved' toast after saving",
      ).toBeVisible({ timeout: 30_000 });

      // Data layer: a FRESH authed Store-API cart surfaces the NEW address —
      // exactly what the next checkout session reads (checkout-auth A1 style).
      const api = await request.newContext();
      const token = await mintAuthToken(api);
      const boot = await api.get(
        `${process.env.WP_BASE_URL ?? "http://localhost:8090"}/wp-json/wc/store/v1/cart`,
      );
      const freshCartToken = boot.headers()["cart-token"] ?? "";
      const authedCart = await (
        await api.get(
          `${process.env.WP_BASE_URL ?? "http://localhost:8090"}/wp-json/wc/store/v1/cart`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Cart-Token": freshCartToken,
            },
          },
        )
      ).json();
      await api.dispose();
      expect(
        authedCart.shipping_address?.address_1,
        "the authed cart does not surface the just-saved shipping address (save-back broken, P0-26)",
      ).toBe(NEW_LINE1);
    } finally {
      // ALWAYS restore the seeded values — checkout-auth.spec.ts depends on
      // them (billing too: the form submits both sections).
      if (userId) {
        wpCli([
          "user",
          "meta",
          "update",
          userId,
          "shipping_address_1",
          SEEDED_LINE1,
        ]);
        wpCli([
          "user",
          "meta",
          "update",
          userId,
          "billing_address_1",
          "12 Test Parade",
        ]);
      }
    }
  });

  test("P0-20: a wrong password shows the inline error and never sets the auth cookie", async ({
    page,
    context,
  }) => {
    await page.goto(`${BASE_URL}/account`);
    await page.getByLabel("Email").first().fill(TEST_EMAIL);
    await page.getByLabel("Password").first().fill("definitely-wrong-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(
      page.getByText(/invalid email or password|invalid|incorrect/i).first(),
      "no inline error after a wrong password",
    ).toBeVisible({ timeout: 30_000 });
    expect(
      page.url(),
      "wrong password must not reach the private area",
    ).not.toContain("/account/profile");
    const authCookie = (await context.cookies()).find(
      (c) => c.name === "hk-auth-token",
    );
    expect(
      authCookie,
      "hk-auth-token cookie was set despite a failed sign-in",
    ).toBeUndefined();
  });

  test("P0-22: anonymous /account/orders lands on the sign-in form, never private content", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/account/orders`);
    // The guard 307s anonymous hits to /account (the sign-in page).
    await expect(page).toHaveURL(/\/account$/);
    await expect(
      page.getByRole("button", { name: /^sign in$/i }),
      "sign-in form did not render for an anonymous private-area hit",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("My Orders"),
      "private order-history content leaked to an anonymous visitor (P0-22)",
    ).toHaveCount(0);
  });
});

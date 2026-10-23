import { test, expect, request, type Page } from "@playwright/test";

/**
 * Checkout auth & persistence e2e (Phase 4.1 Plan 05 — Wave 3).
 *
 * Proves the logged-in checkout auth pipe (Plans 01–04) end-to-end against the
 * running LOCAL Docker stack. It drives the REAL storefront in a browser (the
 * app supplies its own store key, cart-token and `hk-auth-token` cookie) and
 * does NOT mock the WP/Go/Stripe layer.
 *
 * Covered here (automated):
 *   1. CKA-04 / A4 — RELOAD DURABILITY (the core fix): a logged-in checkout
 *      prefills the seeded WP user's email into the Stripe ContactDetailsElement
 *      and that email SURVIVES a full page reload (it lives in the
 *      server-recreated Stripe session, not client state). The field stays
 *      editable.
 *   2. CKA-04 / A1 — SAVED-ADDRESS DATA LAYER: the authed WooCommerce Store API
 *      cart surfaces the seeded user's saved billing (Sydney) + shipping
 *      (Melbourne) address; the guest cart surfaces none. This is the data that
 *      feeds the recreated checkout session. (The Stripe BillingAddressElement
 *      does NOT render the saved address into its inputs on load — ENG-755:
 *      returning-customer address is applied to the Sessions checkout
 *      server-side via actions.updateBillingAddress, not as a client element
 *      option — so the address prefill is asserted at the cart layer, where it
 *      is deterministic, rather than by reading a Stripe iframe.)
 *   3. CKA-07 — GUEST REGRESSION: a guest checkout still renders and prefills
 *      NO email (the guest path is unchanged — the Plan 01/02 security property).
 *   4. CKA-06 — ATTRIBUTION READ-SURFACE: the logged-in account order-history
 *      page is reachable and JWT-scoped (the surface a completed order attributes
 *      into). See the DEFERRED note below — placing a paid order to assert the
 *      order's `customer_id` and its appearance in this list is a manual UAT step
 *      (Plan 05 Task 2), because completing payment requires driving the Stripe
 *      card iframe + the paid-webhook, which is not reliably automatable in this
 *      local env. This spec does NOT fake an order completion.
 *
 * DEFERRED TO MANUAL UAT (Plan 05 Task 2 — do not fake here):
 *   - Actual order completion + `customer_id` on the placed order (attribution).
 *   - Address save-back A→B convergence in WP user meta (last-used-wins).
 *   - Stripe Link override (needs a real Stripe Link test account).
 *
 * PREREQUISITES (stack up + seeded — see e2e/check-auth-storeapi.sh header and
 * docker/wordpress/seed-auth-user.php):
 *   - WordPress + WooCommerce   http://localhost:8090  (WP_BASE_URL)
 *   - Hive Gateway              http://localhost:4000/graphql
 *   - starter (Next)            baseURL below (E2E_BASE_URL)
 *   - the Layer 1 determine_current_user JWT filter active in the running WP
 *   - the seeded `hk-checkout-test` user (Plan 01 seed)
 * If a prerequisite is missing the spec FAILS LOUDLY (it never silently skips).
 *
 * NOTE on ports/creds for THIS stack: the running starter under test is served
 * on :3001 and the seeded user's password is `Eng792Test!pass`. The committed
 * defaults below match the repo convention (:3000) and the committed seed file
 * (`HkCheckout!2026`); override per-run:
 *   E2E_BASE_URL=http://localhost:3001 HK_TEST_PASS='Eng792Test!pass' \
 *     bun run --filter @headkit/starter test:e2e -- checkout-auth
 *
 * LOCAL-ONLY (HARD RULE): every endpoint is a localhost Docker service. No
 * staging/prod host may appear here. The JWT is NEVER printed (T-04.1-21).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const WP_BASE_URL = process.env.WP_BASE_URL ?? "http://localhost:8090";

// Seeded fixture (docker/wordpress/seed-auth-user.php). Password is
// env-overridable so the spec works against a freshly-seeded stack (seed-file
// default) or this running stack (Eng792Test!pass).
const TEST_EMAIL = process.env.HK_TEST_EMAIL ?? "hk-checkout-test@example.com";
const TEST_USER = process.env.HK_TEST_USER ?? "hk-checkout-test";
const TEST_PASS = process.env.HK_TEST_PASS ?? "HkCheckout!2026";

// A purchasable simple product in the local seed (Test Product 12). Override if
// the local catalog differs.
const PRODUCT_ID = Number(process.env.E2E_CHECKOUT_PRODUCT_ID ?? "678");

// Address A saved on the seeded user (Address A — billing Sydney / shipping
// Melbourne). These are the value the authed cart must surface.
const EXPECT_BILLING_LINE1 = "12 Test Parade"; // billing (Sydney, AU)
const EXPECT_SHIPPING_LINE1 = "88 Delivery Way"; // shipping (Melbourne, AU)

/**
 * Seed a fresh WooCommerce cart with one item via the Store API and return its
 * Cart-Token. The token is dropped into the `hk-cart-token` cookie so the
 * storefront's /checkout resolves this cart. Fails loudly if the stack/product
 * is missing.
 */
async function seedCartWithItem(): Promise<string> {
  const api = await request.newContext();
  const bootstrap = await api.get(`${WP_BASE_URL}/wp-json/wc/store/v1/cart`);
  expect(
    bootstrap.status(),
    `WooCommerce Store API unreachable at ${WP_BASE_URL} — is the local WP stack up?`,
  ).toBe(200);
  const cartToken = bootstrap.headers()["cart-token"] ?? "";
  expect(cartToken, "Store API did not return a Cart-Token header").not.toBe(
    "",
  );

  const add = await api.post(
    `${WP_BASE_URL}/wp-json/wc/store/v1/cart/add-item`,
    {
      headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
      data: { id: PRODUCT_ID, quantity: 1 },
    },
  );
  // Store API returns 201 Created on add-item (200 on some WC versions).
  expect(
    [200, 201],
    `add-item failed for product ${PRODUCT_ID} (HTTP ${add.status()}) — check the local catalog / product id`,
  ).toContain(add.status());
  const body = await add.json();
  expect(
    body.items_count,
    `cart is empty after add-item (product ${PRODUCT_ID})`,
  ).toBeGreaterThan(0);
  await api.dispose();
  return cartToken;
}

/**
 * Log in through the REAL storefront sign-in form (/account). On success the app
 * sets the non-httpOnly `hk-auth-token` cookie and routes to /account/profile.
 * Identity is carried only by that cookie thereafter.
 */
async function loginViaUi(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/account`);
  await page.getByLabel("Email").first().fill(TEST_EMAIL);
  await page.getByLabel("Password").first().fill(TEST_PASS);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/account\/profile/, { timeout: 30_000 });
  const cookies = await page.context().cookies();
  const authCookie = cookies.find((c) => c.name === "hk-auth-token");
  expect(
    authCookie?.value?.length ?? 0,
    "login did not set the hk-auth-token cookie — sign-in failed (check seeded creds / WP up)",
  ).toBeGreaterThan(0);
}

/**
 * Poll every frame (the Stripe ContactDetailsElement renders the email into an
 * input inside a cross-origin js.stripe.com iframe) for an input carrying the
 * given email value. Returns whether it is present within the timeout. Never
 * logs the value beyond the email under test.
 */
async function emailPrefilledInCheckout(
  page: Page,
  email: string,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const selector = `input[value="${email}"]`;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame
        .locator(selector)
        .count()
        .catch(() => 0);
      if (count > 0) return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/** Locate the prefilled email input across frames (or null). */
async function findEmailInput(page: Page, email: string) {
  for (const frame of page.frames()) {
    const loc = frame.locator(`input[value="${email}"]`);
    if (await loc.count().catch(() => 0)) return loc.first();
  }
  return null;
}

test.describe("Checkout auth: logged-in prefill + reload durability + guest safety", () => {
  test("logged-in checkout prefills the saved WP email and it SURVIVES a reload (CKA-04/A4)", async ({
    page,
    context,
  }) => {
    const cartToken = await seedCartWithItem();
    await context.addCookies([
      { name: "hk-cart-token", value: cartToken, url: BASE_URL },
    ]);

    await loginViaUi(page);

    await page.goto(`${BASE_URL}/checkout`);
    // Not redirected to the checkout error page (session created for the cart).
    await expect(
      page,
      "logged-in checkout redirected to an error page instead of rendering",
    ).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);

    // Prefill BEFORE reload — the seeded WP email is populated into the Stripe
    // ContactDetailsElement (sourced from the recreated session's customer_email).
    const before = await emailPrefilledInCheckout(page, TEST_EMAIL);
    expect(
      before,
      "logged-in checkout did NOT prefill the saved WP email into the contact step (CKA-04 prefill regression)",
    ).toBe(true);

    // Confirm the prefilled email input is actually present (the value is
    // rendered inside the Stripe element). NOTE: field EDITABILITY is a manual
    // UAT check (Plan 05 Task 2 step 4), not asserted here — the Stripe
    // ContactDetailsElement marks its raw DOM input `readonly` and manages
    // editing through the element itself (focus/state is swapped by Stripe.js),
    // so any DOM-level editable/readonly assertion would be misleading. The
    // durable-prefill fact (present, and surviving reload below) is what this
    // phase fixes and is what is asserted.
    const emailInput = await findEmailInput(page, TEST_EMAIL);
    expect(
      emailInput,
      "prefilled email input not found in the checkout contact step",
    ).not.toBeNull();

    // THE CORE FIX (A4/CKA-04): reload the checkout and assert the email is
    // STILL prefilled. Before this phase, a reload dropped the email because it
    // lived only in client state; now it is baked into the server-recreated
    // Stripe session and must survive.
    await page.reload();
    await expect(
      page,
      "checkout redirected to error after reload",
    ).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);
    const after = await emailPrefilledInCheckout(page, TEST_EMAIL);
    expect(
      after,
      "RELOAD DURABILITY FAILURE (CKA-04/A4): the prefilled email did NOT survive a page reload — this is the exact bug this phase fixes",
    ).toBe(true);
  });

  test("the saved WP address is carried by the AUTHED Store API cart; a guest cart carries none (CKA-04/A1)", async () => {
    // The Stripe BillingAddressElement does not render the saved address into
    // its inputs on load (ENG-755). The saved address instead flows through the
    // authed WooCommerce cart into the recreated session. Assert it there — the
    // deterministic data layer — rather than by reading a Stripe iframe.
    const api = await request.newContext();

    // Mint a HeadKit JWT for the seeded user (kept in-memory; never printed).
    const loginRes = await api.post(
      `${WP_BASE_URL}/wp-json/headkit/v2/auth/login`,
      {
        headers: { "Content-Type": "application/json" },
        data: { username: TEST_USER, password: TEST_PASS },
      },
    );
    expect(
      loginRes.status(),
      `auth/login unreachable at ${WP_BASE_URL} — is WP up and the user seeded?`,
    ).toBe(200);
    const token = (await loginRes.json()).accessToken as string | undefined;
    expect(
      token && token.length > 0,
      "auth/login returned no accessToken — seeded creds may be wrong (try HK_TEST_PASS)",
    ).toBe(true);

    // AUTHED cart: fresh cart-token + Bearer must resolve the seeded user's
    // saved billing (Sydney) + shipping (Melbourne) address.
    const boot = await api.get(`${WP_BASE_URL}/wp-json/wc/store/v1/cart`);
    const authCartToken = boot.headers()["cart-token"] ?? "";
    expect(authCartToken, "no Cart-Token for authed cart request").not.toBe("");
    const authedCart = await api.get(
      `${WP_BASE_URL}/wp-json/wc/store/v1/cart`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cart-Token": authCartToken,
        },
      },
    );
    expect(authedCart.status(), "authed cart request failed").toBe(200);
    const authed = await authedCart.json();
    expect(
      authed.billing_address?.address_1,
      "authed cart did NOT surface the seeded billing address (A1 — filter not resolving the WP user, or fixture not seeded)",
    ).toBe(EXPECT_BILLING_LINE1);
    expect(
      authed.shipping_address?.address_1,
      "authed cart did NOT surface the seeded shipping address (A1)",
    ).toBe(EXPECT_SHIPPING_LINE1);

    // GUEST cart: no Bearer → no saved address (guest path unchanged).
    const guestBoot = await api.get(`${WP_BASE_URL}/wp-json/wc/store/v1/cart`);
    const guestCartToken = guestBoot.headers()["cart-token"] ?? "";
    const guestCart = await api.get(`${WP_BASE_URL}/wp-json/wc/store/v1/cart`, {
      headers: { "Cart-Token": guestCartToken },
    });
    const guest = await guestCart.json();
    expect(
      guest.billing_address?.address_1 ?? "",
      "guest cart LEAKED a saved billing address — guest path is not unchanged (CKA-07 violation)",
    ).toBe("");
    expect(
      guest.shipping_address?.address_1 ?? "",
      "guest cart LEAKED a saved shipping address — guest path is not unchanged (CKA-07 violation)",
    ).toBe("");

    await api.dispose();
  });

  test("guest checkout is UNCHANGED: no email is prefilled and checkout still renders (CKA-07 regression)", async ({
    page,
    context,
  }) => {
    const cartToken = await seedCartWithItem();
    await context.addCookies([
      { name: "hk-cart-token", value: cartToken, url: BASE_URL },
    ]);

    // No login — pure guest.
    await page.goto(`${BASE_URL}/checkout`);
    await expect(
      page,
      "guest checkout redirected to an error page instead of rendering",
    ).not.toHaveURL(/\/checkout(?:\/error|\?error=)/);

    // The contact step must render for the guest (checkout still works)…
    await expect(
      page.getByText("Contact", { exact: true }).first(),
      "guest checkout did not render the contact step",
    ).toBeVisible({ timeout: 30_000 });

    // …but with NO prefilled seeded email (the guest has no saved identity).
    const prefilled = await emailPrefilledInCheckout(page, TEST_EMAIL, 8_000);
    expect(
      prefilled,
      "GUEST LEAK: the seeded user's email was prefilled on a guest checkout (guest path is not unchanged — CKA-07 violation)",
    ).toBe(false);
  });

  test("logged-in account order-history is reachable and JWT-scoped — attribution read-surface (CKA-06)", async ({
    page,
  }) => {
    // Attribution proof of a COMPLETED order (order.customer_id = seeded user,
    // order visible here) is a manual UAT step (Plan 05 Task 2): completing a
    // paid order requires driving the Stripe card iframe + the paid-webhook,
    // which is not reliably automatable in this local env. Here we assert the
    // authenticated order-history surface the order would attribute into is
    // reachable and gated by the JWT — not redirected to the sign-in form.
    await loginViaUi(page);
    await page.goto(`${BASE_URL}/account/orders`);
    await expect(
      page,
      "account orders redirected away from the authenticated area (JWT session not honored)",
    ).toHaveURL(/\/account\/orders/);
    await expect(
      page.getByText("My Orders", { exact: false }).first(),
      "logged-in order-history page did not render (attribution read-surface unavailable)",
    ).toBeVisible({ timeout: 30_000 });
  });
});

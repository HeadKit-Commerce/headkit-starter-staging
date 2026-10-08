import { expect, request } from "@playwright/test";
import type {
  APIRequestContext,
  BrowserContext,
  Frame,
  Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared e2e helpers for the HeadKit starter storefront specs.
 *
 * Extracted from `checkout-auth.spec.ts` / `gift-card.spec.ts` (autonomous QA
 * run) so the paid-checkout suite (`checkout-purchase`, `checkout-attribution`,
 * `checkout-pickup`, `cart-ops`, `coupon`, …) reuses one proven copy instead of
 * per-spec forks.
 *
 * LOCAL-ONLY (HARD RULE): every endpoint here is a localhost Docker service
 * (starter, WP/WooCommerce :8090, gateway :4000, commerce :8080). Stripe is
 * TEST MODE only. No staging/prod host may ever appear.
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const WP_BASE_URL = process.env.WP_BASE_URL ?? "http://localhost:8090";
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? "http://localhost:4000/graphql";
export const STORE_KEY = process.env.E2E_STORE_KEY ?? "pk_local";
export const STORE_API = `${WP_BASE_URL}/wp-json/wc/store/v1`;

/** A purchasable simple product in the local seed (Test Product 12 = $22). */
export const REGULAR_PRODUCT_ID = Number(
  process.env.E2E_CHECKOUT_PRODUCT_ID ?? "678",
);

// Seeded auth fixture (docker/wordpress/seed-auth-user.php). Password is
// env-overridable so specs work against a freshly-seeded stack (seed default)
// or a running stack with a rotated password.
export const TEST_EMAIL =
  process.env.HK_TEST_EMAIL ?? "hk-checkout-test@example.com";
export const TEST_USER = process.env.HK_TEST_USER ?? "hk-checkout-test";
export const TEST_PASS = process.env.HK_TEST_PASS ?? "HkCheckout!2026";

/**
 * ALL Stripe TEST secret keys (sk_test_…) discoverable in the environment and
 * the local commerce service's .env files (worktree first, then the main
 * checkout — the commerce process actually RUNNING on :8080 may have been
 * started from either). Different files can carry keys for DIFFERENT test
 * accounts; a Checkout Session is only readable by the account that created
 * it, so callers should try each key (see `stripeSessionAnyKey`).
 * Returns [] when none found so charge assertions can self-skip.
 * LOCAL/TEST ONLY — never a live key; never printed.
 */
export function stripeTestKeys(): string[] {
  const keys: string[] = [];
  const fromEnv = process.env.STRIPE_SECRET_KEY;
  if (fromEnv && fromEnv.startsWith("sk_test_")) keys.push(fromEnv);
  const candidates = [
    resolve(process.cwd(), "../../services/commerce/.env.development.local"),
    resolve(process.cwd(), "../../services/commerce/.env"),
    resolve(process.cwd(), "services/commerce/.env.development.local"),
    resolve(process.cwd(), "services/commerce/.env"),
    // Worktree checkouts may not carry a commerce .env — fall back to the main
    // checkout's files (the commerce service actually RUNNING on :8080).
    resolve(
      process.cwd(),
      "../../../../services/commerce/.env.development.local",
    ),
    resolve(process.cwd(), "../../../../services/commerce/.env"),
  ];
  for (const path of candidates) {
    try {
      const txt = readFileSync(path, "utf8");
      const m = txt.match(/^STRIPE_SECRET_KEY=(sk_test_\S+)\s*$/m);
      if (m && !keys.includes(m[1]!)) keys.push(m[1]!);
    } catch {
      // try next candidate
    }
  }
  return keys;
}

/** First discoverable Stripe TEST key (legacy single-key convenience). */
export function stripeTestKey(): string | null {
  return stripeTestKeys()[0] ?? null;
}

/**
 * Probe the local stack (WP Store API + starter + gateway). Returns true only
 * when all respond, so a describe can self-skip on a cold machine instead of
 * failing the default unit run. Never throws.
 */
export async function stackIsUp(): Promise<boolean> {
  try {
    const api = await request.newContext();
    const wp = await api.get(`${STORE_API}/cart`);
    const app = await api.get(BASE_URL);
    let gw = false;
    try {
      const g = await api.post(GATEWAY_URL, {
        headers: {
          "content-type": "application/json",
          "x-headkit-key": STORE_KEY,
        },
        data: { query: "query{__typename}" },
      });
      gw = g.ok();
    } catch {
      gw = false;
    }
    await api.dispose();
    return wp.ok() && app.ok() && gw;
  } catch {
    return false;
  }
}

/** Bootstrap a fresh WooCommerce cart and return its Cart-Token. */
export async function bootstrapCart(api: APIRequestContext): Promise<string> {
  const boot = await api.get(`${STORE_API}/cart`);
  expect(
    boot.status(),
    `WooCommerce Store API unreachable at ${WP_BASE_URL} — is the local WP stack up?`,
  ).toBe(200);
  const cartToken = boot.headers()["cart-token"] ?? "";
  expect(cartToken, "Store API did not return a Cart-Token header").not.toBe(
    "",
  );
  return cartToken;
}

/** Add a product to a cart via the Store API (defaults to the seeded simple product). */
export async function addItem(
  api: APIRequestContext,
  cartToken: string,
  quantity = 1,
  productId = REGULAR_PRODUCT_ID,
): Promise<void> {
  const add = await api.post(`${STORE_API}/cart/add-item`, {
    headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
    data: { id: productId, quantity },
  });
  expect(
    [200, 201],
    `add-item failed for product ${productId} x${quantity} (HTTP ${add.status()})`,
  ).toContain(add.status());
  const body = await add.json();
  expect(
    body.items_count,
    `cart is empty after add-item (product ${productId})`,
  ).toBeGreaterThan(0);
}

/**
 * Seed a fresh cart with `quantity` of the regular product and return its
 * Cart-Token (also usable as the storefront `hk-cart-token` cookie).
 */
export async function seedRegularCart(
  api: APIRequestContext,
  quantity = 1,
): Promise<string> {
  const cartToken = await bootstrapCart(api);
  await addItem(api, cartToken, quantity);
  return cartToken;
}

/** Read the full Store API cart for a token. */
export async function getStoreCart(
  api: APIRequestContext,
  cartToken: string,
): Promise<Record<string, unknown> & { totals: { total_price: string } }> {
  const res = await api.get(`${STORE_API}/cart`, {
    headers: { "Cart-Token": cartToken },
  });
  expect(res.status(), "Store API cart read failed").toBe(200);
  return res.json();
}

/** Authoritative payable total (minor units) straight from the Store API cart. */
export async function cartTotalMinor(
  api: APIRequestContext,
  cartToken: string,
): Promise<number> {
  const cart = await getStoreCart(api, cartToken);
  return Number(cart.totals.total_price);
}

/**
 * The same payable in MAJOR units, using the cart's own `currency_minor_unit`
 * exponent (2 for AUD cents, 0 for a no-decimals store) rather than assuming
 * cents — see the money-scale rules in AGENTS.md.
 */
export async function cartTotalMajor(
  api: APIRequestContext,
  cartToken: string,
): Promise<number> {
  const cart = (await getStoreCart(api, cartToken)) as {
    totals: { total_price: string; currency_minor_unit?: number };
  };
  const minorUnit = Number(cart.totals.currency_minor_unit ?? 2);
  return Number(cart.totals.total_price) / 10 ** minorUnit;
}

/** Drop a Store API cart token into the storefront `hk-cart-token` cookie. */
export async function installCartCookie(
  context: BrowserContext,
  cartToken: string,
): Promise<void> {
  await context.addCookies([
    { name: "hk-cart-token", value: cartToken, url: BASE_URL },
  ]);
}

/**
 * Log in through the REAL storefront sign-in form (/account). On success the
 * app sets the `hk-auth-token` cookie and routes to /account/profile.
 */
export async function loginViaUi(page: Page): Promise<void> {
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

/** Mint a HeadKit JWT for the seeded user via the WP REST login (kept in-memory; never printed). */
export async function mintAuthToken(api: APIRequestContext): Promise<string> {
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
  return token!;
}

/** Create a Stripe Checkout Session for a cart via commerce (gateway). Returns the session id. */
export async function createCheckoutSession(
  api: APIRequestContext,
  cartToken: string,
): Promise<string> {
  const res = await api.post(GATEWAY_URL, {
    headers: {
      "content-type": "application/json",
      "x-headkit-key": STORE_KEY,
      "x-cart-token": cartToken,
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
  expect(result.testMode, "Stripe must be in TEST mode (LOCAL-ONLY)").toBe(
    true,
  );
  expect(result.sessionId).toMatch(/^cs_test_/);
  return result.sessionId as string;
}

/** The decoded Stripe Checkout Session fields the specs assert on. */
export interface StripeSessionRead {
  amountTotal: number;
  livemode: boolean;
  paymentStatus: string;
  status: string;
  customer: string | null;
  customerEmail: string | null;
  shipping: {
    line1?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
    country?: string | undefined;
  } | null;
  metadata: Record<string, string>;
}

/**
 * The store's Stripe Connect account id (direct-charge mode) — discovered once
 * per run by creating a throwaway checkout session via the gateway (the
 * mutation returns `stripeAccountId`; empty string = platform mode). Cached.
 * Override with E2E_STRIPE_ACCOUNT.
 */
let cachedStripeAccountId: string | null | undefined;
export async function stripeConnectAccountId(
  api: APIRequestContext,
): Promise<string | null> {
  if (cachedStripeAccountId !== undefined) return cachedStripeAccountId;
  const fromEnv = process.env.E2E_STRIPE_ACCOUNT;
  if (fromEnv) {
    cachedStripeAccountId = fromEnv;
    return fromEnv;
  }
  try {
    const cartToken = await seedRegularCart(api, 1);
    const res = await api.post(GATEWAY_URL, {
      headers: {
        "content-type": "application/json",
        "x-headkit-key": STORE_KEY,
        "x-cart-token": cartToken,
      },
      data: {
        query:
          "mutation($i:CreateCheckoutSessionInput!){commerce{createCheckoutSession(input:$i){sessionId stripeAccountId testMode}}}",
        variables: {
          i: {
            returnUrl: `${BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          },
        },
      },
    });
    const json = await res.json();
    const result = json.data?.commerce?.createCheckoutSession;
    cachedStripeAccountId =
      result?.testMode && result?.stripeAccountId
        ? (result.stripeAccountId as string)
        : null;
  } catch {
    cachedStripeAccountId = null;
  }
  return cachedStripeAccountId;
}

/**
 * Read a Checkout Session trying EVERY discoverable TEST key — the local env
 * can carry keys for more than one Stripe test account, and only the account
 * that created the session (the one the running commerce uses) can read it.
 * In Connect DIRECT-CHARGE mode the session lives on the CONNECTED account,
 * so each key is also retried with the `Stripe-Account` header (platform key +
 * connected account is the documented read path). Fails loudly when keys
 * exist but none can read the session.
 */
export async function stripeSessionAnyKey(
  api: APIRequestContext,
  sessionId: string,
): Promise<StripeSessionRead> {
  const keys = stripeTestKeys();
  expect(
    keys.length,
    "no Stripe TEST key (sk_test_) discoverable — cannot read the session",
  ).toBeGreaterThan(0);
  const connectAccount = await stripeConnectAccountId(api);
  let lastErr: unknown = null;
  const accountVariants: (string | null)[] = [
    null,
    ...(connectAccount ? [connectAccount] : []),
  ];
  for (const sk of keys) {
    for (const acct of accountVariants) {
      const res = await api.get(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
        {
          headers: {
            Authorization: `Bearer ${sk}`,
            ...(acct ? { "Stripe-Account": acct } : {}),
          },
        },
      );
      const json = await res.json();
      if (!json.error) return decodeStripeSession(json);
      lastErr = json.error;
    }
  }
  throw new Error(
    `No discoverable Stripe TEST key can read ${sessionId} (tried with and without Stripe-Account${connectAccount ? ` ${connectAccount}` : ""}) — the running commerce uses a different test account. Last error: ${JSON.stringify(lastErr)}`,
  );
}

function decodeStripeSession(json: {
  amount_total?: unknown;
  livemode?: unknown;
  payment_status?: unknown;
  status?: unknown;
  customer?: unknown;
  customer_details?: { email?: unknown } | null;
  customer_email?: unknown;
  collected_information?: {
    shipping_details?: { address?: Record<string, string | null> } | null;
  } | null;
  shipping_details?: { address?: Record<string, string | null> } | null;
  metadata?: Record<string, string> | null;
}): StripeSessionRead {
  const shippingDetails =
    json.collected_information?.shipping_details ?? json.shipping_details;
  return {
    amountTotal: Number(json.amount_total),
    livemode: Boolean(json.livemode),
    paymentStatus: String(json.payment_status ?? ""),
    status: String(json.status ?? ""),
    customer: (json.customer as string | null) ?? null,
    customerEmail:
      (json.customer_details?.email as string | null) ??
      (json.customer_email as string | null) ??
      null,
    shipping: shippingDetails?.address
      ? {
          line1: shippingDetails.address.line1 ?? undefined,
          city: shippingDetails.address.city ?? undefined,
          state: shippingDetails.address.state ?? undefined,
          postalCode: shippingDetails.address.postal_code ?? undefined,
          country: shippingDetails.address.country ?? undefined,
        }
      : null,
    metadata: (json.metadata ?? {}) as Record<string, string>,
  };
}

/** Read the full Checkout Session from the Stripe TEST API with a specific key. */
export async function stripeSession(
  api: APIRequestContext,
  sk: string,
  sessionId: string,
): Promise<StripeSessionRead> {
  const res = await api.get(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    { headers: { Authorization: `Bearer ${sk}` } },
  );
  const json = await res.json();
  expect(
    json.error,
    `Stripe session read errored: ${JSON.stringify(json.error)}`,
  ).toBeFalsy();
  return decodeStripeSession(json);
}

/**
 * Read a WooCommerce order's status straight from WP via wp-cli in the local
 * Docker container (authoritative; read-only).
 *
 * WHY NOT the gateway `storeOrder(id,key)` read: on this local stack that
 * resolver's order fetch 401s for PAID orders (`woocommerce_rest_cannot_view`
 * — wc/v3 basic auth over plain HTTP / pay-for-order semantics), so it cannot
 * verify a completed payment. wp-cli is deterministic. Returns null when the
 * container/wp-cli is unavailable so callers can annotate-and-skip instead of
 * false-failing.
 */
export function wpOrderStatus(orderId: string): string | null {
  const container = process.env.E2E_WP_CONTAINER ?? "docker-wordpress-1";
  try {
    const out = execFileSync(
      "docker",
      [
        "exec",
        container,
        "wp",
        "wc",
        "shop_order",
        "get",
        orderId,
        "--user=1",
        "--field=status",
        "--allow-root",
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    const lines = out.trim().split("\n");
    const status = (lines[lines.length - 1] ?? "").trim();
    return status || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stripe iframe driving (the previously-manual gap this suite closes)
// ---------------------------------------------------------------------------

/** True when `url` is a Stripe.js iframe (hostname check, not substring match). */
function isStripeJsFrameURL(url: string): boolean {
  try {
    return new URL(url).hostname === "js.stripe.com";
  } catch {
    return false;
  }
}

/**
 * Find the js.stripe.com iframe that contains `selector` (polling until
 * `timeoutMs`). Stripe mounts each element (contact email, shipping address,
 * payment) in its own cross-origin frame; matching on content is more robust
 * than frame names, which are minted per mount (__privateStripeFrameNNNN).
 */
export async function stripeFrameWith(
  page: Page,
  selector: string,
  timeoutMs = 30_000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!isStripeJsFrameURL(frame.url())) continue;
      const n = await frame
        .locator(selector)
        .count()
        .catch(() => 0);
      if (n > 0) return frame;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(
    `No js.stripe.com frame containing "${selector}" appeared within ${timeoutMs}ms — Stripe element not mounted?`,
  );
}

/** Values for the Stripe ShippingAddressElement (AU defaults). */
export interface ShippingAddressFixture {
  name: string;
  line1: string;
  city: string;
  /** ISO state code option value in Stripe's select (e.g. "NSW"). */
  state: string;
  postcode: string;
  /** ISO country option value (e.g. "AU"). */
  country: string;
  /** AU-local phone for Stripe ShippingAddressElement (`input[name="phone"]`). */
  phone: string;
}

export const AU_SHIPPING: ShippingAddressFixture = {
  name: "E2E Shopper",
  line1: "123 Example Street",
  city: "Sydney",
  state: "NSW",
  postcode: "2000",
  country: "AU",
  phone: "0412345678",
};

/**
 * Wait until session recreate remount finishes (Stripe provider reload).
 * Remount paints the form skeleton while Stripe.js resolves — no copy.
 */
export async function waitForCheckoutRemount(page: Page): Promise<void> {
  const skeleton = page.getByTestId("checkout-form-skeleton");
  if (await skeleton.isVisible().catch(() => false)) {
    await expect(
      skeleton,
      "Checkout remount skeleton did not disappear after session recreate",
    ).toBeHidden({ timeout: 45_000 });
  }
}

/**
 * Wait until the Delivery accordion is active after contact submit.
 * handleContactNext advances immediately after contact mutations settle.
 */
export async function waitForDeliveryStep(page: Page): Promise<void> {
  await waitForCheckoutRemount(page);
  await expect(
    page.getByRole("button", { name: /^continue$/i }),
    "Delivery step did not render after contact",
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page
      .getByText(/Ship to Home|Free Click & Collect|Select your store/i)
      .first(),
    "Delivery step content did not render after contact",
  ).toBeVisible({ timeout: 30_000 });
}

/** Wait for Stripe ShippingAddressElement to mount after delivery step opens. */
export async function waitForStripeShippingAddress(
  page: Page,
  timeoutMs = 45_000,
): Promise<Frame> {
  return stripeFrameWith(page, 'input[name="addressLine1"]', timeoutMs);
}

/**
 * Step 1 — Contact: fill the email into the Stripe ContactDetailsElement
 * (input[name="email"] inside the elements-inner-authentication frame) and
 * advance with "Continue to Delivery".
 */
export async function fillContactStep(
  page: Page,
  email: string,
): Promise<void> {
  const frame = await stripeFrameWith(page, 'input[name="email"]');
  const input = frame.locator('input[name="email"]');
  await input.fill(email);
  await input.blur();
  const cont = page.getByRole("button", { name: /continue to delivery/i });
  await expect(
    cont,
    "Continue to Delivery never enabled after filling the Stripe contact email",
  ).toBeEnabled({ timeout: 20_000 });
  await cont.click();
  await waitForDeliveryStep(page);
}

/** Fill phone for ship-to-home (Stripe iframe if present, else PhoneInput). */
async function fillStripeShippingPhone(
  page: Page,
  frame: Frame,
  phone: string,
): Promise<void> {
  const stripePhone = frame.locator('input[name="phone"]');
  if ((await stripePhone.count()) > 0) {
    await stripePhone.fill(phone);
    return;
  }
  // Checkout Session ShippingAddressElement has no phone field — use PhoneInput.
  await page.getByPlaceholder("Enter phone number").fill(phone);
}

/**
 * Step 2 — Delivery (Ship to Home): fill the Stripe ShippingAddressElement
 * then PhoneInput, then advance with "Continue". Assumes Ship to Home is the
 * active delivery method (it is the default).
 */
export async function fillShipToHomeStep(
  page: Page,
  addr: ShippingAddressFixture = AU_SHIPPING,
): Promise<void> {
  const frame = await waitForStripeShippingAddress(page);
  await frame.locator('input[name="name"]').fill(addr.name);
  await frame.locator('select[name="country"]').selectOption(addr.country);
  await frame.locator('input[name="addressLine1"]').fill(addr.line1);
  // Dismiss the Stripe address autocomplete dropdown if it opened.
  await page.waitForTimeout(500);
  await frame
    .locator('input[name="addressLine1"]')
    .press("Escape")
    .catch(() => {});
  await frame.locator('input[name="locality"]').fill(addr.city);
  await frame.locator('input[name="postalCode"]').fill(addr.postcode);
  await frame
    .locator('select[name="administrativeArea"]')
    .selectOption(addr.state);
  await fillStripeShippingPhone(page, frame, addr.phone);
  const cont = page.getByRole("button", { name: /^continue$/i });
  await expect(
    cont,
    "Delivery Continue never enabled after filling the shipping address",
  ).toBeEnabled({ timeout: 20_000 });
  await cont.click();
}

/**
 * Step 3 — Shipping Options: wait for the rates list, optionally select the
 * rate whose label matches `rateName` (defaults to keeping the pre-selected /
 * first rate), then advance with "Continue to Payment".
 */
export async function fillShippingOptionsStep(
  page: Page,
  rateName?: RegExp,
): Promise<void> {
  const cont = page.getByRole("button", { name: /continue to payment/i });
  await expect(
    cont,
    "Shipping Options step did not render (no Continue to Payment button)",
  ).toBeVisible({ timeout: 30_000 });
  if (rateName) {
    await page.locator("label", { hasText: rateName }).first().click();
  } else {
    // Ensure SOME rate is selected (first radio) — selection also syncs Stripe.
    const radios = page.locator('[role="radiogroup"] [role="radio"]');
    if ((await radios.count()) > 0) {
      const checked = await page
        .locator('[role="radiogroup"] [role="radio"][data-checked]')
        .count();
      if (checked === 0) await radios.first().click();
    }
  }
  await expect(cont).toBeEnabled({ timeout: 30_000 });
  await cont.click();
}

/** Stripe's native "billing same as shipping" sync checkbox (Payment step). */
export const BILLING_SAME_AS_SHIPPING =
  /billing.*same.*shipping|same.*shipping.*billing/i;

/**
 * Assert Stripe rendered the native billing-same-as-shipping control on the
 * Payment step (inside a js.stripe.com iframe when syncAddressCheckbox=billing).
 */
export async function expectBillingSameAsShippingControl(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!isStripeJsFrameURL(frame.url())) continue;
      const checkbox = frame.getByRole("checkbox", {
        name: BILLING_SAME_AS_SHIPPING,
      });
      if (
        (await checkbox.count()) > 0 &&
        (await checkbox
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return;
      }
      const label = frame.getByText(BILLING_SAME_AS_SHIPPING);
      if (
        (await label.count()) > 0 &&
        (await label
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error(
    `Stripe billing-same-as-shipping control not found within ${timeoutMs}ms`,
  );
}

/** Stripe TEST cards. */
export const CARD_OK = "4242424242424242";
export const CARD_DECLINED = "4000000000000002";

/**
 * Step 4 — Payment: fill the card into the Stripe PaymentElement
 * (input[name="number"|"expiry"|"cvc"] inside the payment frame).
 * Does NOT click Pay — callers assert pre-conditions first.
 */
export async function fillCard(
  page: Page,
  cardNumber = CARD_OK,
): Promise<void> {
  const frame = await stripeFrameWith(page, 'input[name="number"]', 45_000);
  await frame.locator('input[name="number"]').fill(cardNumber);
  await frame.locator('input[name="expiry"]').fill("12/30");
  await frame.locator('input[name="cvc"]').fill("123");
}

/**
 * Accessible name of the Payment step's confirm button.
 *
 * The button renders `Pay {amount}` — Stripe's own PRE-FORMATTED localised
 * display string, e.g. `Pay A$430.00` — and falls back to the bare `Pay Now`
 * only when Stripe hands back an EMPTY amount string
 * (`components/checkout/steps/stripe-checkout-step.tsx`).
 *
 * Deliberately NOT `/pay/i`: that would also match unrelated buttons, and it
 * would let a silent regression back to a bare `Pay Now` on a normal cart pass.
 * The amount branch therefore requires a digit, and allows a currency prefix
 * and/or suffix around it (`A$430.00`, `US$1,430.00`, `430,00 €`).
 */
export const PAY_BUTTON_NAME = /^Pay (?:Now|\S*\d[\d.,\s]*\S*)$/;

/** The Payment step's confirm button. */
export function payButton(page: Page) {
  return page.getByRole("button", { name: PAY_BUTTON_NAME });
}

/**
 * The numeric amount carried by the Pay button's accessible name, in MAJOR
 * units, or `null` when the button renders the bare `Pay Now` fallback.
 *
 * Format-tolerant on purpose: currency symbols/codes are dropped, and the
 * decimal separator is whichever `.` or `,` is followed by exactly two trailing
 * digits (so both `A$1,430.00` and `1.430,00 €` parse to 1430.00). Compare the
 * RESULT numerically — never assert on the formatted string, which is Stripe's
 * to choose.
 */
export async function payButtonAmountMajor(page: Page): Promise<number | null> {
  const name = (await payButton(page).textContent())?.trim() ?? "";
  const body = name.replace(/^Pay\s+/i, "");
  if (/^now$/i.test(body)) return null;
  return parseMoneyMajor(body);
}

/**
 * Parse a formatted money string into MAJOR units, or `null` when it carries no
 * parseable figure.
 *
 * Format-tolerant on purpose: currency symbols/codes are dropped, and the
 * decimal separator is whichever `.` or `,` is followed by exactly two trailing
 * digits (so both `A$1,430.00` and `1.430,00 €` parse to 1430.00). Compare the
 * RESULT numerically — never assert on the formatted string, which is the
 * renderer's (Stripe's, or `formatPrice`'s) to choose.
 */
export function parseMoneyMajor(text: string): number | null {
  const numeric = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) return null;
  const decimal = /[.,](\d{2})$/.exec(numeric);
  const whole = decimal
    ? numeric.slice(0, numeric.length - 3).replace(/[.,]/g, "")
    : numeric.replace(/[.,]/g, "");
  const parsed = Number(`${whole}.${decimal?.[1] ?? "00"}`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * HeadKit's OWN order-summary `Total` row, in MAJOR units.
 *
 * This is the storefront's rendered total — `formatPrice(totalForDisplay,
 * currency)` in `components/checkout/cart.tsx`, where `currency` is the CART's
 * currency. It is never Stripe's presentment currency, so it is directly
 * comparable to {@link cartTotalMajor}. (The Pay button is not: Stripe Adaptive
 * Pricing may render it in the shopper's local currency, which makes a numeric
 * comparison against the Woo payable false by construction — see
 * `260827-diagnose-pay-button-vs-cart-payable`.)
 *
 * The summary is `hidden md:block` on the checkout page, so this needs a
 * desktop-width viewport (the suite's default).
 */
export async function orderSummaryTotalMajor(
  page: Page,
): Promise<number | null> {
  const label = page.locator("p", { hasText: /^Total$/ }).last();
  const row = label.locator(
    "xpath=ancestor::div[contains(@class,'justify-between')][1]",
  );
  await expect(
    row,
    "order-summary Total row never rendered on the checkout page",
  ).toBeVisible({ timeout: 30_000 });
  const value = (await row.locator("p").last().textContent())?.trim() ?? "";
  return parseMoneyMajor(value);
}

/** Click Pay Now and wait for the Stripe redirect to the bare success route. */
export async function payAndAwaitSuccess(page: Page): Promise<string> {
  await payButton(page).click();
  await page.waitForURL(/\/checkout\/success\?session_id=/, {
    timeout: 90_000,
  });
  const url = new URL(page.url());
  const sessionId = url.searchParams.get("session_id") ?? "";
  expect(sessionId, "success return carried no session_id").toMatch(
    /^cs_test_/,
  );
  return sessionId;
}

/**
 * After the bare success route processes the order it redirects to
 * `/checkout/success/{orderId}?key=…`. Returns the resolved orderId + key.
 */
export async function awaitOrderConfirmation(
  page: Page,
): Promise<{ orderId: string; orderKey: string }> {
  await page.waitForURL(/\/checkout\/success\/\d+\?/, { timeout: 90_000 });
  const url = new URL(page.url());
  const orderId = url.pathname.split("/").pop() ?? "";
  const orderKey = url.searchParams.get("key") ?? "";
  expect(Number(orderId), "orderId in the confirmation URL").toBeGreaterThan(0);
  expect(orderKey, "order key in the confirmation URL").toMatch(/^wc_order_/);
  return { orderId, orderKey };
}

/**
 * The taxed fixture seeded by `docker/wordpress/seed-tax.php` — one product on
 * its own 10% GST tax class.
 *
 * Shared by `tax-inclusive-display.spec.ts` and `tax-inclusive-checkout.spec.ts`
 * (split so the Stripe-dependent half can be dropped from a keyless CI run
 * without taking the drawer coverage with it).
 */
export const TAXED_SLUG =
  process.env.E2E_TAXED_PRODUCT_SLUG ?? "taxed-test-product";

/** The money figures one Store API cart line carries, in major units. */
export interface TaxedLine {
  productId: number;
  /** `totals.line_subtotal`, tax-EXCLUSIVE. */
  exTax: number;
  /** `totals.line_subtotal_tax`. */
  tax: number;
  /** What a shopper must be shown: `exTax + tax`. */
  incTax: number;
  /** `cart.totals.total_items` + `total_items_tax`. */
  cartIncTax: number;
  minorUnit: number;
}

/** Format a major-unit figure the way the storefront's `formatPrice` does. */
export function money(value: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Resolve the taxed fixture's product id, failing loudly if the seed is missing. */
export async function taxedProductId(api: APIRequestContext): Promise<number> {
  const url = `${WP_BASE_URL}/wp-json/headkit/v2/products/slug/${TAXED_SLUG}`;
  const res = await api.get(url);
  expect(
    res.ok(),
    `the taxed fixture "${TAXED_SLUG}" is not in the local catalogue (HTTP ${res.status()} from ${url}). ` +
      `This is a SEED REGRESSION, not a reason to skip: re-run docker/wordpress/seed-tax.php ` +
      `(scripts/e2e-ci-stack.sh runs it as part of "up").`,
  ).toBe(true);
  const body = await res.json();
  const id = Number(body?.id ?? body?.data?.id);
  expect(id, `no product id in the response for ${TAXED_SLUG}`).toBeGreaterThan(
    0,
  );
  return id;
}

/** Put the taxed fixture in a fresh cart and read back what WooCommerce charges. */
export async function seedTaxedCart(
  api: APIRequestContext,
): Promise<{ cartToken: string; line: TaxedLine }> {
  const productId = await taxedProductId(api);
  const cartToken = await bootstrapCart(api);
  const add = await api.post(`${STORE_API}/cart/add-item`, {
    headers: { "Content-Type": "application/json", "Cart-Token": cartToken },
    data: { id: productId, quantity: 1 },
  });
  expect(
    [200, 201],
    `add-item failed for the taxed fixture ${productId} (HTTP ${add.status()})`,
  ).toContain(add.status());
  const cart = await add.json();

  const item = (cart.items ?? []).find(
    (i: { id: number }) => Number(i.id) === productId,
  );
  expect(
    item,
    `the taxed fixture is not in the cart after add-item`,
  ).toBeTruthy();

  // Store API money is in MINOR units scaled by the store's own decimals
  // setting; `currency_minor_unit` is the exponent (2 for AUD cents, 0 for a
  // no-decimals store). Divide by it rather than assuming cents — a
  // `minor_unit: 0` store is exactly the shape the original defect was
  // reported on.
  const minorUnit = Number(cart.totals?.currency_minor_unit ?? 2);
  const scale = 10 ** minorUnit;
  const exTax = Number(item.totals.line_subtotal) / scale;
  const tax = Number(item.totals.line_subtotal_tax) / scale;
  const cartIncTax =
    (Number(cart.totals.total_items) + Number(cart.totals.total_items_tax)) /
    scale;

  return {
    cartToken,
    line: { productId, exTax, tax, incTax: exTax + tax, cartIncTax, minorUnit },
  };
}

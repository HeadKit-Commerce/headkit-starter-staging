import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  GATEWAY_URL,
  STORE_API,
  STORE_KEY,
  WP_BASE_URL,
  bootstrapCart,
  stripeConnectAccountId,
  stripeTestKey,
} from "./helpers";

/**
 * Shared seams for the checkout stock-hold specs (checkout plan v3):
 * `stock-hold-api.spec.ts` (no browser) and `stock-hold-ui.spec.ts`.
 *
 * LOCAL-ONLY (HARD RULE): WordPress is reached through `docker exec` into the
 * e2e container and over :8090, commerce over :8080 and the gateway over :4000.
 * Stripe is TEST mode only, and every Stripe call here refuses a key that is
 * not `sk_test_`.
 *
 * The fixtures are `docker/wordpress/seed-stock-hold.php`. Every test resets
 * the stock of the products it touches and deletes their reservation rows
 * first ({@link resetHoldProducts}), so no test inherits a hold, a sale or a
 * short line from another.
 */

/** The fixture slugs (seed-stock-hold.php). */
export const HOLD = {
  lastUnit: "hold-last-unit",
  plenty: "hold-plenty",
  three: "hold-three",
  backorder: "hold-backorder",
} as const;

/** The stock each fixture is reset to unless a test asks otherwise. */
export const HOLD_STOCK: Record<string, number> = {
  [HOLD.lastUnit]: 1,
  [HOLD.plenty]: 50,
  [HOLD.three]: 3,
  [HOLD.backorder]: 0,
};

/**
 * The e2e store's HeadKit API token (scripts/e2e-ci-stack.sh THEME_TOKEN): the
 * key WordPress verifies commerce's checkout and hold signatures with, and the
 * Bearer credential of commerce's /woocommerce/refund. A throwaway LOCAL-ONLY
 * value, like the store's public key.
 */
export const THEME_TOKEN = process.env.E2E_THEME_TOKEN ?? "hk_e2e_theme_token";

export const COMMERCE_URL =
  process.env.E2E_COMMERCE_URL ?? "http://localhost:8080";

const WP_CONTAINER = process.env.E2E_WP_CONTAINER ?? "headkit-e2e-wordpress";

/** The shopper address every API finalize sends (AU, so a rate applies). */
export const AU_ADDRESS = {
  firstName: "Hold",
  lastName: "Tester",
  address1: "123 George Street",
  address2: "",
  city: "Sydney",
  state: "NSW",
  postcode: "2000",
  country: "AU",
} as const;

// ── WordPress ────────────────────────────────────────────────────────────

/**
 * Run PHP inside WordPress and return what it echoes, trimmed. The last line
 * only: WordPress prints PHP deprecation notices from the theme ahead of it.
 */
export function wpEval(php: string): string {
  const out = execFileSync(
    "docker",
    ["exec", WP_CONTAINER, "wp", "eval", php, "--allow-root"],
    { encoding: "utf8", timeout: 60_000 },
  );
  const lines = out.trim().split("\n");
  return (lines[lines.length - 1] ?? "").trim();
}

/** `wpEval` for PHP that echoes `wp_json_encode(...)`. */
export function wpJson<T>(php: string): T {
  const raw = wpEval(php);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`WordPress did not answer JSON: ${raw.slice(0, 300)}`);
  }
}

/** A fixture's product id. */
export function productId(slug: string): number {
  const id = Number(
    wpEval(
      `$p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product'); echo $p ? $p->ID : 0;`,
    ),
  );
  expect(
    id,
    `fixture ${slug} missing — did seed-stock-hold run?`,
  ).toBeGreaterThan(0);
  return id;
}

/**
 * Put fixtures back to a known stock and drop EVERY reservation row on them,
 * whoever placed it. `stock` overrides {@link HOLD_STOCK} per slug.
 */
export function resetHoldProducts(
  slugs: readonly string[],
  stock: Record<string, number> = {},
): void {
  for (const slug of slugs) {
    const qty = stock[slug] ?? HOLD_STOCK[slug] ?? 0;
    wpEval(`
      global $wpdb;
      $p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product');
      $product = wc_get_product($p->ID);
      $product->set_stock_quantity(${qty});
      $product->set_stock_status(${qty} > 0 || $product->backorders_allowed() ? 'instock' : 'outofstock');
      $product->save();
      $wpdb->delete($wpdb->prefix . 'wc_reserved_stock', ['product_id' => $p->ID]);
      echo 'ok';
    `);
  }
}

/** A product's stock as WooCommerce stores it. */
export function stockOf(slug: string): number {
  return Number(
    wpEval(
      `$p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product'); echo (int) wc_get_product($p->ID)->get_stock_quantity();`,
    ),
  );
}

/** Set a product's stock directly (another sale, a POS sync, a stocktake). */
export function setStock(slug: string, qty: number): void {
  wpEval(`
    $p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product');
    $product = wc_get_product($p->ID);
    $product->set_stock_quantity(${qty});
    $product->set_stock_status(${qty} > 0 || $product->backorders_allowed() ? 'instock' : 'outofstock');
    $product->save();
    echo 'ok';
  `);
}

/** Set a product's regular (and active) price. */
export function setPrice(slug: string, price: string): void {
  wpEval(`
    $p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product');
    $product = wc_get_product($p->ID);
    $product->set_regular_price(${JSON.stringify(price)});
    $product->save();
    echo 'ok';
  `);
}

export interface ReservedRow {
  order_id: number;
  product_id: number;
  stock_quantity: number;
  /** Seconds until the row expires (negative once lapsed). */
  ttl: number;
}

/** The live (unexpired) wc_reserved_stock rows for a product. */
export function reservedRows(slug: string): ReservedRow[] {
  return wpJson<ReservedRow[]>(`
    global $wpdb;
    $p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product');
    $rows = $wpdb->get_results($wpdb->prepare(
      "SELECT order_id, product_id, stock_quantity, TIMESTAMPDIFF(SECOND, NOW(), expires) AS ttl
         FROM {$wpdb->prefix}wc_reserved_stock WHERE product_id = %d AND expires > NOW()", $p->ID), ARRAY_A);
    echo wp_json_encode(array_map(fn($r) => array_map('intval', $r), $rows));
  `);
}

/**
 * Make every live hold on a product lapse NOW, as if its minutes had run out.
 * WooCommerce reads a row as live only while `expires > NOW()`, which is all
 * a real lapse changes; the spec does not wait out the store's minutes.
 */
export function lapseHolds(slug: string): void {
  wpEval(`
    global $wpdb;
    $p = get_page_by_path(${JSON.stringify(slug)}, OBJECT, 'product');
    $wpdb->query($wpdb->prepare(
      "UPDATE {$wpdb->prefix}wc_reserved_stock SET expires = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE product_id = %d", $p->ID));
    echo 'ok';
  `);
}

export interface WooOrderRead {
  id: number;
  status: string;
  total: string;
  signature: string;
  holdOrderId: string;
  notes: string[];
  refunds: { amount: string; reason: string }[];
  lineQty: Record<string, number>;
  transactionId: string;
}

/** What the specs assert about one WooCommerce order. */
export function wooOrder(orderId: number | string): WooOrderRead {
  return wpJson<WooOrderRead>(`
    $o = wc_get_order(${Number(orderId)});
    if (!$o) { echo wp_json_encode(null); return; }
    $notes = array_map(fn($n) => $n->content, wc_get_order_notes(['order_id' => $o->get_id()]));
    $lines = [];
    foreach ($o->get_items() as $item) {
      $p = $item->get_product();
      $lines[$p ? $p->get_slug() : (string) $item->get_product_id()] = (int) $item->get_quantity();
    }
    echo wp_json_encode([
      'id' => $o->get_id(),
      'status' => $o->get_status(),
      'total' => $o->get_total(),
      'signature' => (string) $o->get_meta('_headkit_payments_status_signature'),
      'holdOrderId' => (string) $o->get_meta('headkit_hold_order_id'),
      'notes' => array_values($notes),
      'refunds' => array_map(fn($r) => ['amount' => $r->get_amount(), 'reason' => $r->get_reason()], $o->get_refunds()),
      'lineQty' => $lines,
      'transactionId' => (string) $o->get_transaction_id(),
    ]);
  `);
}

/** Every order (any status, drafts included) whose transaction id is `pi`. */
export function ordersForPaymentIntent(pi: string): number[] {
  return wpJson<number[]>(`
    $ids = wc_get_orders(['limit' => -1, 'status' => array_keys(wc_get_order_statuses()) + ['checkout-draft'], 'transaction_id' => ${JSON.stringify(pi)}, 'return' => 'ids']);
    echo wp_json_encode(array_map('intval', $ids));
  `);
}

/**
 * Run the fail-over's async settle step now (`headkit_settle_stock_shortfall`
 * in inc/headkit-stock-failover.php: refund the short lines, then move the
 * order on). Only that hook: the queue also holds revalidation calls to the
 * starter, which a test has no reason to wait behind. `--force` because a
 * runner WordPress's own cron started may still hold its claim.
 */
export function runActionScheduler(): void {
  execFileSync(
    "docker",
    [
      "exec",
      WP_CONTAINER,
      "wp",
      "action-scheduler",
      "run",
      "--hooks=headkit_settle_stock_shortfall",
      "--force",
      "--allow-root",
    ],
    { encoding: "utf8", timeout: 90_000 },
  );
}

/** Set (or, with `null`, delete) a WordPress option. */
export function setOption(name: string, value: string | null): void {
  wpEval(
    value === null
      ? `delete_option(${JSON.stringify(name)}); echo 'ok';`
      : `update_option(${JSON.stringify(name)}, ${JSON.stringify(value)}); echo 'ok';`,
  );
}

// ── Store API carts ──────────────────────────────────────────────────────

/**
 * A fresh Store API cart holding `lines` (slug → quantity), with an AU
 * customer address unless `address: false`.
 */
export async function cartWith(
  api: APIRequestContext,
  lines: Record<string, number>,
  { address = true }: { address?: boolean } = {},
): Promise<string> {
  const token = await bootstrapCart(api);
  for (const [slug, quantity] of Object.entries(lines)) {
    const res = await api.post(`${STORE_API}/cart/add-item`, {
      headers: { "Content-Type": "application/json", "Cart-Token": token },
      data: { id: productId(slug), quantity },
    });
    expect(
      [200, 201],
      `add-item ${slug} x${quantity} failed: HTTP ${res.status()} ${await res.text()}`,
    ).toContain(res.status());
  }
  // A browser checkout starts from a cart with no customer yet, as a shopper's
  // does; the API specs finalize without a browser, so they need one.
  if (!address) return token;
  const shipping = await api.post(`${STORE_API}/cart/update-customer`, {
    headers: { "Content-Type": "application/json", "Cart-Token": token },
    data: {
      billing_address: {
        first_name: AU_ADDRESS.firstName,
        last_name: AU_ADDRESS.lastName,
        address_1: AU_ADDRESS.address1,
        city: AU_ADDRESS.city,
        state: AU_ADDRESS.state,
        postcode: AU_ADDRESS.postcode,
        country: AU_ADDRESS.country,
        email: "stock-hold-e2e@example.com",
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
    },
  });
  expect(shipping.status(), "update-customer failed").toBe(200);
  return token;
}

/**
 * Sign a body the way commerce signs its calls to the theme
 * (`inc/headkit-checkout-signature.php`): hex HMAC-SHA256 over
 * `timestamp + "." + body`, keyed on the store's API token.
 */
export function signBody(body: string, ts = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", THEME_TOKEN)
    .update(`${ts}.${body}`)
    .digest("hex");
  return { "X-HK-Signature": signature, "X-HK-Timestamp": String(ts) };
}

/**
 * Call the theme's hold transport directly (`cart/extensions`, namespace
 * `headkit-stock-hold`), signed or not.
 */
export async function themeHoldCall(
  api: APIRequestContext,
  cartToken: string,
  data: Record<string, unknown>,
  signed: boolean,
) {
  const body = JSON.stringify({ namespace: "headkit-stock-hold", data });
  return api.post(`${STORE_API}/cart/extensions`, {
    headers: {
      "Content-Type": "application/json",
      "Cart-Token": cartToken,
      ...(signed ? signBody(body) : {}),
    },
    data: body,
  });
}

// ── Gateway (commerce) ───────────────────────────────────────────────────

export interface GqlResult<T> {
  data?: T;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
}

/** One GraphQL call through the gateway, as the storefront server makes it. */
export async function gql<T = Record<string, unknown>>(
  api: APIRequestContext,
  query: string,
  variables: Record<string, unknown> = {},
  cartToken?: string,
): Promise<GqlResult<T>> {
  const res = await api.post(GATEWAY_URL, {
    headers: {
      "content-type": "application/json",
      "x-headkit-key": STORE_KEY,
      ...(cartToken ? { "x-cart-token": cartToken } : {}),
    },
    data: { query, variables },
    timeout: 60_000,
  });
  return (await res.json()) as GqlResult<T>;
}

/** The first error's `extensions.code`, or null. */
export function errorCode(result: GqlResult<unknown>): string | null {
  const code = result.errors?.[0]?.extensions?.code;
  return typeof code === "string" ? code : null;
}

export interface IntentResult {
  clientSecret: string;
  publishableKey: string;
  testMode: boolean;
}

/** createPaymentIntent — the Express path, which places the hold itself. */
export async function createPaymentIntent(
  api: APIRequestContext,
  cartToken: string,
): Promise<GqlResult<{ commerce: { createPaymentIntent: IntentResult } }>> {
  return gql(
    api,
    "mutation{commerce{createPaymentIntent{clientSecret publishableKey testMode}}}",
    {},
    cartToken,
  );
}

/** The PaymentIntent id inside a client secret (`pi_…_secret_…`). */
export function intentId(clientSecret: string): string {
  return clientSecret.split("_secret_")[0] ?? "";
}

export async function holdCheckoutStock(
  api: APIRequestContext,
  cartToken: string,
  checkoutSessionId?: string,
) {
  return gql<{
    commerce: {
      holdCheckoutStock: {
        status: string;
        orderId: string | null;
        holdMinutes: number;
        expiresAt: string | null;
      };
    };
  }>(
    api,
    "mutation($i:HoldCheckoutStockInput){commerce{holdCheckoutStock(input:$i){status orderId holdMinutes expiresAt}}}",
    { i: checkoutSessionId ? { checkoutSessionId } : {} },
    cartToken,
  );
}

export async function releaseCheckoutStock(
  api: APIRequestContext,
  cartToken: string,
  ids: { checkoutSessionId?: string; paymentIntentId?: string },
) {
  return gql<{
    commerce: {
      releaseCheckoutStock: {
        status: string;
        paymentIntentStatus: string | null;
      };
    };
  }>(
    api,
    "mutation($i:ReleaseCheckoutStockInput!){commerce{releaseCheckoutStock(input:$i){status paymentIntentStatus}}}",
    { i: ids },
    cartToken,
  );
}

/**
 * processCheckout for an Express PaymentIntent, with exactly the payment data
 * `components/checkout/express-checkout-pi.tsx` sends after a wallet confirm.
 */
export async function processExpressCheckout(
  api: APIRequestContext,
  cartToken: string,
  pi: string,
) {
  const address = { ...AU_ADDRESS };
  return gql<{
    commerce: {
      processCheckout: { orderId: string; orderKey: string; status: string };
    };
  }>(
    api,
    "mutation($i:ProcessCheckoutInput!){commerce{processCheckout(input:$i){orderId orderKey status}}}",
    {
      i: {
        billingAddress: {
          ...address,
          email: "stock-hold-e2e@example.com",
          phone: "",
        },
        shippingAddress: address,
        paymentMethod: "headkit-payments",
        paymentData: [
          { key: "payment_intent_id", value: pi },
          { key: "payment_status", value: "paid" },
          { key: "payment_provider", value: "stripe" },
          { key: "payment_mode", value: "test" },
        ],
      },
    },
    cartToken,
  );
}

// ── Stripe (TEST mode) ───────────────────────────────────────────────────

/** The TEST key the local commerce runs with; refuses anything else. */
export function stripeKey(): string {
  const key = stripeTestKey();
  expect(
    key,
    "STRIPE_SECRET_KEY (sk_test_) is required for the stock-hold specs",
  ).toMatch(/^sk_test_/);
  return key!;
}

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** One Stripe API call (platform context unless `account` is given). */
export async function stripeApi<T = Record<string, unknown>>(
  api: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
  account?: string,
): Promise<T & { error?: { message: string; code?: string } }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeKey()}`,
    ...(account ? { "Stripe-Account": account } : {}),
  };
  const url = `https://api.stripe.com/v1/${path}`;
  const res =
    method === "GET"
      ? await api.get(url, { headers, params })
      : await api.post(url, {
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          data: form(params),
        });
  return (await res.json()) as T & { error?: { message: string } };
}

/**
 * The store's connected account. Commerce creates the store's PaymentIntents
 * and Checkout Sessions ON that account (Stripe-Account header), so every read
 * and write of them must name it too.
 */
export async function stripeAccount(api: APIRequestContext): Promise<string> {
  const account = await stripeConnectAccountId(api);
  expect(account, "the e2e store has no Stripe connected account").toMatch(
    /^acct_/,
  );
  return account!;
}

export interface StripeIntent {
  id: string;
  status: string;
  amount: number;
  amount_received: number;
  metadata: Record<string, string>;
  latest_charge?: string | null;
  /** Present instead of the intent when Stripe refused the call (a decline). */
  error?: { code?: string; decline_code?: string; message: string };
}

/**
 * Confirm a PaymentIntent server-side with a Stripe TEST payment method — the
 * money moves exactly as a wallet confirm in the browser would move it. The
 * shipping/billing details are what a wallet hands Stripe, which is where the
 * Express webhook reads them from when no browser finalizes.
 */
export async function confirmIntent(
  api: APIRequestContext,
  pi: string,
  paymentMethod: string,
): Promise<StripeIntent> {
  return stripeApi<StripeIntent>(
    api,
    "POST",
    `payment_intents/${pi}/confirm`,
    {
      payment_method: paymentMethod,
      return_url: "http://localhost:3000/checkout/success",
      "shipping[name]": `${AU_ADDRESS.firstName} ${AU_ADDRESS.lastName}`,
      "shipping[address][line1]": AU_ADDRESS.address1,
      "shipping[address][city]": AU_ADDRESS.city,
      "shipping[address][state]": AU_ADDRESS.state,
      "shipping[address][postal_code]": AU_ADDRESS.postcode,
      "shipping[address][country]": AU_ADDRESS.country,
      receipt_email: "stock-hold-e2e@example.com",
    },
    await stripeAccount(api),
  );
}

export async function getIntent(
  api: APIRequestContext,
  pi: string,
): Promise<StripeIntent> {
  return stripeApi<StripeIntent>(
    api,
    "GET",
    `payment_intents/${pi}`,
    {},
    await stripeAccount(api),
  );
}

/** The refunds Stripe holds for a PaymentIntent, in minor units. */
export async function stripeRefunds(
  api: APIRequestContext,
  pi: string,
): Promise<number[]> {
  const list = await stripeApi<{ data: { amount: number; status: string }[] }>(
    api,
    "GET",
    "refunds",
    { payment_intent: pi, limit: "20" },
    await stripeAccount(api),
  );
  return (list.data ?? [])
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .map((r) => r.amount);
}

/**
 * The webhook secret the local commerce accepts (scripts/e2e-ci-stack.sh
 * WEBHOOK_SECRET). LOCAL-ONLY.
 */
export const WEBHOOK_SECRET =
  process.env.E2E_WEBHOOK_SECRET ?? "whsec_e2e_local";

/**
 * Deliver a Stripe event to commerce's /stripe/webhook exactly as Stripe would:
 * the event envelope around the REAL object (read live from Stripe TEST mode by
 * the caller), signed `t=…,v1=HMAC-SHA256(secret, t + "." + body)`.
 *
 * Why not `stripe listen`: CI cannot receive Stripe's deliveries, and a
 * delivery Stripe decides to retry later is not something a test can wait on
 * deterministically. The handler re-reads the PaymentIntent live before acting
 * (`webhook_express_pi.go`), so the event body is only the trigger.
 */
export async function deliverStripeEvent(
  api: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
  account?: string,
): Promise<{ status: number; body: string }> {
  const created = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: `evt_e2e_${created}_${Math.random().toString(36).slice(2, 10)}`,
    object: "event",
    type,
    created,
    livemode: false,
    api_version: "2025-06-30.basil",
    ...(account ? { account } : {}),
    data: { object },
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${created}.${body}`)
    .digest("hex");
  const res = await api.post(`${COMMERCE_URL}/stripe/webhook`, {
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": `t=${created},v1=${signature}`,
    },
    data: body,
    timeout: 90_000,
  });
  return { status: res.status(), body: await res.text() };
}

/** Poll `probe` until it returns a truthy value or `timeoutMs` passes. */
export async function eventually<T>(
  probe: () => Promise<T> | T,
  timeoutMs: number,
  message: string,
  intervalMs = 1_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last as NonNullable<T>;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${message} (last: ${JSON.stringify(last)})`);
}

export { WP_BASE_URL };

/** The Store API base (WooCommerce's own routes, no commerce in between). */
export const STORE_API_URL = STORE_API;

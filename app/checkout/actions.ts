"use server";

import { cookies } from "next/headers";
import { getCartToken } from "@/lib/cart";
import { getAuthToken } from "@/lib/auth-cookie";
import { createServerHeadkit } from "@/lib/sdk.server";
import {
  getCheckoutSessionCookie,
  deleteCheckoutSessionCookie,
} from "@/lib/checkout-session-cookie";
import type {
  ProcessCheckoutInput,
  ProcessCheckoutOrderInput,
  ProcessCheckoutMutation,
  CreateCheckoutSessionMutation,
  GetCheckoutSessionQuery,
  GetCheckoutQuery,
  GetStoreOrderQuery,
  UpdateCustomerInput,
  CartFieldsFragment,
  ExpireCheckoutSessionReason,
} from "@headkit/sdk";
import {
  holdOutcomeFromError,
  holdRefusalFromError,
  type CartCorrection,
  type HoldOutcome,
  type StockHoldPayments,
} from "@/lib/stock-hold";
import { removeCartItemAction, updateCartItemAction } from "@/lib/cart-actions";
import {
  BILLING_ADDRESS_COOKIE,
  parseBillingAddressCookie,
} from "@/lib/checkout-billing-cookie";
import {
  CHECKOUT_DATA_COOKIE,
  parseCheckoutDataCookie,
} from "@/lib/checkout-data-cookie";
import { buildFinalizeAddresses } from "@/lib/finalize-address";
import {
  buildStripeCartPaymentData,
  buildStripeOrderPaymentData,
} from "@/lib/checkout-payment-data";
import { countryCodeFrom } from "@/lib/country-names";
import {
  orderRefusalFromError,
  orderRefusalFromSession,
  logOrderRefusal,
} from "@/lib/order-refusal";
import {
  logOrderValidation,
  logUnexpectedFinalizeFailure,
  orderValidationFromError,
  type CompleteOrderCorrection,
  type CompleteOrderResult,
} from "@/lib/order-validation";

/**
 * Checkout mutations and queries. All checkout operations from the frontend
 * should go through these server actions (not API routes). Flow: Client →
 * Server Action → SDK → GraphQL Gateway.
 *
 * Except anything that only WRITES A COOKIE from the checkout page: a cookie
 * written by a Server Action re-renders the calling route, which on /checkout
 * re-runs the whole server path and creates another Stripe session. Session
 * registration is therefore `POST /api/checkout/active-session`.
 */

export type CheckoutSessionResult =
  CreateCheckoutSessionMutation["commerce"]["createCheckoutSession"];

export type CheckoutSessionDetails =
  GetCheckoutSessionQuery["commerce"]["checkoutSession"];

export type CheckoutOrder =
  ProcessCheckoutMutation["commerce"]["processCheckout"];

export type DraftCheckout = GetCheckoutQuery["commerce"]["checkout"];

export type StoreOrder = NonNullable<
  GetStoreOrderQuery["commerce"]["storeOrder"]
>;

/**
 * Creates a Stripe Checkout Session (custom UI mode) for the current cart.
 * Resolves cart token from cookies. Returns the client secret to initialise
 * CheckoutProvider on the frontend.
 * When successBaseUrl is provided, backend builds order-based return URL:
 * {successBaseUrl}/checkout/success/{orderId}?key={orderKey}&session_id={CHECKOUT_SESSION_ID}
 * Runs server-side — the secret key never reaches the browser.
 *
 * ENG-801: this action deliberately takes NO customer email. Stripe renders a
 * session created with `customer_email` as "prefilled and not editable" —
 * pinning the cart email at create locked the ContactDetailsElement input on
 * every reload / session recreate. Guest sessions are created email-less; the
 * shopper's email reaches the session client-side via `actions.updateEmail`
 * (one-shot push in CheckoutSteps + the contact-step submit). Logged-in
 * shoppers still pass `customerId` (cus_xxx) — the Customer-based email lock
 * is correct behavior and unchanged. Emails/tokens are never logged
 * (T-04.1-15).
 */
export async function createCheckoutSessionAction(
  returnUrl: string,
  customerId?: string,
  allowedShippingCountries?: string[],
  successBaseUrl?: string,
): Promise<CheckoutSessionResult> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  // CKA-06: forward the logged-in shopper's JWT so the WC draft order this
  // session creates is stamped with the real customer_id (not 0). Guest (no
  // cookie) → undefined → guest path unchanged. Never logged (T-04.1-15).
  const authToken = getAuthToken(await cookies());
  // Only request Stripe shipping-address collection when the caller passes
  // allowedShippingCountries (i.e. the cart needs shipping). Passing a non-empty
  // list makes Stripe set shipping_address_collection, which REQUIRES a shipping
  // address to confirm(). For digital/no-shipping carts the caller passes an empty
  // array (or omits it) so the session does not require a shipping address that the
  // billing-only UI never sets. Empty array => omit the field entirely.
  const shippingCountries = allowedShippingCountries ?? [];
  return createServerHeadkit(
    cartToken,
    undefined,
    authToken,
  ).payments.createCheckoutSession({
    returnUrl,
    ...(shippingCountries.length > 0
      ? { allowedShippingCountries: shippingCountries }
      : {}),
    ...(customerId ? { customer: customerId } : {}),
    ...(successBaseUrl ? { successBaseUrl } : {}),
  });
}

/**
 * Creates a Stripe PaymentIntent for the current cart (Express / Apple Pay).
 * Used only by the Payment Intents Express Checkout Element — Payment Element
 * stays on Checkout Sessions. Amount is the authoritative cart total after
 * in-sheet shipping updates.
 *
 * On a stock-hold store commerce reserves the cart's stock first (checkout plan
 * v3 §1.2) and refuses the intent when it cannot. That refusal comes back as a
 * value, not a throw: a Server Action error reaches the browser without its
 * GraphQL code in production, and the wallet needs to know WHICH lines to
 * correct. Any other failure still throws, as before.
 */
export async function createPaymentIntentAction(): Promise<
  { ok: true; clientSecret: string } | { ok: false; hold: HoldOutcome }
> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  try {
    const intent = await createServerHeadkit(
      cartToken,
      undefined,
      authToken,
    ).payments.createIntent();
    return { ok: true, clientSecret: intent.clientSecret };
  } catch (err) {
    const hold = holdRefusalFromError(err);
    if (hold) return { ok: false, hold };
    throw err;
  }
}

/**
 * Reserves the cart's stock in WooCommerce immediately before a payment is
 * confirmed (checkout plan v3 §1, the Pay click). Returns the outcome as a
 * value; the caller confirms ONLY on "held" or "not_required". Every failure
 * that is not a stock refusal is "unavailable": the hold fails closed.
 *
 * A storefront built against an SDK without the hold answers "not_required",
 * which is exactly what it did before the hold existed.
 */
export async function holdCheckoutStockAction(
  checkoutSessionId?: string,
): Promise<HoldOutcome> {
  const cartToken = await getCartToken();
  if (!cartToken) return { status: "unavailable" };
  const authToken = getAuthToken(await cookies());
  const payments = createServerHeadkit(cartToken, undefined, authToken)
    .payments as unknown as StockHoldPayments;
  if (typeof payments.holdCheckoutStock !== "function") {
    return { status: "not_required" };
  }
  try {
    const result = await payments.holdCheckoutStock(checkoutSessionId);
    return { status: result.status === "HELD" ? "held" : "not_required" };
  } catch (err) {
    return holdOutcomeFromError(err);
  }
}

/**
 * Asks commerce to release the cart's hold after a payment attempt, by its
 * Checkout Session or its PaymentIntent. Commerce reads the live PaymentIntent
 * and releases only when the attempt has ended (plan v3 §1.6); this action
 * never decides that. Fire-and-forget: every failure is swallowed, and an
 * unreleased hold lapses on its own within minutes.
 */
export async function releaseCheckoutStockAction(
  input: { checkoutSessionId: string } | { paymentIntentId: string },
): Promise<void> {
  try {
    const cartToken = await getCartToken();
    if (!cartToken) return;
    const authToken = getAuthToken(await cookies());
    const payments = createServerHeadkit(cartToken, undefined, authToken)
      .payments as unknown as StockHoldPayments;
    await payments.releaseCheckoutStock?.(input);
  } catch {
    // Swallowed by design — see docblock.
  }
}

/**
 * Applies the corrections a refusal calls for — removes unavailable lines,
 * reduces short ones — WITHOUT expiring the Checkout Session, so the shopper
 * stays on checkout and the session is re-synced to the corrected cart.
 * Returns the corrected cart, or null when a correction failed.
 */
export async function correctCartAction(
  corrections: ReadonlyArray<CartCorrection>,
): Promise<CartFieldsFragment | null> {
  let cart: CartFieldsFragment | null = null;
  for (const c of corrections) {
    const result =
      c.action === "remove"
        ? await removeCartItemAction(c.itemKey, { keepCheckoutSession: true })
        : await updateCartItemAction(c.itemKey, c.quantity, {
            keepCheckoutSession: true,
          });
    if (!result.success) return null;
    cart = result.cart;
  }
  return cart;
}

/**
 * Deliberately expires a Stripe Checkout Session (ENG-784) and clears the
 * active-session cookie. Reasons: CART_CHANGED (cart mutated under the
 * session) or SUPERSEDED (a newer session replaced it). Expire failures are
 * swallowed — a "conflict" outcome or ownership-guard rejection means the
 * race was lost and mechanism 2 (amount verification at manual capture)
 * backstops; expiry must never block the shopper's flow.
 */
export async function expireCheckoutSessionAction(
  sessionId: string,
  reason: ExpireCheckoutSessionReason,
): Promise<void> {
  try {
    // The expire mutation is ownership-guarded server-side: it must be called
    // with the SAME cart token that created the session.
    const cartToken = await getCartToken();
    if (cartToken) {
      const authToken = getAuthToken(await cookies());
      await createServerHeadkit(
        cartToken,
        undefined,
        authToken,
      ).payments.expireCheckoutSession(sessionId, reason);
    }
  } catch {
    // Swallowed by design — see docblock. Mechanism 2 backstops.
  }
  // Only clear the tracking cookie when it still points at the session being
  // expired: during a supersede (refreshSession) the registration effect may
  // have ALREADY written the NEW session id, which must survive so mechanism 1
  // keeps protecting the replacement session.
  const trackedSessionId = await getCheckoutSessionCookie();
  if (trackedSessionId === sessionId) {
    await deleteCheckoutSessionCookie();
  }
}

/**
 * Fetches the current draft checkout (WooCommerce draft order) for the active
 * cart, returning its orderId / orderKey. Used by the free-order (zero-total)
 * flow to capture the order identifiers BEFORE the server-side zero-total
 * bypass finalizes the order, so the storefront can route to the success page
 * without a Stripe session (PAY-05). Resolves cart token from cookies.
 */
export async function getCheckoutAction(): Promise<DraftCheckout> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  return createServerHeadkit(cartToken, undefined, authToken).checkout.get();
}

/**
 * Retrieves a Stripe Checkout Session by ID.
 * Returns payment status, session status, and the billing/shipping address collected by Stripe.
 * Runs server-side — the secret key never reaches the browser.
 */
export async function getCheckoutSessionAction(
  sessionId: string,
): Promise<CheckoutSessionDetails> {
  return createServerHeadkit().payments.getCheckoutSession(sessionId);
}

/**
 * Updates the customer billing/shipping address on the cart.
 * Triggers WooCommerce to recalculate shipping rates.
 */
export async function updateCustomerAction(
  input: UpdateCustomerInput,
): Promise<CartFieldsFragment> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  return createServerHeadkit(
    cartToken,
    undefined,
    authToken,
  ).cart.updateCustomer(input);
}

/**
 * Selects a shipping rate for a given package.
 * Updates the cart totals accordingly.
 */
export async function selectShippingRateAction(
  packageId: string,
  rateId: string,
): Promise<CartFieldsFragment> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  return createServerHeadkit(
    cartToken,
    undefined,
    authToken,
  ).cart.selectShipping(packageId, rateId);
}

/**
 * Syncs an existing Stripe Checkout Session's line items with the current
 * WooCommerce cart totals. Resolves cart token from cookies.
 *
 * Call this after any server-side cart mutation that affects pricing
 * (address update → shipping rates, shipping rate selection) so the Stripe
 * session reflects authoritative amounts before the customer pays.
 */
export async function syncCheckoutSessionLineItemsAction(
  sessionId: string,
): Promise<void> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  await createServerHeadkit(
    cartToken,
    undefined,
    authToken,
  ).payments.syncCheckoutSessionLineItems(sessionId);
}

/**
 * Finalises checkout after Stripe payment confirmation.
 * Resolves cart token from cookies. Runs server-side so totals are
 * re-validated before order creation.
 */
export async function processCheckoutAction(
  input: ProcessCheckoutInput,
): Promise<CheckoutOrder> {
  const cartToken = await getCartToken();
  if (!cartToken) throw new Error("No active cart session.");
  const authToken = getAuthToken(await cookies());
  return createServerHeadkit(cartToken, undefined, authToken).checkout.process(
    input,
  );
}

/**
 * Processes an existing draft order with payment (WooCommerce Checkout Order API).
 * Uses cart token from session metadata. Call when orderId, orderKey, cartToken are present.
 */
export async function processCheckoutOrderAction(
  cartToken: string,
  orderId: string,
  orderKey: string,
  input: ProcessCheckoutOrderInput,
): Promise<CheckoutOrder> {
  const authToken = getAuthToken(await cookies());
  return createServerHeadkit(
    cartToken,
    undefined,
    authToken,
  ).checkout.processCheckoutOrder(orderId, input);
}

/**
 * Fetches a placed order by WooCommerce order ID and order key.
 * billingEmail is required for guest orders (WooCommerce Store API).
 * Used on the success page to display full order details.
 */
export async function getOrderAction(
  orderId: string,
  orderKey: string,
  billingEmail?: string | null,
): Promise<StoreOrder | null> {
  return createServerHeadkit().checkout.getOrder(
    orderId,
    orderKey,
    billingEmail,
  );
}

/**
 * Re-finalises a PAID order with a detail the shopper corrected after
 * WooCommerce refused it over that detail (`ORDER_VALIDATION`,
 * `lib/order-validation.ts`). Reached from `components/checkout/complete-order.tsx`
 * only.
 *
 * Nothing is charged here and nothing can be: the Stripe session is already
 * paid and this calls the same finalize mutation the return page called. Two
 * things keep it from drifting away from the attempt it retries:
 *
 * - `payment_data` comes from the SAME builder that page used
 *   (`lib/checkout-payment-data.ts`). Its `checkout_session_id` is the key the
 *   theme's duplicate-finalize claim row is written under, so a retry of this
 *   session adopts the order rather than creating a second one, even if the
 *   Stripe webhook finalises it first.
 * - the address pair is rebuilt from the session and the checkout cookies with
 *   the same sources that page used (`buildFinalizeAddresses`), and only then
 *   is the shopper's patch overlaid on the side it names.
 *
 * Two finalize shapes, because the two return pages fail at different
 * moments. The ORDER page already has a draft order, so its retry ADOPTS it
 * (`processCheckoutOrder`). The CART page's failure came from `processCheckout`,
 * which creates the order, so there is no id to adopt and the retry creates it
 * from the still-active cart.
 *
 * The arguments come from the browser and are checked against the session
 * before anything is sent: the session must be paid, must not carry a
 * recorded refusal, and must name this order when it names one at all (the
 * order page's own tamper guard).
 *
 * It NEVER throws. Every failure comes back as a {@link CompleteOrderResult}.
 */
export async function completeOrderAction(
  /** The draft order to adopt, or "" on the cart page, which has none yet. */
  orderId: string,
  orderKey: string,
  sessionId: string,
  correction: CompleteOrderCorrection,
): Promise<CompleteOrderResult> {
  const adopt = !!orderId && !!orderKey;
  try {
    const session = await getCheckoutSessionAction(sessionId);
    const refused = orderRefusalFromSession(session);
    if (refused) {
      logOrderRefusal(refused);
      return { ok: false, kind: "refused", refusal: refused };
    }
    const cartToken = session.cartToken;
    if (
      !cartToken ||
      session.status !== "complete" ||
      session.paymentStatus === "unpaid" ||
      (adopt &&
        !!session.orderId &&
        session.orderId !== "0" &&
        session.orderId !== orderId)
    ) {
      return { ok: false, kind: "transient" };
    }

    const cookieStore = await cookies();
    const billingCookie = parseBillingAddressCookie(
      cookieStore.get(BILLING_ADDRESS_COOKIE)?.value,
    );
    const storedData = parseCheckoutDataCookie(
      cookieStore.get(CHECKOUT_DATA_COOKIE)?.value,
    );

    // The same sources, options and email the retried page used.
    const sessionEmail = adopt
      ? (storedData.email ?? session.customerEmail ?? "")
      : (session.customerEmail ?? "");
    const { billingAddress, shippingAddress } = adopt
      ? buildFinalizeAddresses(
          {
            billingCookie,
            sessionBilling: session.billingAddress,
            shippingCookie: storedData.shippingAddress ?? null,
            sessionShipping: session.shippingAddress,
          },
          {
            billingEmail: sessionEmail,
            phonePolicy: "omit-empty",
            context: "checkout/complete-order (order)",
          },
        )
      : buildFinalizeAddresses(
          {
            billingCookie,
            sessionBilling:
              session.billingAddress ?? session.shippingAddress ?? null,
            sessionShipping:
              session.shippingAddress ?? session.billingAddress ?? null,
          },
          {
            billingEmail: sessionEmail,
            billingPhoneFallback:
              (session.billingAddress ?? session.shippingAddress)?.phone ?? "",
            phonePolicy: "emit-empty",
            context: "checkout/complete-order (cart)",
          },
        );

    // The patch. Empty values are dropped so a form that rendered one field
    // cannot blank the ones it did not render.
    const patch: Record<string, string> = {};
    let correctedEmail = "";
    for (const [field, value] of Object.entries(correction.fields)) {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) continue;
      if (field === "email") {
        correctedEmail = trimmed;
        continue;
      }
      patch[field] = field === "country" ? countryCodeFrom(trimmed) : trimmed;
      if (!patch[field]) delete patch[field];
    }
    const correctedBilling = {
      ...billingAddress,
      ...(correction.side === "billing" ? patch : {}),
      ...(correctedEmail ? { email: correctedEmail } : {}),
    };
    const correctedShipping = {
      ...shippingAddress,
      ...(correction.side === "shipping" ? patch : {}),
    };
    const billingEmail =
      correctedEmail ||
      (typeof correctedBilling.email === "string"
        ? correctedBilling.email
        : "");

    if (adopt) {
      await processCheckoutOrderAction(cartToken, orderId, orderKey, {
        orderKey,
        billingAddress: correctedBilling,
        shippingAddress: correctedShipping,
        ...(billingEmail ? { billingEmail } : {}),
        paymentMethod: "headkit-payments",
        paymentData: buildStripeOrderPaymentData(sessionId, session),
      });
      return {
        ok: true,
        path: `/checkout/success/${orderId}?key=${encodeURIComponent(orderKey)}`,
      };
    }

    const created = await processCheckoutAction({
      paymentMethod: "headkit-payments",
      billingAddress: correctedBilling,
      shippingAddress: correctedShipping,
      paymentData: buildStripeCartPaymentData(sessionId, session),
    });
    if (!created?.orderId || created.orderId === "0" || !created.orderKey) {
      // Finalised with no identifiers to route to: the webhook owns it from
      // here, and the processing screen polls for it.
      return { ok: false, kind: "transient" };
    }
    return {
      ok: true,
      path: `/checkout/success/${created.orderId}?key=${encodeURIComponent(created.orderKey)}&session_id=${encodeURIComponent(sessionId)}`,
    };
  } catch (err) {
    // A re-finalize of an order the webhook has meanwhile placed is a SUCCESS
    // from the shopper's side. Same list the order page treats as
    // already-finalized.
    const message = err instanceof Error ? err.message : "";
    if (
      adopt &&
      (message.includes("different customer") ||
        message.includes("invalid_user") ||
        message.includes("already paid") ||
        message.includes("cannot be paid"))
    ) {
      return {
        ok: true,
        path: `/checkout/success/${orderId}?key=${encodeURIComponent(orderKey)}`,
      };
    }
    const refusal = orderRefusalFromError(err);
    if (refusal) {
      logOrderRefusal(refusal);
      return { ok: false, kind: "refused", refusal };
    }
    const failure = orderValidationFromError(err);
    if (failure) {
      logOrderValidation(failure);
      return { ok: false, kind: "validation", failure };
    }
    logUnexpectedFinalizeFailure(err);
    return { ok: false, kind: "transient" };
  }
}

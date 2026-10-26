/**
 * ONE owner for "the shopper paid and WooCommerce then refused the order".
 *
 * WooCommerce validates the cart on finalize AFTER the payment succeeded, so a
 * sold-out line, a product no longer purchasable or a coupon that died
 * mid-payment arrives as an enumerated 409 with no order id. The return page
 * used to fall through to its paid-but-unresolved fallback and render "Your
 * payment is processing" forever — the one screen that is false in exactly
 * this case. Commerce now refunds (or releases) the payment at once and stamps
 * the Checkout Session (`stripeutil.RefundAndMarkOrderRefused`), so the
 * storefront can say what actually happened.
 *
 * This module is the whole decision: which failures count, what the shopper
 * reads, and what we log. `components/checkout/order-refused.tsx` renders it;
 * three surfaces detect it (both success pages and the processing poller).
 *
 * # The two detection paths are NOT redundant
 *
 * - **The SESSION carries it** (`CheckoutSessionDetails.orderFailure`) once
 *   commerce has recorded the refusal — visible to a page load minutes later
 *   and to the poller mid-flight.
 * - **The MUTATION throws it** when the success page's own finalize is what
 *   discovered the refusal (`extensions.code = "ORDER_REFUSED"`,
 *   `extensions.reason` = the WooCommerce code). That throw is the FIRST
 *   notice: commerce refunds and only then stamps the session, so a page that
 *   read only the session would fall through to the pending screen.
 *
 * A transient finalize failure carries NO code — that absence is commerce's
 * retry signal — and {@link orderRefusalFromError} answers null for it, so the
 * existing "poll the session, the webhook may have won the race" path is
 * untouched.
 *
 * # Its sibling
 *
 * `lib/order-validation.ts` owns `ORDER_VALIDATION`: WooCommerce rejected one
 * FIELD and the money has NOT been refunded, so the shopper can complete the
 * same order. Every surface runs this classifier FIRST and that one second,
 * and the two screens say opposite things about the money on purpose.
 *
 * # `reason` decides the copy; `message` overrides it
 *
 * `reason` is the enumerated code and the thing to branch on. `message` is
 * WooCommerce's own shopper-facing sentence — merchant copy, possibly
 * translated, never a contract — so the body prefers it, then falls back to
 * {@link ORDER_REFUSAL_REASON_COPY}, then to a generic sentence. A thrown
 * refusal carries a reason and no message, which is why the reason map exists.
 *
 * # The amount
 *
 * The money sentence names a figure only when the caller passes one. No
 * caller does yet, deliberately: the session's `lineItems` are Stripe's
 * line-items list, which carries no shipping (it rides in `shipping_options`),
 * so their sum understates the refund on every shipped order — and a sentence
 * naming the wrong amount is worse than one naming none. Commerce knows the
 * charged `amount_total` but does not expose it on `CheckoutSessionDetails`;
 * that field is what should feed `amount`.
 *
 * NEVER render `reason`, `refundId`, `occurredAt` or a session id. They go to
 * {@link logOrderRefusal} and nowhere else.
 */

import {
  errorExtensionBags,
  extensionString,
} from "./graphql-error-extensions";

/** The `extensions.code` commerce sets when it refuses a paid order. */
export const ORDER_REFUSED_CODE = "ORDER_REFUSED";

/**
 * A post-payment order refusal, in the one shape the screen renders. Mirrors
 * the gateway's `CheckoutSessionOrderFailure`, and is also what a thrown
 * `ORDER_REFUSED` reduces to (with every optional field absent).
 */
export interface OrderRefusal {
  /** The enumerated WooCommerce code. Branch on this; never render it. */
  reason: string;
  /** WooCommerce's shopper-facing sentence, when it sent one. */
  message?: string | null;
  /** Stripe refund id. Null when an authorization was released instead. */
  refundId?: string | null;
  /** Stripe refund status, or `authorization_released`. */
  refundStatus?: string | null;
  /** RFC3339, for the log line only. */
  occurredAt?: string | null;
}

/** Reason used when commerce refused the order but named no code. */
export const UNNAMED_ORDER_REFUSAL_REASON = "order_refused";

/**
 * Body copy per enumerated WooCommerce code, used when `message` is absent —
 * the refusal allowlist on `woocommerce.OrderRefusedError`. Anything else
 * takes {@link ORDER_REFUSAL_FALLBACK_BODY}.
 */
export const ORDER_REFUSAL_REASON_COPY: Readonly<Record<string, string>> = {
  woocommerce_rest_product_out_of_stock:
    "An item in your cart sold out while you were paying.",
  woocommerce_rest_product_partially_out_of_stock:
    "There is no longer enough stock for one of the items in your cart.",
  woocommerce_rest_product_not_purchasable:
    "One of the items in your cart is no longer available to buy.",
  woocommerce_rest_product_too_many_in_cart:
    "One of the items in your cart has a purchase limit your order went over.",
  woocommerce_rest_cart_coupon_error:
    "A discount code on your order is no longer valid.",
  woocommerce_rest_cart_item_error:
    "One of the items in your cart is no longer available.",
};

/** Body copy when there is neither a message nor a known reason. */
export const ORDER_REFUSAL_FALLBACK_BODY =
  "Something in your cart changed while you were paying, so we couldn't place the order.";

/** What the shopper reads about WHY the order could not be placed. */
export function orderRefusalBody(refusal: OrderRefusal): string {
  const message = refusal.message?.trim();
  if (message) return message;
  return (
    ORDER_REFUSAL_REASON_COPY[refusal.reason] ?? ORDER_REFUSAL_FALLBACK_BODY
  );
}

/**
 * What the shopper reads about THE MONEY, by Stripe's refund status.
 *
 * `pending` and `succeeded` read the same on purpose: both mean the refund is
 * irreversibly on its way. An unknown or absent status gets the cautious
 * sentence rather than a claim we cannot support — commerce refunds before it
 * stamps the session, so "being refunded" is true even before the status is
 * recorded. `amount` is spliced only into the refunded sentence.
 */
export function orderRefusalMoneySentence(
  refundStatus: string | null | undefined,
  amount?: string,
): string {
  if (refundStatus === "authorization_released") {
    return "Your card was not charged. The authorisation has been released.";
  }
  if (refundStatus === "succeeded" || refundStatus === "pending") {
    return amount
      ? `Your payment of ${amount} has been refunded. It can take 3 to 5 business days to appear on your statement.`
      : "Your payment has been refunded. It can take 3 to 5 business days to appear on your statement.";
  }
  return "Your payment is being refunded. If it has not appeared within 5 business days, contact us.";
}

/** The minimum of a Stripe session this module reads. */
export interface OrderRefusalSessionLike {
  orderFailure?: {
    reason?: string | null;
    message?: string | null;
    refundId?: string | null;
    refundStatus?: string | null;
    occurredAt?: string | null;
  } | null;
}

/**
 * The refusal a session carries, or null. Every healthy session — and every
 * session served by a gateway that predates `orderFailure` — answers null, so
 * every other disposition is unchanged.
 */
export function orderRefusalFromSession(
  session: OrderRefusalSessionLike | null | undefined,
): OrderRefusal | null {
  const failure = session?.orderFailure;
  if (!failure) return null;
  return {
    reason: failure.reason?.trim() || UNNAMED_ORDER_REFUSAL_REASON,
    message: failure.message ?? null,
    refundId: failure.refundId ?? null,
    refundStatus: failure.refundStatus ?? null,
    occurredAt: failure.occurredAt ?? null,
  };
}

/**
 * The refusal a thrown finalize error carries, or null for every other
 * failure. Null means "keep doing what you did before".
 */
export function orderRefusalFromError(error: unknown): OrderRefusal | null {
  for (const bag of errorExtensionBags(error)) {
    if (bag["code"] !== ORDER_REFUSED_CODE) continue;
    return {
      reason: extensionString(bag, "reason") || UNNAMED_ORDER_REFUSAL_REASON,
    };
  }
  return null;
}

const CHECKOUT_STOCK_REASONS = new Set([
  "woocommerce_rest_product_out_of_stock",
  "woocommerce_rest_product_partially_out_of_stock",
]);

/**
 * Stock sold out before the order was placed. The shopper goes to `/checkout`,
 * where the existing sold-out alerts say which lines changed and that they
 * have not been charged. That is the screen for this case, including when a
 * refund status was stamped: the refund card claims money moved and came back.
 */
export function isCheckoutStockRefusal(
  refusal: OrderRefusal | null | undefined,
): boolean {
  if (!refusal) return false;
  return CHECKOUT_STOCK_REASONS.has(refusal.reason);
}

/**
 * Stock sold out while authorized (not captured). Narrower than
 * {@link isCheckoutStockRefusal}, which is what the return pages branch on.
 */
export function isStockAuthReleasedRefusal(
  refusal: OrderRefusal | null | undefined,
): boolean {
  if (!isCheckoutStockRefusal(refusal) || !refusal) return false;
  return refusal.refundStatus === "authorization_released";
}

/**
 * The ONE log line for a refusal: the WooCommerce code and the Stripe refund
 * id, which together reconcile a refund against an order that was never
 * created. Call it where the refusal is detected, not from a render.
 */
export function logOrderRefusal(refusal: OrderRefusal): void {
  console.error("[order-refused]", refusal.reason, refusal.refundId ?? null);
}

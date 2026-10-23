/**
 * ONE table for every checkout failure: where the shopper goes, and what the
 * page says. Nothing else in the storefront may decide either.
 *
 * Two rules, both mechanical here rather than per call site:
 *
 * 1. A failed payment or order always returns the shopper to `/checkout` to
 *    try again, whenever there is still a cart to pay for.
 * 2. A shopper never reads technical detail — no exception message, no
 *    provider body, no JSON — on any failure screen.
 *
 * The defect this closes was a per-call-site decision: nine
 * `redirect("/checkout/error?...")` sites, each a dead end for a shopper whose
 * cart was still intact, and one of them put the raw exception message in the
 * URL for the error page to print.
 *
 * # Recoverable vs dead end
 *
 * RECOVERABLE means the cart still exists, so there is something to retry.
 * `/checkout` mints a FRESH Stripe checkout session on every load
 * (`createCheckoutSessionAction` in `app/checkout/page.tsx`), so arriving at
 * `/checkout?error=<reason>` IS the retry — there is no separate retry wiring.
 * {@link CHECKOUT_BANNER_COPY} is what the shopper reads there.
 *
 * DEAD END means there is nothing to retry: the cart is empty or unreadable.
 * Those reasons keep `/checkout/error`, with a sentence and a way back into
 * the shop. {@link CHECKOUT_DEAD_END} is what that page renders.
 *
 * # Stock reasons go to the BAG, not to a screen
 *
 * Checkout plan v3 §2.3: no stock refusal ends on an error screen. Checkout
 * corrects the cart in place and leaves only for the bag (`lib/stock-hold.ts`).
 * So nothing routes {@link CHECKOUT_BAG_REASONS} to `/checkout/error`; that page
 * forwards an old link carrying one to the bag with the generic alert. Their
 * {@link CHECKOUT_DEAD_END} entries exist only so the table stays total.
 *
 * # `session_expired` is in BOTH lists, deliberately
 *
 * It is the one reason whose class depends on state a caller does not hold: a
 * Stripe session can expire while the WooCommerce cart is perfectly readable
 * (the common case — the shopper simply took too long), and it can expire
 * alongside a cart that is gone. So every CALLER routes it to `/checkout`, and
 * `/checkout`'s own null-cart gate is the SINGLE place that decides a dead end.
 * That is also the loop guard: the decision happens once, on arrival, and
 * `/checkout/error` never sends anyone back. The gate sends a gone cart to
 * `empty_cart` (a cart that is gone reads as empty, as on WooCommerce itself);
 * the `session_expired` dead-end entry stays so an old link still renders.
 *
 * # No technical detail travels in a URL
 *
 * {@link checkoutFailurePath} emits `reason` and nothing else. A payload is
 * logged with {@link logCheckoutFailure} at the point it is known —
 * server-side where the throw happened — and never put in a query string,
 * because a query string is a thing the shopper reads.
 *
 * Its siblings own the two failures that happen AFTER the money moved, and
 * which therefore never route here: `lib/order-refusal.ts` (refused and
 * refunded) and `lib/order-validation.ts` (paid, one detail to correct).
 */

/** Reasons whose shopper still has a cart to pay for. */
export const CHECKOUT_RECOVERABLE_REASONS = [
  "payment_failed",
  "payment_canceled",
  "cart_changed",
  "processing_error",
  "session_expired",
  "no_session",
  "invalid_session",
  "session_creation_failed",
  "order_creation_failed",
  "checkout_failed",
  "checkout_execution_error",
  "stripe_error",
  "missing_data",
  "missing_parameters",
  "invalid_data",
  "missing_billing",
  "missing_address",
  "missing_shipping",
] as const;

/**
 * Reasons with nothing left to retry. `session_expired` is here AND in
 * {@link CHECKOUT_RECOVERABLE_REASONS} — see the module header.
 */
export const CHECKOUT_DEAD_END_REASONS = [
  "empty_cart",
  "stock_correction_empty",
  "session_expired",
  "item_unavailable",
] as const;

export type CheckoutRecoverableReason =
  (typeof CHECKOUT_RECOVERABLE_REASONS)[number];
export type CheckoutDeadEndReason = (typeof CHECKOUT_DEAD_END_REASONS)[number];
export type CheckoutFailureReason =
  | CheckoutRecoverableReason
  | CheckoutDeadEndReason;

/**
 * The sentence `/checkout` shows per reason — one plain sentence, nothing
 * technical. `payment_failed` and `cart_changed` are rendered by their own
 * dismissible banners (`PaymentFailedBanner`, `CartChangedBanner`), which READ
 * their sentence from here; `CheckoutErrorHandler` emits no inline duplicate
 * for those two.
 */
export const CHECKOUT_BANNER_COPY: Record<CheckoutRecoverableReason, string> = {
  payment_failed:
    "Your payment was not successful. Please try again or use a different payment method.",
  payment_canceled:
    "Your payment was cancelled and you have not been charged — your cart changed while the payment was in progress. Please review your cart and try again.",
  cart_changed:
    "Your cart changed while your payment was in progress, so that payment was cancelled and nothing was charged. Please review your updated order and pay again.",
  processing_error:
    "There was an error processing your order. Please try again.",
  session_expired:
    "Your checkout session expired before the payment went through. Nothing was charged — your cart is below, please try again.",
  no_session:
    "Your checkout session expired before the payment went through. Nothing was charged — your cart is below, please try again.",
  invalid_session:
    "We couldn't prepare your checkout session. Please try again.",
  session_creation_failed: "We couldn't start your checkout. Please try again.",
  order_creation_failed: "We couldn't create your order. Please try again.",
  checkout_failed: "We couldn't create your order. Please try again.",
  checkout_execution_error: "We couldn't create your order. Please try again.",
  stripe_error:
    "There was an issue with the payment processor. Please try again.",
  missing_data: "We couldn't find your checkout information. Please try again.",
  missing_parameters:
    "We couldn't find your checkout information. Please try again.",
  invalid_data: "Your checkout information was invalid. Please try again.",
  missing_billing:
    "Address information is missing. Please complete all checkout steps.",
  missing_address:
    "Address information is missing. Please complete all checkout steps.",
  missing_shipping: "Shipping information is missing. Please try again.",
};

/** Fallback banner sentence for a reason nothing here declares. */
export const CHECKOUT_BANNER_FALLBACK_COPY =
  "We couldn't complete your payment. Please try again.";

export interface CheckoutDeadEndContent {
  /** Page heading. Never "Payment Failed" — none of these is a payment. */
  title: string;
  body: string;
  /**
   * Which primary action the page offers: `"shop"` for a cart that is gone;
   * `"checkout"` for a reason that still has somewhere to go back to.
   */
  action: "shop" | "checkout";
}

export const CHECKOUT_DEAD_END: Record<
  CheckoutDeadEndReason,
  CheckoutDeadEndContent
> = {
  empty_cart: {
    title: "Your cart is empty",
    body: "Your cart is empty. Add items to your cart to continue.",
    action: "shop",
  },
  stock_correction_empty: {
    title: "Your cart is empty",
    body: "Some items were out of stock and removed. Your cart is now empty.",
    action: "shop",
  },
  session_expired: {
    title: "Your cart session has expired",
    body: "Your cart session has expired. Please add items to your cart and try again.",
    action: "shop",
  },
  item_unavailable: {
    title: "An item in your cart is unavailable",
    body: "An item in your cart is no longer available. Open your cart, remove it, and try again.",
    action: "checkout",
  },
};

/**
 * What `/checkout/error` renders for a reason that is not a dead end — a
 * bookmarked or legacy link. It does NOT redirect: `/checkout` may send a
 * shopper here, so a redirect back is the one arrangement that can loop.
 */
export const CHECKOUT_DEAD_END_FALLBACK: CheckoutDeadEndContent = {
  title: "We couldn't complete your checkout",
  body: "Your cart is still saved — please try again.",
  action: "checkout",
};

/**
 * Dead-end reasons that are stock refusals, which `/checkout/error` forwards
 * to the bag rather than rendering (see "Stock reasons go to the BAG").
 */
export const CHECKOUT_BAG_REASONS = [
  "item_unavailable",
  "stock_correction_empty",
] as const satisfies readonly CheckoutDeadEndReason[];

const BAG_SET: ReadonlySet<string> = new Set(CHECKOUT_BAG_REASONS);
const DEAD_END_SET: ReadonlySet<string> = new Set(CHECKOUT_DEAD_END_REASONS);
const RECOVERABLE_SET: ReadonlySet<string> = new Set(
  CHECKOUT_RECOVERABLE_REASONS,
);

/** True for a reason `/checkout/error` hands to the bag instead of showing. */
export function isCheckoutBagReason(
  reason: string | null | undefined,
): boolean {
  return typeof reason === "string" && BAG_SET.has(reason);
}

export function isRecoverableCheckoutFailure(
  reason: string | null | undefined,
): reason is CheckoutRecoverableReason {
  return typeof reason === "string" && RECOVERABLE_SET.has(reason);
}

export function isCheckoutDeadEndReason(
  reason: string | null | undefined,
): reason is CheckoutDeadEndReason {
  return typeof reason === "string" && DEAD_END_SET.has(reason);
}

/**
 * Where a CALLER sends a shopper for `reason`. Carries `reason` and nothing
 * else — never an `error=` or `message=` payload.
 *
 * An unknown reason routes to `/checkout`: a failure we cannot classify is far
 * more likely to be a payment that can be retried than a cart that is gone,
 * and `/checkout` re-checks the real cart on arrival anyway.
 */
export function checkoutFailurePath(reason: string): string {
  const encoded = encodeURIComponent(reason);
  // `session_expired` resolves as RECOVERABLE here even though it is also a
  // dead-end reason — the caller cannot see the cart, `/checkout` can.
  if (isRecoverableCheckoutFailure(reason)) {
    return `/checkout?error=${encoded}`;
  }
  if (isCheckoutDeadEndReason(reason)) {
    return `/checkout/error?reason=${encoded}`;
  }
  return `/checkout?error=${encoded}`;
}

/**
 * The dead-end URL for `reason`. Only `app/checkout/page.tsx` may call this,
 * and only from a gate that has READ the cart: it is the one place allowed to
 * answer "there is nothing to retry".
 *
 * A second function rather than a branch of {@link checkoutFailurePath}
 * because that one routes `session_expired` to `/checkout` — right for every
 * caller that cannot see the cart, and an infinite loop if the null-cart gate
 * itself called it.
 */
export function checkoutDeadEndPath(reason: CheckoutDeadEndReason): string {
  return `/checkout/error?reason=${encodeURIComponent(reason)}`;
}

export function checkoutBannerMessage(
  reason: string | null | undefined,
): string {
  return isRecoverableCheckoutFailure(reason)
    ? CHECKOUT_BANNER_COPY[reason]
    : CHECKOUT_BANNER_FALLBACK_COPY;
}

export function checkoutDeadEndContent(
  reason: string | null | undefined,
): CheckoutDeadEndContent {
  return isCheckoutDeadEndReason(reason)
    ? CHECKOUT_DEAD_END[reason]
    : CHECKOUT_DEAD_END_FALLBACK;
}

/**
 * The ONE log line for a checkout failure. The payload stays in our logs and
 * off the shopper's screen; `reason` is the only thing that travels in a URL.
 * Call it once per failure, at the point the payload is known.
 */
export function logCheckoutFailure(
  reason: string | null | undefined,
  details?: unknown,
): void {
  if (details === undefined) {
    console.error("[checkout-failure]", reason ?? "unknown");
    return;
  }
  console.error("[checkout-failure]", reason ?? "unknown", details);
}

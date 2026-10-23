/**
 * The ONE place the `payment_data` of a Stripe finalize is written, for both
 * return pages AND for `completeOrderAction`, which re-finalises a paid order
 * after the shopper corrected a detail.
 *
 * The keys are a CONTRACT with the WordPress theme, not a payload shape we are
 * free to pick: `checkout_session_id` is what the theme's atomic
 * `headkit_sess_claim_*` row is keyed on — the duplicate-finalize guard that
 * lets the browser and the Stripe webhook race freely, and that makes a retry
 * of the same session adopt the order rather than create a second one — and
 * `payment_provider` is what commerce's `payment_status` sanitizer dispatches
 * on (ADR 005). Renaming one does not fail; it produces a wrongly labelled
 * order, or a duplicate.
 *
 * Two builders because the two return pages finalise two different things and
 * have always sent two different arrays. Each page and the retry of that page
 * call the SAME builder, so a retry cannot drift one key away from the attempt
 * it is retrying. Converging the two arrays is a separate change.
 */

/** The minimum of a Stripe Checkout Session the builders read. */
export interface StripePaymentDataSessionLike {
  paymentIntentId?: string | null;
  paymentMethod?: string | null;
  livemode?: boolean | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  walletType?: string | null;
  stripeCustomerId?: string | null;
}

export interface PaymentDataEntry {
  key: string;
  value: string;
}

/**
 * The `payment_data` for a paid session finalised onto an EXISTING draft
 * order (`processCheckoutOrder`, `app/checkout/success/[orderId]/page.tsx`).
 * Nine keys always, in this order, with "" where the session carried nothing;
 * `stripe_customer_id` is appended only when there is one.
 */
export function buildStripeOrderPaymentData(
  sessionId: string,
  session: StripePaymentDataSessionLike,
): PaymentDataEntry[] {
  const paymentData: PaymentDataEntry[] = [
    { key: "checkout_session_id", value: sessionId },
    { key: "payment_status", value: "paid" },
    { key: "payment_intent_id", value: session.paymentIntentId ?? "" },
    { key: "payment_method", value: session.paymentMethod ?? "card" },
    { key: "payment_mode", value: session.livemode ? "live" : "test" },
    { key: "payment_provider", value: "stripe" },
    { key: "card_brand", value: session.cardBrand ?? "" },
    { key: "card_last4", value: session.cardLast4 ?? "" },
    { key: "wallet_type", value: session.walletType ?? "" },
  ];
  if (session.stripeCustomerId) {
    paymentData.push({
      key: "stripe_customer_id",
      value: session.stripeCustomerId,
    });
  }
  return paymentData;
}

/**
 * The `payment_data` for a paid session finalised from the CART
 * (`processCheckout`, `app/checkout/success/page.tsx` — the WC 10.8+ deferred
 * draft path, where no order id exists yet). Three keys always; every other
 * key only when the session carried a value.
 */
export function buildStripeCartPaymentData(
  sessionId: string,
  session: StripePaymentDataSessionLike,
): PaymentDataEntry[] {
  const paymentData: PaymentDataEntry[] = [
    { key: "checkout_session_id", value: sessionId },
    { key: "payment_status", value: "paid" },
    { key: "payment_provider", value: "stripe" },
  ];
  if (session.paymentIntentId) {
    paymentData.push({
      key: "payment_intent_id",
      value: session.paymentIntentId,
    });
  }
  if (session.paymentMethod) {
    paymentData.push({ key: "payment_method", value: session.paymentMethod });
  }
  if (session.cardBrand) {
    paymentData.push({ key: "card_brand", value: session.cardBrand });
  }
  if (session.cardLast4) {
    paymentData.push({ key: "card_last4", value: session.cardLast4 });
  }
  if (session.walletType) {
    paymentData.push({ key: "wallet_type", value: session.walletType });
  }
  if (session.livemode !== undefined) {
    paymentData.push({
      key: "payment_mode",
      value: session.livemode ? "live" : "test",
    });
  }
  if (session.stripeCustomerId) {
    paymentData.push({
      key: "stripe_customer_id",
      value: session.stripeCustomerId,
    });
  }
  return paymentData;
}

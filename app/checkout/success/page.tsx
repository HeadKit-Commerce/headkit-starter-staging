import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCheckoutSessionAction, processCheckoutAction } from "../actions";
import { PaymentProcessing } from "@/components/checkout/payment-processing";
import { OrderRefused } from "@/components/checkout/order-refused";
import { CompleteOrder } from "@/components/checkout/complete-order";
import {
  BILLING_ADDRESS_COOKIE,
  parseBillingAddressCookie,
} from "@/lib/checkout-billing-cookie";
import { buildFinalizeAddresses } from "@/lib/finalize-address";
import { buildStripeCartPaymentData } from "@/lib/checkout-payment-data";
import {
  checkoutFailurePath,
  logCheckoutFailure,
} from "@/lib/checkout-failure";
import {
  isStockAuthReleasedRefusal,
  logOrderRefusal,
  orderRefusalFromError,
  orderRefusalFromSession,
  type OrderRefusal,
} from "@/lib/order-refusal";
import {
  logOrderValidation,
  orderValidationFromError,
  type OrderValidationAddressLike,
  type OrderValidationFailure,
} from "@/lib/order-validation";

/**
 * Checkout return page: Stripe sends the shopper here (with only session_id)
 * after the embedded/redirect payment flow completes — success OR failure.
 * The page branches on the Stripe session status (ENG-789):
 *
 * - status "open"                       → payment failed or was canceled
 *   (redirect BNPL methods like Afterpay return here on decline/cancel).
 *   Redirect to /checkout?error=payment_failed — the checkout page creates a
 *   fresh Stripe session on load and the cart is preserved, so this is an
 *   in-place retry.
 * - status "expired"                    → /checkout?error=session_expired
 *   (recoverable: the WooCommerce cart normally outlives the Stripe session,
 *   and `/checkout` mints a fresh one; only its null-cart gate decides a dead
 *   end — `lib/checkout-failure.ts`.)
 * - session carries `orderFailure`      → the shopper PAID and WooCommerce
 *   refused the order; commerce has already refunded or released the payment,
 *   so render <OrderRefused>. Checked BEFORE every branch below: a refused
 *   session is otherwise an ordinary complete+paid session whose order id
 *   never resolves, which is how it used to sit on "processing" forever.
 * - status "complete" + unpaid          → async payment method still processing
 *   (e.g. bank debits). Render a pending screen; the webhook finalizes the
 *   order on checkout.session.async_payment_succeeded.
 * - status "complete" + paid            → resolve the order and redirect to the
 *   order confirmation page (existing path, unchanged).
 *
 * WC 10.8+ compatibility: when session.orderId is "0" or empty (deferred draft
 * order creation), the Stripe session was created before the WC draft order
 * existed. In this case we call processCheckoutAction with payment_data from the
 * Stripe session to create-and-finalize the order, then redirect using the real
 * orderId returned by WooCommerce. The Stripe webhook does the same thing
 * asynchronously; whichever runs first wins (WC POST /checkout is safe to call
 * once the cart is active).
 *
 * That finalize can itself be refused after the payment: `ORDER_REFUSED`
 * (terminal, refunded → <OrderRefused>) or `ORDER_VALIDATION` (one detail to
 * correct, still paid → <CompleteOrder>, which retries the same session). Any
 * other failure keeps the poll-the-session path, and the last resort is the
 * processing screen — never the error boundary.
 */

/** Where the page should send (or render) the shopper, computed inside the
 * try block and acted on AFTER the try/catch — Next's redirect() signals by
 * throwing NEXT_REDIRECT, and a catch{} around it would swallow that throw
 * (the ISSUE-001 bug). */
type Disposition =
  | "order" // paid + order resolved → confirmation page
  | "retry" // session open (failed/canceled) → /checkout?error=payment_failed
  | "expired" // session expired → /checkout?error=session_expired
  | "cart_changed" // deliberately expired: cart drifted (ENG-784) → /checkout?error=cart_changed
  | "stock_retry" // auth released for sold-out → /checkout (alerts via correctCartAtEntry)
  | "order_refused" // paid, then WooCommerce refused + commerce refunded → render UI
  | "order_validation" // paid, then WooCommerce refused ONE detail → render the complete-order form
  | "pending" // async payment processing (or paid but unresolved) → render UI
  | "error"; // session fetch threw → /checkout?error=processing_error

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.session_id;

  if (!sessionId) {
    redirect("/");
  }

  let disposition: Disposition = "error";
  let resolvedOrderId: string | undefined;
  let resolvedOrderKey: string | undefined;
  let refusal: OrderRefusal | null = null;
  // Not refunded — which is why it is its own disposition, not a refusal reason.
  let validationFailure: OrderValidationFailure | null = null;
  let validationBilling: OrderValidationAddressLike | null = null;
  let validationShipping: OrderValidationAddressLike | null = null;
  let validationEmail: string | null = null;

  try {
    const session = await getCheckoutSessionAction(sessionId);

    // Commerce stamped a post-payment refusal on the session: the money is
    // already refunded or released and no order will ever exist, so no branch
    // below applies and nothing may be re-processed.
    refusal = orderRefusalFromSession(session);
    if (refusal) {
      logOrderRefusal(refusal);
      // Sold-out under authorize-first: back to checkout with per-item alerts.
      // Never PaymentProcessing, never a standalone OrderRefused dead-end.
      disposition = isStockAuthReleasedRefusal(refusal)
        ? "stock_retry"
        : "order_refused";
    } else if (session.status === "open") {
      // Payment failed or canceled (Afterpay decline/cancel returns here with
      // the session still open and remountable). Send the shopper back to
      // /checkout for an in-place retry with a fresh session + preserved cart.
      disposition = "retry";
    } else if (session.status === "expired") {
      // ENG-784: expired_reason=cart_changed means mechanism 1 deliberately
      // expired the session because the cart drifted while the shopper was
      // off-site (BNPL redirect). The cart is intact and /checkout mints a
      // fresh session on load — send them there with the cart-changed banner
      // instead of the dead-end session_expired error page.
      disposition =
        session.expiredReason === "cart_changed" ? "cart_changed" : "expired";
    } else if (session.paymentStatus === "unpaid") {
      // Authorize-first stock refuse cancels the PI before capture — never show
      // PaymentProcessing for that. Async BNPL still settling stays pending.
      if (session.paymentIntentStatus === "canceled") {
        disposition = "stock_retry";
      } else {
        disposition = "pending";
      }
    } else {
      // Session complete and paid (or no_payment_required): existing
      // order-resolution path, unchanged.
      let orderId = session.orderId;
      let orderKey = session.orderKey;

      // WC 10.8+ deferred draft order: session.orderId is "0" or empty because
      // GET /checkout returned order_id=0 at session creation time. The webhook
      // finalizes the order asynchronously, but the success page may arrive before
      // the webhook completes. Call processCheckout to create-and-finalize the
      // order immediately so the user can see their order confirmation.
      if ((!orderId || orderId === "0") && session.cartToken) {
        // `lib/checkout-payment-data.ts` owns these keys — a contract with the
        // theme, and `completeOrderAction` retries this finalize from the same
        // builder, so a retry cannot drift a key from the attempt it retries.
        const paymentData = buildStripeCartPaymentData(sessionId, session);

        // ENG-801: carry billing and shipping SEPARATELY. The session's
        // customer_details is STALE for up to tens of seconds after
        // updateBillingAddress()/confirm() (the completed EVENT is fresh but
        // this page reads via retrieve), so the checkout-written billing
        // cookie is the authoritative billing source; the session is the
        // fallback (wallet/express flows write no cookie). Shipping comes
        // from shipping_details (collected pre-payment — not lagging), with
        // billing as last resort for no-shipping carts.
        const cookieStore = await cookies();
        const billingCookie = parseBillingAddressCookie(
          cookieStore.get(BILLING_ADDRESS_COOKIE)?.value,
        );
        // Bounded re-poll only when NO cookie and the session has no billing
        // at all (e.g. wallet flows where customer_details hasn't landed yet).
        let sessionAddr = session;
        if (!billingCookie && !sessionAddr.billingAddress?.address1) {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const refreshed = await getCheckoutSessionAction(sessionId);
              if (refreshed.billingAddress?.address1) {
                sessionAddr = refreshed;
                break;
              }
            } catch {
              /* transient — keep polling */
            }
          }
        }
        const sessionBilling =
          sessionAddr.billingAddress ?? sessionAddr.shippingAddress ?? null;
        const sessionShipping =
          sessionAddr.shippingAddress ?? sessionAddr.billingAddress ?? null;
        // `lib/finalize-address.ts` owns the pair and, above all, the
        // country/state/postcode rule: fall back across every source, then
        // OMIT the field rather than send "" — an empty country is a
        // woocommerce_rest_invalid_address_country 400 AFTER the charge.
        const { billingAddress, shippingAddress } = buildFinalizeAddresses(
          { billingCookie, sessionBilling, sessionShipping },
          {
            billingEmail:
              sessionAddr.customerEmail ?? session.customerEmail ?? "",
            // The payment-step billing element returns no phone — inherit the
            // session phone (set from shipping at the delivery step).
            billingPhoneFallback: sessionBilling?.phone ?? "",
            phonePolicy: "emit-empty",
            context: "checkout/success (cart)",
          },
        );

        try {
          const checkout = await processCheckoutAction({
            paymentMethod: "headkit-payments",
            billingAddress,
            shippingAddress,
            paymentData,
          });
          if (checkout?.orderId && checkout.orderId !== "0") {
            orderId = checkout.orderId;
            orderKey = checkout.orderKey;
          }
        } catch (checkoutErr) {
          /* THIS page's own POST can be what discovers a post-payment refusal,
             and that throw is the FIRST notice — commerce refunds and only then
             stamps the session. A typed code is terminal (ORDER_REFUSED) or asks
             the shopper for one detail (ORDER_VALIDATION); anything else is
             TRANSIENT — almost always woocommerce_rest_cart_empty: the Stripe
             webhook won the race, already placed the order, and emptied the
             cart. The webhook writes the real order_id/order_key back onto the
             session metadata after creating the order, so poll the session
             below to resolve it. */
          refusal = orderRefusalFromError(checkoutErr);
          if (refusal) {
            logOrderRefusal(refusal);
          } else {
            validationFailure = orderValidationFromError(checkoutErr);
            if (validationFailure) {
              logOrderValidation(validationFailure);
              // The pair we actually SENT: its country is the one WooCommerce
              // rejected, and its shipping half is what the form opens with.
              validationBilling = billingAddress;
              validationShipping = shippingAddress;
              validationEmail =
                sessionAddr.customerEmail ?? session.customerEmail ?? null;
            }
          }
        }

        // Lost the create race (or our own POST hasn't reflected yet): poll the Stripe
        // session metadata, which the webhook updates with the real order_id/order_key
        // once it finishes creating the order. Bounded so we never hang the page.
        // Not after a typed refusal: polling cannot produce an order WooCommerce
        // has refused.
        if (
          !refusal &&
          !validationFailure &&
          (!orderId || orderId === "0" || !orderKey)
        ) {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const refreshed = await getCheckoutSessionAction(sessionId);
              if (
                refreshed.orderId &&
                refreshed.orderId !== "0" &&
                refreshed.orderKey
              ) {
                orderId = refreshed.orderId;
                orderKey = refreshed.orderKey;
                break;
              }
            } catch {
              /* transient — keep polling */
            }
          }
        }
      }

      if (refusal) {
        disposition = "order_refused";
      } else if (validationFailure) {
        disposition = "order_validation";
      } else if (orderId && orderId !== "0" && orderKey) {
        disposition = "order";
        resolvedOrderId = orderId;
        resolvedOrderKey = orderKey;
      } else {
        // Paid session but the order id/key never resolved after the poll loop.
        // Render the processing screen — the webhook will finalize; never bounce
        // a paid customer to the homepage.
        disposition = "pending";
      }
    }
  } catch (caught) {
    /* Session fetch failed — handled via the "error" disposition below. The
       payload is logged here, where it is known, and never travels in the
       redirect URL. */
    logCheckoutFailure("processing_error", caught);
  }

  // redirect() OUTSIDE the try/catch (it throws NEXT_REDIRECT; a catch would eat it).
  if (disposition === "order" && resolvedOrderId && resolvedOrderKey) {
    redirect(
      `/checkout/success/${resolvedOrderId}?key=${encodeURIComponent(resolvedOrderKey)}&session_id=${encodeURIComponent(sessionId)}`,
    );
  }
  if (disposition === "retry") {
    redirect("/checkout?error=payment_failed");
  }
  if (disposition === "expired") {
    redirect(checkoutFailurePath("session_expired"));
  }
  if (disposition === "cart_changed") {
    redirect("/checkout?error=cart_changed");
  }
  if (disposition === "stock_retry") {
    redirect("/checkout");
  }
  if (disposition === "error") {
    redirect(checkoutFailurePath("processing_error"));
  }

  // Terminal and rendered, never redirected: `/checkout`'s banner could not
  // tell the shopper what happened to money that already left their account.
  if (disposition === "order_refused" && refusal) {
    return <OrderRefused refusal={refusal} />;
  }

  // Terminal only until the shopper fixes it: the payment stands and the form
  // re-finalises this same paid session. `orderId` is "" because WooCommerce
  // refused before an order existed, so every sentence says "your order".
  if (disposition === "order_validation" && validationFailure) {
    return (
      <CompleteOrder
        failure={validationFailure}
        orderId=""
        orderKey=""
        sessionId={sessionId}
        shippingAddress={validationShipping}
        billingAddress={validationBilling}
        customerEmail={validationEmail}
      />
    );
  }

  // ENG-784: sessionId enables the client poller (2.5s ≤ 60s) that routes to
  // the confirmation once the webhook captures — poll-only, never captures (D4).
  return <PaymentProcessing sessionId={sessionId} />;
}

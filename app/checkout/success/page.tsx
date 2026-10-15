import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCheckoutSessionAction, processCheckoutAction } from "../actions";
import { PaymentProcessing } from "@/components/checkout/payment-processing";
import {
  BILLING_ADDRESS_COOKIE,
  parseBillingAddressCookie,
} from "@/lib/checkout-billing-cookie";
import { isStockFinalizeError } from "@/lib/checkout-stock-detect";

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
 * - status "expired"                    → /checkout/error?reason=session_expired
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
 */

/** Where the page should send (or render) the shopper, computed inside the
 * try block and acted on AFTER the try/catch — Next's redirect() signals by
 * throwing NEXT_REDIRECT, and a catch{} around it would swallow that throw
 * (the ISSUE-001 bug). */
type Disposition =
  | "order" // paid + order resolved → confirmation page
  | "retry" // session open (failed/canceled) → /checkout?error=payment_failed
  | "expired" // session expired → /checkout/error?reason=session_expired
  | "cart_changed" // deliberately expired: cart drifted (ENG-784) → /checkout?error=cart_changed
  | "pending" // async payment processing (or paid but unresolved) → render UI
  | "stock_unavailable" // paid but WC refused the order for stock → honest error
  | "error"; // session fetch threw → /checkout/error?reason=processing_error

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

  try {
    const session = await getCheckoutSessionAction(sessionId);

    if (session.status === "open") {
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
      // Session complete but the async payment method (delayed-notification
      // BNPL / bank debit) hasn't settled. The webhook finalizes the order on
      // checkout.session.async_payment_succeeded — do NOT processCheckout here.
      disposition = "pending";
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
        const paymentData: { key: string; value: string }[] = [
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
          paymentData.push({
            key: "payment_method",
            value: session.paymentMethod,
          });
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
        const billingSource = billingCookie ?? sessionBilling;
        const billingAddress = {
          firstName: billingSource?.firstName ?? "",
          lastName: billingSource?.lastName ?? "",
          address1: billingSource?.address1 ?? "",
          ...(billingSource?.address2
            ? { address2: billingSource.address2 }
            : {}),
          city: billingSource?.city ?? "",
          state: billingSource?.state ?? "",
          postcode: billingSource?.postcode ?? "",
          country: billingSource?.country ?? "",
          email: sessionAddr.customerEmail ?? session.customerEmail ?? "",
          // The payment-step billing element returns no phone — inherit the
          // session phone (set from shipping at the delivery step).
          phone: billingSource?.phone || sessionBilling?.phone || "",
        };
        const shippingAddress = {
          firstName: sessionShipping?.firstName ?? "",
          lastName: sessionShipping?.lastName ?? "",
          address1: sessionShipping?.address1 ?? "",
          ...(sessionShipping?.address2
            ? { address2: sessionShipping.address2 }
            : {}),
          city: sessionShipping?.city ?? "",
          state: sessionShipping?.state ?? "",
          postcode: sessionShipping?.postcode ?? "",
          country: sessionShipping?.country ?? "",
          phone: sessionShipping?.phone ?? "",
        };

        let processCheckoutError: unknown = null;
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
        } catch (err) {
          processCheckoutError = err;
          /* processCheckout failed — almost always woocommerce_rest_cart_empty: the
             Stripe webhook won the race, already placed the order, and emptied the
             cart. The webhook writes the real order_id/order_key back onto the session
             metadata after creating the order, so poll the session below to resolve it.
             Stock refusals are the other common case: do NOT treat those as pending. */
        }

        // Stock refusal: no webhook will create an order for this cart. Surfacing
        // the async processing UI here is the bug the confirm-time stock gate
        // also prevents — keep this as a backstop when the race still charges.
        if (isStockFinalizeError(processCheckoutError)) {
          disposition = "stock_unavailable";
        } else {
          // Lost the create race (or our own POST hasn't reflected yet): poll the Stripe
          // session metadata, which the webhook updates with the real order_id/order_key
          // once it finishes creating the order. Bounded so we never hang the page.
          if (!orderId || orderId === "0" || !orderKey) {
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
      }

      if (disposition === "stock_unavailable") {
        // already set — do not fall through to pending
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
  } catch {
    /* Session fetch failed — handled via the "error" disposition below. */
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
    redirect("/checkout/error?reason=session_expired");
  }
  if (disposition === "cart_changed") {
    redirect("/checkout?error=cart_changed");
  }
  if (disposition === "stock_unavailable") {
    redirect("/checkout/error?reason=stock_unavailable");
  }
  if (disposition === "error") {
    redirect("/checkout/error?reason=processing_error");
  }

  // ENG-784: sessionId enables the client poller (2.5s ≤ 60s) that routes to
  // the confirmation once the webhook captures — poll-only, never captures (D4).
  return <PaymentProcessing sessionId={sessionId} />;
}

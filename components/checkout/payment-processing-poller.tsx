"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCheckoutSessionAction } from "@/app/checkout/actions";
import {
  checkoutFailurePath,
  logCheckoutFailure,
} from "@/lib/checkout-failure";
import {
  orderRefusalFromSession,
  type OrderRefusal,
} from "@/lib/order-refusal";
import { OrderRefused } from "@/components/checkout/order-refused";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Client poller mounted by <PaymentProcessing> while a session is pending
 * (async BNPL settling, or manual capture in flight — ENG-784, D4).
 *
 * Polls the Stripe session every 2.5s for up to 60s and acts on the first
 * terminal state:
 *  - post-payment order refusal (`session.orderFailure`) → render
 *    <OrderRefused> in place of `children`. Checked FIRST: a refused session
 *    can also read `paid`, and it is the refusal that decides the screen. It
 *    is rendered rather than routed because a `router.replace` back to the
 *    same return URL would re-render "processing" on the way.
 *  - paid + REAL orderId/orderKey → order confirmation page
 *  - paymentIntentStatus "canceled" (mechanism 2 canceled a mismatched
 *    authorization) → /checkout?error=payment_canceled
 *  - session expired → /checkout?error=session_expired
 *  - timeout → stop polling; the static reassurance copy stays on screen and
 *    the webhook/email confirms asynchronously.
 *
 * Cancel and expiry are RECOVERABLE: nothing was captured and the WooCommerce
 * cart is intact, so the shopper goes back to `/checkout`, which mints a fresh
 * session and shows the banner. The poller cannot read the cart, so it never
 * decides a dead end — `/checkout` does (`lib/checkout-failure.ts`).
 *
 * D4: the webhook is the SOLE capture authority — this component only READS
 * session state. It never captures, confirms, processes or refunds.
 */
export function PaymentProcessingPoller({
  sessionId,
  children,
}: {
  sessionId: string;
  /** The processing screen, shown until a refusal replaces it. */
  children?: React.ReactNode;
}): React.ReactNode {
  const router = useRouter();
  const [refusal, setRefusal] = useState<OrderRefusal | null>(null);

  useEffect(() => {
    if (refusal) return;
    let cancelled = false;
    let inFlight = false;
    const startedAt = Date.now();

    const intervalId = setInterval(() => {
      if (cancelled || inFlight) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        clearInterval(intervalId);
        return;
      }
      inFlight = true;
      getCheckoutSessionAction(sessionId)
        .then((session) => {
          if (cancelled) return;
          const refused = orderRefusalFromSession(session);
          if (refused) {
            // Not logged here: this runs in the shopper's browser, and the
            // refusal's ids belong in server logs (commerce records them).
            clearInterval(intervalId);
            setRefusal(refused);
            return;
          }
          if (
            session.paymentStatus === "paid" &&
            session.orderId &&
            session.orderId !== "0" &&
            session.orderKey
          ) {
            router.replace(
              `/checkout/success/${encodeURIComponent(session.orderId)}?key=${encodeURIComponent(session.orderKey)}&session_id=${encodeURIComponent(sessionId)}`,
            );
            return;
          }
          if (session.paymentIntentStatus === "canceled") {
            logCheckoutFailure("payment_canceled");
            router.replace(checkoutFailurePath("payment_canceled"));
            return;
          }
          if (session.status === "expired") {
            logCheckoutFailure("session_expired");
            router.replace(checkoutFailurePath("session_expired"));
          }
        })
        .catch(() => {
          /* transient — keep polling */
        })
        .finally(() => {
          inFlight = false;
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [sessionId, router, refusal]);

  if (refusal) return <OrderRefused refusal={refusal} />;
  return children ?? null;
}

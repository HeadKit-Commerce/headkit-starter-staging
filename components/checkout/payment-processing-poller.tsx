"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getCheckoutSessionAction } from "@/app/checkout/actions";
import {
  checkoutFailurePath,
  logCheckoutFailure,
} from "@/lib/checkout-failure";
import {
  isStockAuthReleasedRefusal,
  orderRefusalFromSession,
  sessionPaymentMethodType,
  stockRetryPath,
  type OrderRefusal,
} from "@/lib/order-refusal";
import { OrderRefused } from "@/components/checkout/order-refused";
import { PaymentProcessingTimedOut } from "@/components/checkout/payment-processing-timed-out";

const POLL_INTERVAL_MS = 2_500;
/** BNPL + claim-before-capture can take longer than a card settle. */
const POLL_TIMEOUT_MS = 120_000;
/** After the fast window: still listening, at a cadence that costs little. */
const SLOW_POLL_INTERVAL_MS = 15_000;
/** When the background checks stop; "Check again" still works after it. */
const SLOW_POLL_TIMEOUT_MS = 15 * 60_000;

/**
 * Client poller mounted by <PaymentProcessing> while a session is pending
 * (async BNPL settling, or manual capture / claim-before-capture in flight).
 *
 * Polls immediately on mount, then every 2.5s for up to 120s, and acts on the
 * first terminal state:
 *  - stock auth released (`orderFailure` + authorization_released or
 *    authorization_release_pending + out of stock) → `/checkout` immediately
 *    so `correctCartAtEntry` shows sold-out alerts. Never leave the shopper on
 *    this processing screen for that case. Each read of a release-pending
 *    session is also what makes commerce release it (the shopper is back).
 *  - other post-payment order refusal (`session.orderFailure`) → render
 *    <OrderRefused> in place of `children`.
 *  - paid + REAL orderId/orderKey → order confirmation page
 *  - paymentIntentStatus "canceled" (auth released before session stamp) →
 *    `/checkout` (cart intact; sold-out correction happens at entry)
 *  - session expired → /checkout?error=session_expired
 *  - timeout (`POLL_TIMEOUT_MS`) → the processing screen is replaced by
 *    <PaymentProcessingTimedOut>, whose copy is true whether the payment is
 *    still settling or its hold was released, plus a "Check again" button.
 *    Checks continue every 15s for up to 15 minutes behind it, so a late
 *    commerce stamp (a refused capture, `headkit_capture_refused`) or a late
 *    paid order still routes immediately. The static "this usually takes a
 *    few seconds" copy used to stay up forever here (Bike Society rehearsal,
 *    2026-10-26: a refused Afterpay capture left it on screen for good).
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
  orderId,
  children,
}: {
  sessionId: string;
  /** Named on the timed-out screen's contact line, when the order is known. */
  orderId?: string | undefined;
  /** The processing screen, shown until a refusal replaces it. */
  children?: React.ReactNode;
}): React.ReactNode {
  const router = useRouter();
  const [refusal, setRefusal] = useState<OrderRefusal | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (refusal) return;
    let cancelled = false;
    let done = false;
    let current: Promise<void> | null = null;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const handle = (
      session: Awaited<ReturnType<typeof getCheckoutSessionAction>>,
    ) => {
      const refused = orderRefusalFromSession(session);
      if (refused) {
        stop();
        if (isStockAuthReleasedRefusal(refused)) {
          router.replace(stockRetryPath(refused.paymentMethodType));
          return;
        }
        setRefusal(refused);
        return;
      }
      if (
        session.paymentStatus === "paid" &&
        session.orderId &&
        session.orderId !== "0" &&
        session.orderKey
      ) {
        stop();
        router.replace(
          `/checkout/success/${encodeURIComponent(session.orderId)}?key=${encodeURIComponent(session.orderKey)}&session_id=${encodeURIComponent(sessionId)}`,
        );
        return;
      }
      if (session.paymentIntentStatus === "canceled") {
        // Auth released (stock or amount) — back to checkout, not a
        // "payment cancelled / cart changed" banner that skips sold-out alerts.
        stop();
        logCheckoutFailure("payment_canceled");
        router.replace(stockRetryPath(sessionPaymentMethodType(session)));
        return;
      }
      if (session.status === "expired") {
        stop();
        logCheckoutFailure("session_expired");
        router.replace(checkoutFailurePath("session_expired"));
      }
    };

    // One read at a time: a "Check again" during a scheduled read joins it.
    const read = (): Promise<void> => {
      if (cancelled || done) return Promise.resolve();
      if (current) return current;
      current = getCheckoutSessionAction(sessionId)
        .then((session) => {
          if (!cancelled) handle(session);
        })
        .catch(() => {
          /* transient — keep polling */
        })
        .finally(() => {
          current = null;
        });
      return current;
    };

    const schedule = () => {
      if (cancelled || done) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_TIMEOUT_MS) setTimedOut(true);
      if (elapsed >= SLOW_POLL_TIMEOUT_MS) return;
      const delay =
        elapsed >= POLL_TIMEOUT_MS ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
      timer = setTimeout(() => {
        void read().then(schedule);
      }, delay);
    };

    checkNow.current = () => {
      setChecking(true);
      void read().finally(() => {
        if (!cancelled) setChecking(false);
      });
    };

    // First read immediately — do not leave the shopper on "processing" for
    // a full interval after Afterpay already returned.
    void read().then(schedule);

    return () => {
      cancelled = true;
      checkNow.current = null;
      stop();
    };
  }, [sessionId, router, refusal]);

  if (refusal) return <OrderRefused refusal={refusal} />;
  if (timedOut) {
    return (
      <PaymentProcessingTimedOut
        orderId={orderId}
        checking={checking}
        onCheckAgain={() => checkNow.current?.()}
      />
    );
  }
  return children ?? null;
}

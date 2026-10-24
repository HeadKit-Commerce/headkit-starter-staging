import Link from "next/link";
import { PaymentProcessingPoller } from "@/components/checkout/payment-processing-poller";

/**
 * Server-rendered pending/processing screen for async payment methods (session
 * complete but payment_status unpaid) and for the paid-but-unresolved-order
 * fallback — a paying customer must never be silently bounced to the homepage.
 * Used by both checkout return pages (/checkout/success and
 * /checkout/success/[orderId], ENG-789).
 *
 * ENG-784: when `sessionId` is provided, a client poller upgrades this static
 * screen — it polls the session every 2.5s (≤60s) and auto-routes to the order
 * confirmation once paid, or back to `/checkout` on cancel/expiry. The poller
 * only reads/routes; the webhook remains the sole capture authority (D4).
 *
 * The poller WRAPS this screen rather than sitting beside it, which is what
 * lets a post-payment order refusal replace it with no flash of "processing":
 * the poller renders `children` until the session carries an `orderFailure`,
 * then renders `<OrderRefused>` in its place.
 *
 * `orderId` adds one line naming the order. Pass it ONLY where the order is
 * known to exist and the finalize failed in a way nobody could classify — the
 * last resort of `app/checkout/success/[orderId]/page.tsx`, which used to throw
 * to the error boundary. The ordinary async-payment path passes none: there is
 * no order to name yet.
 */
export function PaymentProcessing({
  sessionId,
  orderId,
}: {
  sessionId?: string;
  orderId?: string;
} = {}): React.ReactElement {
  if (!sessionId) return <PaymentProcessingScreen orderId={orderId} />;
  return (
    <PaymentProcessingPoller sessionId={sessionId}>
      <PaymentProcessingScreen orderId={orderId} />
    </PaymentProcessingPoller>
  );
}

/** The static screen, held as the poller's `children`. */
function PaymentProcessingScreen({
  orderId,
}: {
  orderId?: string | undefined;
}): React.ReactElement {
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="bg-white rounded-lg shadow-lg p-8 text-center space-y-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-16 h-16 mx-auto text-blue-500"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        <h1 className="text-2xl text-gray-900">Checking availability</h1>
        <p className="text-gray-600">
          We&apos;re confirming the items are still in stock before taking
          payment. This usually takes a few seconds. If something sold out,
          you&apos;ll return to checkout and won&apos;t be charged.
        </p>

        {orderId ? (
          <p className="text-gray-600 text-sm">
            If this takes more than a minute,{" "}
            <Link href="/contact" className="underline">
              contact us
            </Link>{" "}
            and quote order #{orderId}.
          </p>
        ) : null}

        <Link href="/" className="inline-block text-blue-600 underline text-sm">
          Return to Home
        </Link>
      </div>
    </div>
  );
}

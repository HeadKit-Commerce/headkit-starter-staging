import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * What "Confirming your payment" becomes once the poller's fast window
 * (`POLL_TIMEOUT_MS`) runs out with nothing terminal on the session.
 *
 * Every sentence must be TRUE IN EVERY TIMEOUT CASE, because the poller cannot
 * tell them apart: the payment may still be settling with the provider, or
 * commerce may have released the hold (a refused capture whose refusal stamp
 * has not reached this page yet, or a store on an older commerce that never
 * stamps one). So it never claims the order succeeded or failed, never names
 * an amount, and promises only what holds either way — one charge at most for
 * this order, and an email if the order is confirmed. The poller keeps
 * checking behind it and replaces it the moment anything terminal arrives.
 *
 * Forks match this copy verbatim (the Bike Society storefront does); change
 * the exported constants, not the JSX, and say so in the PR.
 */

/** The heading shown after the poller's fast window runs out. */
export const PAYMENT_TIMED_OUT_HEADING = "We're still confirming your payment";

/** The first body line: what may be happening, without picking one. */
export const PAYMENT_TIMED_OUT_BODY =
  "This is taking longer than usual. Your payment may still be settling with your provider, or the hold on it may have been released.";

/** The second body line: what the shopper can rely on either way. */
export const PAYMENT_TIMED_OUT_REASSURANCE =
  "If your order is confirmed, we'll email you the confirmation. You won't be charged twice for this order.";

/** The button that runs another check straight away. */
export const PAYMENT_TIMED_OUT_CHECK_AGAIN = "Check again";

export function PaymentProcessingTimedOut({
  orderId,
  checking,
  onCheckAgain,
}: {
  orderId?: string | undefined;
  /** A check is in flight: the button is disabled and says so. */
  checking: boolean;
  onCheckAgain: () => void;
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

        <h1 className="text-2xl text-gray-900">{PAYMENT_TIMED_OUT_HEADING}</h1>
        <p className="text-gray-600">{PAYMENT_TIMED_OUT_BODY}</p>
        <p className="text-gray-600">{PAYMENT_TIMED_OUT_REASSURANCE}</p>

        <Button
          type="button"
          className="w-full"
          disabled={checking}
          aria-busy={checking}
          onClick={onCheckAgain}
        >
          {checking ? "Checking…" : PAYMENT_TIMED_OUT_CHECK_AGAIN}
        </Button>

        {orderId ? (
          <p className="text-gray-600 text-sm">
            Need help?{" "}
            <Link href="/contact" className="underline">
              Contact us
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

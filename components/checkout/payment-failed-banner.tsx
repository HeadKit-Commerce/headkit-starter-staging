"use client";

import { useState } from "react";
import { CHECKOUT_BANNER_COPY } from "@/lib/checkout-failure";

/**
 * Dismissible payment-failed banner shown at the top of /checkout when the
 * shopper returns from a failed/canceled payment (?error=payment_failed —
 * e.g. an Afterpay decline, ENG-789). No retry wiring is needed here: the
 * checkout page has already created a fresh Stripe session on load and the
 * cart is preserved, so the shopper simply pays again below.
 */
export function PaymentFailedBanner(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <p className="flex-1 text-sm text-red-700">
          {CHECKOUT_BANNER_COPY.payment_failed}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100 hover:text-red-700"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

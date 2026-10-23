"use client";

import { useState } from "react";
import { CHECKOUT_BANNER_COPY } from "@/lib/checkout-failure";

/**
 * Dismissible cart-changed banner shown at the top of /checkout (ENG-784).
 * Two triggers:
 *  - `?error=cart_changed` — a BNPL/redirect return found the session expired
 *    with expired_reason=cart_changed (mechanism 1 fired while the shopper was
 *    off-site). The checkout page has already minted a fresh session on load
 *    and the cart is intact, so the shopper reviews and pays again below.
 *  - the live refresh notice — a dead session was detected mid-checkout and
 *    auto-recreated in place (refreshSession with notice: "cart_changed").
 */
export function CartChangedBanner(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
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
        <p className="flex-1 text-sm text-amber-800">
          {CHECKOUT_BANNER_COPY.cart_changed}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
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

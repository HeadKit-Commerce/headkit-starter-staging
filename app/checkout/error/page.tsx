"use client";

import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import {
  checkoutDeadEndContent,
  isCheckoutBagReason,
  logCheckoutFailure,
} from "@/lib/checkout-failure";

/**
 * The checkout DEAD END: reached only when there is nothing left to retry.
 *
 * Every recoverable failure returns to `/checkout` with a banner instead
 * (`lib/checkout-failure.ts` owns which is which, and the copy for both). The
 * reasons that still land here mean the shopper's cart is gone, so the action
 * is a way back into the shop, not a "Try Again" that would bounce straight
 * off `/checkout`'s own empty-cart gate.
 *
 * The two STOCK reasons are not rendered at all (checkout plan v3 §2.3: no
 * stock refusal ends on an error screen). An old link or a tab opened before
 * that change can still carry one, so it is forwarded to the bag with the
 * generic alert. `isCheckoutBagReason` decides.
 *
 * NO TECHNICAL DETAIL IS RENDERED HERE. Callers no longer put a payload in the
 * URL; if a legacy link still carries `?error=` / `?message=` it is logged
 * once and never displayed. Do not reintroduce a details toggle, and do not
 * read those params for anything but that log line.
 *
 * It never redirects to `/checkout`: `/checkout` may send a shopper here, so a
 * redirect back is the one arrangement that can loop. The bag forward goes to
 * `/`, which never sends anyone back here.
 */
function ErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setBagAlerts, toggleCart } = useCartContext();
  const logged = useRef(false);

  const reason = searchParams.get("reason") ?? undefined;
  const toBag = isCheckoutBagReason(reason);
  // Read ONLY to log. Never rendered — see the docblock above.
  const legacyDetails =
    searchParams.get("error") ?? searchParams.get("message") ?? undefined;
  const { title, body, action } = checkoutDeadEndContent(reason);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    logCheckoutFailure(reason, legacyDetails);
  }, [reason, legacyDetails]);

  useEffect(() => {
    if (!toBag) return;
    setBagAlerts([{ kind: "unnamed" }]);
    toggleCart(true);
    router.replace("/");
  }, [toBag, setBagAlerts, toggleCart, router]);

  if (toBag) return null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="bg-white rounded-lg shadow-lg p-8 text-center space-y-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-16 h-16 mx-auto text-amber-500"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>

        <h1 className="text-2xl text-gray-900">{title}</h1>
        <p className="text-gray-600">{body}</p>

        <div className="space-y-4">
          {action === "checkout" ? (
            <Button onClick={() => router.push("/checkout")} className="w-full">
              Return to checkout
            </Button>
          ) : (
            <Button onClick={() => router.push("/shop")} className="w-full">
              Back to shop
            </Button>
          )}
          {/* The cart is a drawer in the root layout, not a route. */}
          <Button
            onClick={() => toggleCart(true)}
            variant="secondary"
            className="w-full"
          >
            View cart
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-500">Loading…</p>
          </div>
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}

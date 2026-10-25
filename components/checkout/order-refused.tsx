import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  orderRefusalBody,
  orderRefusalMoneySentence,
  type OrderRefusal,
} from "@/lib/order-refusal";

/**
 * The screen a shopper sees when they paid and WooCommerce then refused the
 * order — the one case where "Your payment is processing" was false, because
 * commerce has already refunded (or released) the payment and no order will
 * ever appear. Rendered by both checkout return pages, by the processing
 * poller in place when a refusal lands mid-poll, and by the complete-order
 * form when its retry is refused.
 *
 * It reuses `payment-processing.tsx`'s shell — same container, card, icon size
 * and heading — so a processing screen that swaps to this one reads as one
 * page changing its mind.
 *
 * NO TECHNICAL DETAIL IS RENDERED: not the WooCommerce code, not the refund
 * id, not the session id. Those are logged with `logOrderRefusal` where the
 * refusal is detected — never from this render, which can run on the client
 * and re-run on every re-render. `lib/order-refusal.ts` owns every sentence.
 *
 * "Return to checkout" is a real retry: the WooCommerce cart is untouched by
 * the refusal and `/checkout` mints a fresh Stripe session on every load,
 * correcting the cart's stock on the way in.
 */
export function OrderRefused({
  refusal,
  amount,
}: {
  refusal: OrderRefusal;
  /** A formatted total the caller trusts as the charge. See `lib/order-refusal.ts`. */
  amount?: string | undefined;
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
          className="w-16 h-16 mx-auto text-amber-500"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>

        <h1 className="text-2xl text-gray-900">
          We couldn&apos;t place your order
        </h1>
        <p className="text-gray-600">{orderRefusalBody(refusal)}</p>
        <p className="text-gray-600">
          {orderRefusalMoneySentence(
            refusal.refundStatus,
            amount,
            refusal.paymentMethodType,
          )}
        </p>

        <div className="space-y-4">
          <Button asChild className="w-full">
            <Link href="/checkout">Return to checkout</Link>
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/shop">Back to shop</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

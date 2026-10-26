import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  expireCheckoutSessionAction,
  getCheckoutSessionAction,
} from "@/app/checkout/actions";
import { getFullCartAction } from "@/lib/cart-actions";
import { validateCartStock } from "@/lib/cart-validation";
import { correctCartAtEntry } from "@/lib/checkout-stock-entry";
import { sessionReturn } from "@/lib/checkout-return";
import { checkoutFailurePath } from "@/lib/checkout-failure";
import { bagUrl, BAG_ALERTS_PARAM, type StockAlert } from "@/lib/stock-hold";

/**
 * Stripe's custom-mode return bridge forwards here while the Checkout
 * Session is still open (`returned_from_redirect` + `return_url`). The
 * loading state is "Checking stock availability". A bag that no longer fits
 * is expired only after this page has the shopper, then sent to checkout
 * with the sold-out alert. A paid session continues to /checkout/success.
 */
export default async function CheckoutReturningPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  await connection();
  const { session_id: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/");
  }

  let session: Awaited<ReturnType<typeof getCheckoutSessionAction>>;
  try {
    session = await getCheckoutSessionAction(sessionId);
  } catch {
    redirect(checkoutFailurePath("processing_error"));
  }

  const plan = sessionReturn(session);
  if (plan.to === "success" || plan.to === "refused") {
    redirect(`/checkout/success?session_id=${encodeURIComponent(sessionId)}`);
  }
  if (plan.to === "cart_changed") {
    redirect("/checkout?error=cart_changed");
  }
  if (plan.to === "session_expired") {
    redirect(checkoutFailurePath("session_expired"));
  }
  if (plan.to === "stock") {
    redirect("/checkout");
  }

  const cart = await getFullCartAction();
  if (cart && cart.itemsCount > 0) {
    const validation = validateCartStock(cart.items);
    if (!validation.isValid) {
      await expireCheckoutSessionAction(sessionId, "STOCK_UNAVAILABLE");
      const alerts: StockAlert[] = [];
      const next = await correctCartAtEntry(cart, alerts);
      if (next.itemsCount === 0) {
        redirect(bagUrl(alerts));
      }
      const params = new URLSearchParams({
        [BAG_ALERTS_PARAM]: JSON.stringify(alerts),
      });
      redirect(`/checkout?${params.toString()}`);
    }
  }

  redirect("/checkout?error=payment_failed");
}

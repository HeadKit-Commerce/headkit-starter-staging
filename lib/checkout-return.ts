import {
  isStockAuthReleasedRefusal,
  orderRefusalFromSession,
  type OrderRefusalSessionLike,
} from "./order-refusal";

/**
 * Where an Afterpay (or any other redirect-method) return goes before the
 * cart is read. An open, unpaid session still has to look at the bag: that
 * is "check_cart", and the page expires the session only when the bag no
 * longer fits.
 */
export type SessionReturn =
  | { to: "success" }
  | { to: "stock" }
  | { to: "check_cart" }
  | { to: "cart_changed" }
  | { to: "session_expired" }
  | { to: "refused" };

export interface CheckoutReturnSession extends OrderRefusalSessionLike {
  status: string;
  paymentStatus: string;
  expiredReason?: string | null;
}

export function sessionReturn(session: CheckoutReturnSession): SessionReturn {
  const refusal = orderRefusalFromSession(session);
  if (refusal) {
    return isStockAuthReleasedRefusal(refusal)
      ? { to: "stock" }
      : { to: "refused" };
  }
  if (
    session.status === "open" &&
    session.paymentStatus !== "paid" &&
    session.paymentStatus !== "no_payment_required"
  ) {
    return { to: "check_cart" };
  }
  if (session.status === "expired") {
    if (session.expiredReason === "cart_changed") return { to: "cart_changed" };
    if (session.expiredReason === "stock_unavailable") return { to: "stock" };
    return { to: "session_expired" };
  }
  return { to: "success" };
}

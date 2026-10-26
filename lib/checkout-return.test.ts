import { describe, expect, it } from "vitest";
import { sessionReturn } from "./checkout-return";

const open = {
  status: "open",
  paymentStatus: "unpaid",
  orderFailure: null,
};

describe("sessionReturn", () => {
  it("checks the bag when Afterpay sends an open unpaid session back", () => {
    expect(sessionReturn(open)).toEqual({ to: "check_cart" });
  });

  it("sends a paid session on to the order page", () => {
    expect(
      sessionReturn({ ...open, status: "complete", paymentStatus: "paid" }),
    ).toEqual({ to: "success" });
  });

  it("treats a stock expiry as the sold-out return", () => {
    expect(
      sessionReturn({
        ...open,
        status: "expired",
        expiredReason: "stock_unavailable",
      }),
    ).toEqual({ to: "stock" });
  });

  it("keeps a cart-changed expiry on its own banner", () => {
    expect(
      sessionReturn({
        ...open,
        status: "expired",
        expiredReason: "cart_changed",
      }),
    ).toEqual({ to: "cart_changed" });
  });

  it("sends a sold-out refusal to the checkout alerts, refund stamp or not", () => {
    for (const refundStatus of [
      "authorization_released",
      "succeeded",
      "pending",
    ]) {
      expect(
        sessionReturn({
          ...open,
          status: "complete",
          paymentStatus: "paid",
          orderFailure: {
            reason: "woocommerce_rest_product_out_of_stock",
            message:
              "This item sold out before the payment could be completed.",
            refundStatus,
          },
        }),
      ).toEqual({ to: "stock" });
    }
  });

  it("keeps a non-stock refusal on the refusal page", () => {
    expect(
      sessionReturn({
        ...open,
        status: "complete",
        paymentStatus: "paid",
        orderFailure: {
          reason: "woocommerce_rest_cart_coupon_error",
          refundStatus: "succeeded",
        },
      }),
    ).toEqual({ to: "refused" });
  });
});

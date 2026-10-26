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

  it("sends a released authorization back to the bag", () => {
    expect(
      sessionReturn({
        ...open,
        status: "complete",
        paymentStatus: "unpaid",
        orderFailure: {
          reason: "woocommerce_rest_product_out_of_stock",
          refundStatus: "authorization_released",
        },
      }),
    ).toEqual({ to: "stock" });
  });

  it("keeps a captured-then-refunded refusal on the refusal page", () => {
    expect(
      sessionReturn({
        ...open,
        status: "complete",
        paymentStatus: "paid",
        orderFailure: {
          reason: "woocommerce_rest_product_out_of_stock",
          refundStatus: "succeeded",
        },
      }),
    ).toEqual({ to: "refused" });
  });
});

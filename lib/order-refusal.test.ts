import { describe, expect, it } from "vitest";
import { ConnectionError, GraphQLError } from "@headkit/sdk";
import {
  ORDER_REFUSAL_FALLBACK_BODY,
  ORDER_REFUSAL_REASON_COPY,
  UNNAMED_ORDER_REFUSAL_REASON,
  isStockAuthReleasedRefusal,
  orderRefusalBody,
  orderRefusalFromError,
  orderRefusalFromSession,
  orderRefusalMoneySentence,
  parseReleasedBy,
  stockRetryPath,
} from "./order-refusal";

describe("orderRefusalFromSession", () => {
  it("is null for every healthy session, so no other disposition moves", () => {
    expect(orderRefusalFromSession(null)).toBeNull();
    expect(orderRefusalFromSession({})).toBeNull();
    expect(orderRefusalFromSession({ orderFailure: null })).toBeNull();
  });

  it("carries the stamped refusal", () => {
    expect(
      orderRefusalFromSession({
        orderFailure: {
          reason: "woocommerce_rest_product_out_of_stock",
          message: null,
          refundId: "re_1",
          refundStatus: "succeeded",
          occurredAt: "2026-10-16T00:00:00Z",
        },
      }),
    ).toEqual({
      reason: "woocommerce_rest_product_out_of_stock",
      message: null,
      refundId: "re_1",
      refundStatus: "succeeded",
      occurredAt: "2026-10-16T00:00:00Z",
    });
  });

  it("still reads as a refusal when commerce named no code", () => {
    expect(
      orderRefusalFromSession({ orderFailure: { reason: " " } })?.reason,
    ).toBe(UNNAMED_ORDER_REFUSAL_REASON);
  });
});

describe("orderRefusalFromError", () => {
  const refused = new GraphQLError([
    {
      message: "order refused",
      extensions: {
        code: "ORDER_REFUSED",
        reason: "woocommerce_rest_cart_coupon_error",
      },
    },
  ]);

  it("reads the typed code off the SDK error", () => {
    expect(orderRefusalFromError(refused)).toEqual({
      reason: "woocommerce_rest_cart_coupon_error",
    });
  });

  it("reads it through a wrapping cause", () => {
    expect(
      orderRefusalFromError(new ConnectionError("wrapped", refused)),
    ).toEqual({ reason: "woocommerce_rest_cart_coupon_error" });
  });

  it("is null for a transient failure and for the sibling code", () => {
    expect(orderRefusalFromError(new Error("cart empty"))).toBeNull();
    expect(orderRefusalFromError("boom")).toBeNull();
    expect(orderRefusalFromError(undefined)).toBeNull();
    expect(
      orderRefusalFromError(
        new GraphQLError([
          { message: "x", extensions: { code: "ORDER_VALIDATION" } },
        ]),
      ),
    ).toBeNull();
  });
});

describe("copy", () => {
  it("prefers WooCommerce's own sentence, then the reason, then a fallback", () => {
    expect(
      orderRefusalBody({ reason: "anything", message: " Sold out, sorry. " }),
    ).toBe("Sold out, sorry.");
    for (const [reason, sentence] of Object.entries(
      ORDER_REFUSAL_REASON_COPY,
    )) {
      expect(orderRefusalBody({ reason })).toBe(sentence);
    }
    expect(orderRefusalBody({ reason: "something_new" })).toBe(
      ORDER_REFUSAL_FALLBACK_BODY,
    );
  });

  it("never renders the code itself", () => {
    for (const reason of [
      ...Object.keys(ORDER_REFUSAL_REASON_COPY),
      "something_new",
    ]) {
      expect(orderRefusalBody({ reason })).not.toContain("woocommerce_");
    }
  });

  it("detects stock auth-released refusals for the /checkout redirect", () => {
    expect(
      isStockAuthReleasedRefusal({
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "authorization_released",
      }),
    ).toBe(true);
    expect(
      isStockAuthReleasedRefusal({
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "succeeded",
      }),
    ).toBe(false);
  });

  it("treats a pending authorization release like a released one", () => {
    expect(
      isStockAuthReleasedRefusal({
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "authorization_release_pending",
      }),
    ).toBe(true);
    expect(
      isStockAuthReleasedRefusal({
        reason: "woocommerce_rest_product_partially_out_of_stock",
        refundStatus: "authorization_release_pending",
      }),
    ).toBe(true);
    expect(
      isStockAuthReleasedRefusal({
        reason: "woocommerce_rest_cart_coupon_error",
        refundStatus: "authorization_release_pending",
      }),
    ).toBe(false);
  });

  it("never tells an Afterpay or Klarna shopper they were not charged", () => {
    for (const status of [
      "authorization_released",
      "authorization_release_pending",
    ]) {
      expect(
        orderRefusalMoneySentence(status, undefined, "afterpay_clearpay"),
      ).toBe("Any payment taken will be returned by Afterpay.");
      expect(orderRefusalMoneySentence(status, undefined, "klarna")).toBe(
        "Any payment taken will be returned by Klarna.",
      );
      expect(orderRefusalMoneySentence(status, undefined, "card")).toMatch(
        /not charged/,
      );
    }
  });

  it("sends a sold-out redirect payment back to checkout naming the provider", () => {
    expect(stockRetryPath("afterpay_clearpay")).toBe(
      "/checkout?released_by=afterpay",
    );
    expect(stockRetryPath("klarna")).toBe("/checkout?released_by=klarna");
    expect(stockRetryPath("card")).toBe("/checkout");
    expect(stockRetryPath(null)).toBe("/checkout");
    expect(parseReleasedBy("afterpay")).toBe("afterpay");
    expect(parseReleasedBy("zip")).toBeNull();
    expect(parseReleasedBy(undefined)).toBeNull();
  });

  it("reads the confirmed payment method from the session", () => {
    expect(
      orderRefusalFromSession({
        paymentMethodType: "afterpay_clearpay",
        orderFailure: {
          reason: "woocommerce_rest_product_out_of_stock",
          refundStatus: "authorization_release_pending",
        },
      })?.paymentMethodType,
    ).toBe("afterpay_clearpay");
  });

  it("says what happened to the money by refund status", () => {
    expect(orderRefusalMoneySentence("authorization_released")).toMatch(
      /not charged/,
    );
    expect(orderRefusalMoneySentence("succeeded")).toMatch(/has been refunded/);
    expect(orderRefusalMoneySentence("pending")).toBe(
      orderRefusalMoneySentence("succeeded"),
    );
    expect(orderRefusalMoneySentence(null)).toMatch(/being refunded/);
    expect(orderRefusalMoneySentence("succeeded", "$12.00")).toContain(
      "Your payment of $12.00 has been refunded",
    );
    // An amount is never spliced into a sentence that does not claim a refund.
    expect(orderRefusalMoneySentence(null, "$12.00")).not.toContain("$12.00");
  });
});

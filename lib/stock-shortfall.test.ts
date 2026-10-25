import { describe, expect, it } from "vitest";
import {
  stockShortfallNotice,
  type StockShortfall,
} from "@/lib/stock-shortfall";

/**
 * The success page's sold-out alert (checkout plan v3 §3). The shapes are the
 * ones the theme's fail-over records (tests/stock-failover-harness.php) after
 * commerce renders them as Order.stockShortfall.
 */

const partial: StockShortfall = {
  refundStatus: "REFUNDED",
  fullyRefunded: false,
  refundTotal: "17.27",
  paymentRefund: "17.27",
  giftCardRefund: "0.00",
  lines: [{ name: "Base layer - M", quantity: 1 }],
};

describe("stockShortfallNotice", () => {
  it("renders nothing for an order without a shortfall, or on an older theme", () => {
    expect(stockShortfallNotice(null, "AUD")).toBeNull();
    expect(stockShortfallNotice(undefined, "AUD")).toBeNull();
    expect(stockShortfallNotice({ ...partial, lines: [] }, "AUD")).toBeNull();
  });

  it("says a held payment never charged the dropped items, and refunds nothing", () => {
    const notCharged: StockShortfall = {
      ...partial,
      refundStatus: "NOT_CHARGED",
      paymentRefund: "0.00",
    };
    const card = stockShortfallNotice(notCharged, "AUD", "card");
    expect(card?.fullyRefunded).toBe(false);
    expect(card?.title).toBe("Sorry — part of your order sold out");
    expect(card?.body).toBe(
      "Base layer - M sold out before your payment was taken, so you were not charged for it. The rest of your order is confirmed below.",
    );
    expect(card?.body).not.toMatch(/refund/i);

    const afterpay = stockShortfallNotice(
      { ...notCharged, lines: [{ name: "Gloves", quantity: 2 }] },
      "AUD",
      "afterpay_clearpay",
    );
    expect(afterpay?.body).toBe(
      "2 × Gloves sold out before your payment was taken, so you were not charged for them. Your Afterpay instalments are for the reduced total; Afterpay returns anything it already took for the sold-out items. The rest of your order is confirmed below.",
    );
    expect(stockShortfallNotice(notCharged, "AUD", "klarna")?.body).toContain(
      "Klarna payments are for the reduced total",
    );
  });

  it("names the sold-out line and keeps the rest confirmed", () => {
    const got = stockShortfallNotice(partial, "AUD");
    expect(got?.fullyRefunded).toBe(false);
    expect(got?.title).toBe("Sorry — part of your order sold out");
    expect(got?.body).toBe(
      "Base layer - M sold out while your payment was processing. We've refunded A$17.27 to your original payment method. The rest of your order is confirmed below.",
    );
  });

  it("says the full refund includes shipping when every line sold out", () => {
    const got = stockShortfallNotice(
      {
        ...partial,
        fullyRefunded: true,
        refundTotal: "195.00",
        paymentRefund: "195.00",
      },
      "AUD",
    );
    expect(got?.fullyRefunded).toBe(true);
    expect(got?.body).toBe(
      "The items in this order sold out while your payment was processing. We've refunded the full A$195.00, including shipping, to your original payment method.",
    );
  });

  it("phrases the refund by where it is", () => {
    expect(
      stockShortfallNotice({ ...partial, refundStatus: "PENDING" }, "AUD")
        ?.body,
    ).toContain("We're refunding A$17.27");
    expect(
      stockShortfallNotice({ ...partial, refundStatus: "FAILED" }, "AUD")?.body,
    ).toContain("Our team will refund A$17.27");
  });

  it("splits a refund between the card and a gift card", () => {
    const got = stockShortfallNotice(
      {
        ...partial,
        refundTotal: "80.00",
        paymentRefund: "70.00",
        giftCardRefund: "10.00",
      },
      "AUD",
    );
    expect(got?.body).toContain(
      "We've refunded A$80.00 — A$70.00 to your original payment method and A$10.00 to your gift card.",
    );
    const giftOnly = stockShortfallNotice(
      {
        ...partial,
        refundTotal: "50.00",
        paymentRefund: "0.00",
        giftCardRefund: "50.00",
      },
      "AUD",
    );
    expect(giftOnly?.body).toContain(
      "We've refunded A$50.00 to your gift card.",
    );
  });

  it("lists several lines and their quantities", () => {
    const got = stockShortfallNotice(
      {
        ...partial,
        lines: [
          { name: "Gel", quantity: 2 },
          { name: "Tube", quantity: 1 },
          { name: "Cap", quantity: 1 },
        ],
      },
      "AUD",
    );
    expect(got?.body.startsWith("2 × Gel, Tube and Cap sold out")).toBe(true);
  });
});

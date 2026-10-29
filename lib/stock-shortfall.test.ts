import { describe, expect, it } from "vitest";
import {
  refundMethodLabel,
  shortfallLineTag,
  shortfallMoneySummary,
  shortfallNetTax,
  shortfallStatusCopy,
  splitOrderLines,
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

  it("names the sold-out line and keeps the rest confirmed", () => {
    const got = stockShortfallNotice(partial, "AUD");
    expect(got?.fullyRefunded).toBe(false);
    expect(got?.title).toBe("Sorry — part of your order sold out");
    expect(got?.body).toBe(
      "Base layer - M sold out while your payment was processing. We've refunded $17.27 to your original payment method. The rest of your order is confirmed below.",
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
      "The items in this order sold out while your payment was processing. We've refunded the full $195.00, including shipping, to your original payment method.",
    );
  });

  it("phrases the refund by where it is", () => {
    expect(
      stockShortfallNotice({ ...partial, refundStatus: "PENDING" }, "AUD")
        ?.body,
    ).toContain("We're refunding $17.27");
    expect(
      stockShortfallNotice({ ...partial, refundStatus: "FAILED" }, "AUD")?.body,
    ).toContain("Our team will refund $17.27");
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
      "We've refunded $80.00 — $70.00 to your original payment method and $10.00 to your gift card.",
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
      "We've refunded $50.00 to your gift card.",
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

/** A A$19.95 bottle kept, two A$9.95 shock bolts sold out. */
const bottle = {
  id: "8001",
  name: "Pro Tool 750ml Storage Bottle",
  quantity: 1,
  lineTotal: 19.95,
};
const bolts = {
  id: "9001",
  name: "Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt",
  quantity: 2,
  lineTotal: 19.9,
};
const b8: StockShortfall = {
  refundStatus: "REFUNDED",
  fullyRefunded: false,
  refundTotal: "19.90",
  shippingRefund: "0.00",
  paymentRefund: "19.90",
  giftCardRefund: "0.00",
  lines: [
    { productId: "9001", name: bolts.name, quantity: 2, refundAmount: "19.90" },
  ],
};

describe("splitOrderLines", () => {
  it("keeps every line whole when there is no shortfall", () => {
    expect(splitOrderLines([bottle, bolts], null)).toEqual([
      { keptQuantity: 1, shortQuantity: 0, keptTotal: 19.95, refundedTotal: 0 },
      { keptQuantity: 2, shortQuantity: 0, keptTotal: 19.9, refundedTotal: 0 },
    ]);
  });

  it("marks only the sold-out line", () => {
    expect(splitOrderLines([bottle, bolts], b8)).toEqual([
      { keptQuantity: 1, shortQuantity: 0, keptTotal: 19.95, refundedTotal: 0 },
      { keptQuantity: 0, shortQuantity: 2, keptTotal: 0, refundedTotal: 19.9 },
    ]);
  });

  it("matches a variation line by NAME, because the record carries the variation id", () => {
    const pedals = {
      // wc/v3 `product_id`: the PARENT, never the 276074 the record carries.
      id: "276070",
      name: "Time SPECIALE 12 B1 MTB Pedals - Black/Gold, Large",
      quantity: 2,
      lineTotal: 998,
    };
    const got = splitOrderLines([pedals], {
      ...b8,
      lines: [
        {
          productId: "276074",
          name: pedals.name,
          quantity: 1,
          refundAmount: "499.00",
        },
      ],
    });
    expect(got[0]).toEqual({
      keptQuantity: 1,
      shortQuantity: 1,
      keptTotal: 499,
      refundedTotal: 499,
    });
  });

  it("falls back to the id for a simple product whose name changed", () => {
    const got = splitOrderLines(
      [bottle, { ...bolts, name: "Renamed bolt" }],
      b8,
    );
    expect(got[1]?.shortQuantity).toBe(2);
  });

  it("uses the per-unit share when the record carries no refund amount", () => {
    const got = splitOrderLines([{ ...bolts, quantity: 4, lineTotal: 39.8 }], {
      ...b8,
      lines: [{ name: bolts.name, quantity: 1 }],
    });
    expect(got[0]).toEqual({
      keptQuantity: 3,
      shortQuantity: 1,
      keptTotal: 29.85,
      refundedTotal: 9.95,
    });
  });

  it("marks every line short on a fully refunded order, whatever matching finds", () => {
    const got = splitOrderLines([bottle, { ...bolts, name: "unmatched" }], {
      ...b8,
      fullyRefunded: true,
    });
    expect(got.map((s) => s.keptQuantity)).toEqual([0, 0]);
    expect(got.map((s) => s.refundedTotal)).toEqual([19.95, 19.9]);
  });
});

describe("shortfallNetTax", () => {
  it("is the tax on what was charged, not on the original total", () => {
    // A$51.85 paid, A$19.90 refunded, order tax A$4.71. WooCommerce's refund
    // carries -A$1.81 tax, so the kept tax is 4.71 - 1.81 = A$2.90.
    expect(shortfallNetTax(b8, 51.85, 4.71)).toBe(2.9);
  });

  it("is zero on a fully refunded order", () => {
    expect(
      shortfallNetTax(
        { ...b8, fullyRefunded: true, refundTotal: "499.00" },
        499,
        45.36,
      ),
    ).toBe(0);
  });

  it("is the order's own tax when there is no shortfall", () => {
    expect(shortfallNetTax(null, 51.85, 4.71)).toBe(4.71);
    expect(shortfallNetTax(undefined, 51.85, 4.71)).toBe(4.71);
    expect(shortfallNetTax({ ...b8, lines: [] }, 51.85, 4.71)).toBe(4.71);
  });

  it("never goes negative when the record refunds more than the total", () => {
    expect(shortfallNetTax({ ...b8, refundTotal: "60.00" }, 51.85, 4.71)).toBe(
      0,
    );
  });
});

/** A fully refunded Afterpay order: one line, refunded in full. */
const fullyRefundedRecord: StockShortfall = {
  refundStatus: "REFUNDED",
  fullyRefunded: true,
  refundTotal: "499.00",
  shippingRefund: "0.00",
  paymentRefund: "499.00",
  giftCardRefund: "0.00",
  lines: [
    {
      productId: "276074",
      name: "Time SPECIALE 12 B1 MTB Pedals - Black/Gold, Large",
      quantity: 1,
      refundAmount: "499.00",
    },
  ],
};

/** One bottle kept, two shock bolts sold out. */
const boltsSoldOut: StockShortfall = {
  refundStatus: "REFUNDED",
  fullyRefunded: false,
  refundTotal: "19.90",
  shippingRefund: "0.00",
  paymentRefund: "19.90",
  giftCardRefund: "0.00",
  lines: [
    {
      productId: "9001",
      name: "Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt",
      quantity: 2,
      refundAmount: "19.90",
    },
  ],
};

describe("stockShortfallNotice — the payment method and the bolded amount", () => {
  it("names the method the money went back to", () => {
    const got = stockShortfallNotice(
      fullyRefundedRecord,
      "AUD",
      refundMethodLabel("Afterpay [Test]"),
    );
    expect(got?.title).toBe("Sorry — your items sold out");
    expect(got?.body).toBe(
      "The items in this order sold out while your payment was processing. We've refunded the full A$499.00, including shipping, to your original payment method (Afterpay).",
    );
  });

  it("is the unchanged sentence when no method is known", () => {
    expect(stockShortfallNotice(boltsSoldOut, "AUD")?.body).toBe(
      "2 × Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt sold out while your payment was processing. We've refunded A$19.90 to your original payment method. The rest of your order is confirmed below.",
    );
  });

  it("carries the formatted refund total so the page can bold it", () => {
    const got = stockShortfallNotice(boltsSoldOut, "AUD");
    expect(got?.amount).toBe("A$19.90");
    expect(got?.body).toContain(got?.amount);
  });

  it("decodes the HTML entities WooCommerce stores in line names", () => {
    const got = stockShortfallNotice(
      { ...partial, lines: [{ name: "Tyre &amp; Tube", quantity: 1 }] },
      "AUD",
    );
    expect(got?.body.startsWith("Tyre & Tube sold out")).toBe(true);
  });

  it("names the method on a split refund's card half", () => {
    expect(
      stockShortfallNotice(
        {
          ...partial,
          refundTotal: "80.00",
          paymentRefund: "70.00",
          giftCardRefund: "10.00",
        },
        "AUD",
        "Zip",
      )?.body,
    ).toContain("A$70.00 to your original payment method (Zip) and");
  });
});

describe("refundMethodLabel", () => {
  it("names the methods a shopper recognises", () => {
    expect(refundMethodLabel("Afterpay [Test]")).toBe("Afterpay");
    expect(refundMethodLabel("Afterpay_clearpay")).toBe("Afterpay");
    expect(refundMethodLabel("Klarna")).toBe("Klarna");
    expect(refundMethodLabel("Zip (Stripe)")).toBe("Zip");
    expect(refundMethodLabel("PayPal")).toBe("PayPal");
    expect(refundMethodLabel("Google Pay — Visa •••• 4242 (Stripe)")).toBe(
      "Google Pay",
    );
  });

  it("answers null for a card or an unknown title, so nothing gateway-shaped is echoed", () => {
    expect(refundMethodLabel("Visa ending 4242 (Stripe)")).toBeNull();
    expect(refundMethodLabel("HeadKit Payments")).toBeNull();
    expect(refundMethodLabel("")).toBeNull();
    expect(refundMethodLabel(null)).toBeNull();
  });
});

describe("shortfallMoneySummary", () => {
  it("is Paid / Refunded / Total charged once the refund exists", () => {
    expect(shortfallMoneySummary(fullyRefundedRecord, 499, "Afterpay")).toEqual(
      {
        paidLabel: "Paid with Afterpay",
        paid: 499,
        refundedLabel: "Refunded",
        refunded: 499,
        chargedLabel: "Total charged",
        charged: 0,
      },
    );
    expect(shortfallMoneySummary(boltsSoldOut, 51.85, null)).toMatchObject({
      paidLabel: "Paid",
      paid: 51.85,
      refunded: 19.9,
      charged: 31.95,
    });
  });

  it("does not claim the money is back while the refund is pending or owed", () => {
    expect(
      shortfallMoneySummary(
        { ...boltsSoldOut, refundStatus: "PENDING" },
        51.85,
      ),
    ).toMatchObject({
      refundedLabel: "Refund in progress",
      chargedLabel: "Total after refund",
    });
    expect(
      shortfallMoneySummary({ ...boltsSoldOut, refundStatus: "FAILED" }, 51.85),
    ).toMatchObject({
      refundedLabel: "Refund due",
      chargedLabel: "Total after refund",
    });
  });

  it("never refunds more than was paid", () => {
    expect(
      shortfallMoneySummary({ ...boltsSoldOut, refundTotal: "99.00" }, 51.85),
    ).toMatchObject({ refunded: 51.85, charged: 0 });
  });
});

describe("shortfall status copy", () => {
  it("says a fully refunded order will not ship", () => {
    expect(shortfallStatusCopy(fullyRefundedRecord)).toEqual({
      statusLabel: "Refunded",
      subline: "This order won't be shipped.",
      nextSteps:
        "Refunds can take a few business days to show on your statement. You don't need to do anything. We've also emailed you a copy of this.",
    });
    expect(
      shortfallStatusCopy({ ...fullyRefundedRecord, refundStatus: "PENDING" })
        .statusLabel,
    ).toBe("Refund pending");
  });

  it("confirms the rest of a partly refunded order, with one email", () => {
    expect(shortfallStatusCopy(boltsSoldOut)).toEqual({
      statusLabel: "Confirmed",
      subline: "We'll send one email with your order and the refund.",
      nextSteps:
        "We'll get the rest of your order ready to ship. The refund can take a few business days to show on your statement.",
    });
    expect(
      shortfallStatusCopy(boltsSoldOut, { isPickup: true }).nextSteps,
    ).toContain("ready for collection");
  });

  it("promises no refund email for a refund our team still owes", () => {
    const failed = shortfallStatusCopy({
      ...boltsSoldOut,
      refundStatus: "FAILED",
    });
    expect(failed.subline).not.toContain("refund");
    expect(failed.nextSteps).toContain("Our team will refund");
  });

  it("tags a sold-out line by where its refund is", () => {
    expect(shortfallLineTag("REFUNDED")).toBe("Sold out — refunded");
    expect(shortfallLineTag("PENDING")).toBe("Sold out — refund in progress");
    expect(shortfallLineTag("FAILED")).toBe("Sold out — refund due");
  });
});

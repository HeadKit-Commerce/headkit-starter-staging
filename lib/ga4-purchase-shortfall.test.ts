import { describe, expect, it } from "vitest";
import { buildPurchaseFromOrder } from "@/lib/ga4-ecommerce";
import type { StockShortfall } from "@/lib/stock-shortfall";
import {
  CONTAINER_ALLOWED_ECOMMERCE_KEYS,
  CONTAINER_ALLOWED_ITEM_KEYS,
  CONTAINER_PURCHASE_SHORTFALL_RULES,
  CONTAINER_REQUIRED_ECOMMERCE_KEYS,
} from "@/lib/__fixtures__/ga4-container-contract";

/**
 * GA4 `purchase` on an order whose items sold out during payment.
 *
 * WHAT THIS COVERS — `buildPurchaseFromOrder`'s shortfall arm: a fully
 * refunded order emits NO purchase (a sold-out order booked a A$499
 * conversion for money refunded five seconds later), a partly refunded one reports only
 * the kept units and the total less the refund, the payload still meets the
 * container contract, and an order without a shortfall is byte-for-byte the
 * event it always was.
 *
 * WHERE IT STOPS — nothing here pushes to `window.dataLayer` or reaches GTM;
 * the emitter's dedupe and push are `ga4-ecommerce.test.ts`'s. That the page
 * passes the record is `order-stock-shortfall.test.tsx`'s claim.
 */

/** A A$51.85 order: a A$19.95 bottle kept, two A$9.95 shock bolts sold out, A$12 shipping. */
const ORDER = {
  orderNumber: "279057",
  databaseId: "279057",
  currency: { code: "AUD" },
  coupons: [],
  totals: { totalPrice: "51.85", totalTax: "4.71" },
  items: [
    {
      id: "8001",
      name: "Pro Tool 750ml Storage Bottle",
      quantity: 1,
      sku: "PT-750",
      totals: { lineSubtotal: "18.14", lineSubtotalTax: "1.81" },
    },
    {
      id: "9001",
      name: "Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt",
      quantity: 2,
      sku: "SPZ-BOLT",
      totals: { lineSubtotal: "18.09", lineSubtotalTax: "1.81" },
    },
  ],
};

const PARTIAL: StockShortfall = {
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

describe("purchase on a stock-shortfall order", () => {
  it("emits nothing for a fully refunded order", () => {
    expect(
      buildPurchaseFromOrder(ORDER, 12, "AUD", {
        ...PARTIAL,
        fullyRefunded: true,
        refundTotal: "51.85",
        shippingRefund: "12.00",
      }),
    ).toBeNull();
  });

  it("reports only the kept lines and the kept amount on a partial refund", () => {
    const event = buildPurchaseFromOrder(ORDER, 12, "AUD", PARTIAL);
    expect(event).toEqual({
      event: "purchase",
      ecommerce: {
        transaction_id: "279057",
        currency: "AUD",
        value: 31.95,
        // 4.71 × 31.95 / 51.85, to the cent.
        tax: 2.9,
        shipping: 12,
        items: [
          {
            item_id: "PT-750",
            item_name: "Pro Tool 750ml Storage Bottle",
            price: 19.95,
            quantity: 1,
            index: 0,
          },
        ],
      },
    });
  });

  it("reports the kept units of a line that was only partly short", () => {
    const event = buildPurchaseFromOrder(ORDER, 12, "AUD", {
      ...PARTIAL,
      refundTotal: "9.95",
      lines: [{ ...PARTIAL.lines[0]!, quantity: 1, refundAmount: "9.95" }],
    });
    expect(event?.ecommerce.value).toBe(41.9);
    expect(
      event?.ecommerce.items.map((i) => [i.item_id, i.price, i.quantity]),
    ).toEqual([
      ["PT-750", 19.95, 1],
      ["SPZ-BOLT", 9.95, 1],
    ]);
  });

  it("still meets the GTM container contract", () => {
    const event = buildPurchaseFromOrder(ORDER, 12, "AUD", PARTIAL)!;
    for (const key of CONTAINER_REQUIRED_ECOMMERCE_KEYS.purchase ?? []) {
      expect(event.ecommerce).toHaveProperty(key);
    }
    for (const key of Object.keys(event.ecommerce)) {
      expect(CONTAINER_ALLOWED_ECOMMERCE_KEYS).toContain(key);
    }
    for (const item of event.ecommerce.items) {
      for (const key of Object.keys(item)) {
        expect(CONTAINER_ALLOWED_ITEM_KEYS).toContain(key);
      }
    }
  });

  it("is unchanged for an order without a shortfall", () => {
    const plain = buildPurchaseFromOrder(ORDER, 12, "AUD");
    expect(buildPurchaseFromOrder(ORDER, 12, "AUD", null)).toEqual(plain);
    expect(
      buildPurchaseFromOrder(ORDER, 12, "AUD", { ...PARTIAL, lines: [] }),
    ).toEqual(plain);
    expect(plain?.ecommerce.value).toBe(51.85);
    expect(plain?.ecommerce.items).toHaveLength(2);
  });

  it("fires exactly as the container fixture's shortfall rules say", () => {
    const fully = buildPurchaseFromOrder(ORDER, 12, "AUD", {
      ...PARTIAL,
      fullyRefunded: true,
      refundTotal: "51.85",
      shippingRefund: "12.00",
    });
    const partly = buildPurchaseFromOrder(ORDER, 12, "AUD", PARTIAL);
    const plain = buildPurchaseFromOrder(ORDER, 12, "AUD");
    expect(fully !== null).toBe(
      CONTAINER_PURCHASE_SHORTFALL_RULES.fully_refunded.fires,
    );
    expect(partly !== null).toBe(
      CONTAINER_PURCHASE_SHORTFALL_RULES.partly_refunded.fires,
    );
    expect(plain !== null).toBe(
      CONTAINER_PURCHASE_SHORTFALL_RULES.no_shortfall.fires,
    );
    expect(partly?.ecommerce.value).toBe(31.95);
    expect(plain?.ecommerce.value).toBe(51.85);
  });

  it("subtracts a shipping refund on a partial record that carries one", () => {
    const event = buildPurchaseFromOrder(ORDER, 12, "AUD", {
      ...PARTIAL,
      shippingRefund: "12.00",
      refundTotal: "31.90",
    });
    expect(event?.ecommerce.shipping).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderRefused } from "./order-refused";

describe("OrderRefused", () => {
  it("says the order was not placed and what happened to the money", () => {
    const html = renderToStaticMarkup(
      <OrderRefused
        refusal={{
          reason: "woocommerce_rest_product_out_of_stock",
          refundId: "re_secret",
          refundStatus: "succeeded",
          occurredAt: "2026-10-16T00:00:00Z",
        }}
      />,
    );
    expect(html).toContain("We couldn&#x27;t place your order");
    expect(html).toContain("sold out while you were paying");
    expect(html).toContain("has been refunded");
    expect(html).toContain('href="/checkout"');
    // Nothing technical reaches the DOM.
    for (const secret of ["woocommerce_", "re_secret", "2026-10-16"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("says an authorisation was released rather than refunded", () => {
    const html = renderToStaticMarkup(
      <OrderRefused
        refusal={{
          reason: "woocommerce_rest_product_not_purchasable",
          refundStatus: "authorization_released",
        }}
      />,
    );
    expect(html).toContain("not charged");
    expect(html).not.toContain("refunded");
  });
});

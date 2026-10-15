import { describe, expect, it } from "vitest";
import { isStockFinalizeError } from "./checkout-stock-detect";

describe("isStockFinalizeError", () => {
  it("recognises WooCommerce out-of-stock messages", () => {
    expect(
      isStockFinalizeError(
        new Error('{"code":"woocommerce_rest_invalid_stock","message":"out of stock"}'),
      ),
    ).toBe(true);
    expect(isStockFinalizeError("Product is out of stock")).toBe(true);
    expect(isStockFinalizeError("Insufficient stock for SKU")).toBe(true);
    expect(
      isStockFinalizeError("woocommerce_rest_product_out_of_stock"),
    ).toBe(true);
  });

  it("does not treat cart-empty race as stock", () => {
    expect(
      isStockFinalizeError(
        new Error("woocommerce_rest_cart_empty: Cart is empty."),
      ),
    ).toBe(false);
    expect(isStockFinalizeError(new Error("Network error"))).toBe(false);
    expect(isStockFinalizeError(null)).toBe(false);
  });
});

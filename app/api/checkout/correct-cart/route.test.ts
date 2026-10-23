import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The C2/C3 correction endpoint (checkout plan v3 §2.2). It must keep the
 * Checkout Session (every write `keepCheckoutSession`), stop at the first
 * failed write, and refuse anything that is not exactly a JSON list of
 * corrections — it writes to the shopper's cart.
 *
 * WHY A ROUTE AND NOT A SERVER ACTION is a claim about Next re-rendering
 * /checkout after a cookie-setting action, which no unit test can see; the
 * route's header carries it.
 */

const removeCartItemAction = vi.fn();
const updateCartItemAction = vi.fn();
const getFullCartAction = vi.fn();
vi.mock("@/lib/cart-actions", () => ({
  removeCartItemAction: (...a: unknown[]) => removeCartItemAction(...a),
  updateCartItemAction: (...a: unknown[]) => updateCartItemAction(...a),
  getFullCartAction: (...a: unknown[]) => getFullCartAction(...a),
}));

const { POST } = await import("./route");
const { parseCorrections } = await import("@/lib/checkout-cart-correction");

const post = (body: unknown, contentType = "application/json") =>
  POST(
    new Request("http://localhost/api/checkout/correct-cart", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/checkout/correct-cart", () => {
  it("removes and reduces WITHOUT expiring the Checkout Session, and answers the corrected cart", async () => {
    removeCartItemAction.mockResolvedValue({
      success: true,
      cart: { itemsCount: 3 },
    });
    updateCartItemAction.mockResolvedValue({
      success: true,
      cart: { itemsCount: 2 },
    });
    const res = await post({
      corrections: [
        { itemKey: "k1", action: "remove", quantity: 0 },
        { itemKey: "k2", action: "reduce", quantity: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cart: { itemsCount: 2 } });
    expect(removeCartItemAction).toHaveBeenCalledWith("k1", {
      keepCheckoutSession: true,
    });
    expect(updateCartItemAction).toHaveBeenCalledWith("k2", 2, {
      keepCheckoutSession: true,
    });
  });

  it("stops at the first failed correction and says so, with the cart re-read here", async () => {
    removeCartItemAction.mockResolvedValue({ success: false, error: "x" });
    getFullCartAction.mockResolvedValue({ itemsCount: 2 });
    const res = await post({
      corrections: [
        { itemKey: "k1", action: "remove", quantity: 0 },
        { itemKey: "k2", action: "reduce", quantity: 2 },
      ],
    });
    expect(await res.json()).toEqual({ ok: false, cart: { itemsCount: 2 } });
    expect(updateCartItemAction).not.toHaveBeenCalled();
  });

  it("answers no cart when the failure left none (the last line's lost session)", async () => {
    removeCartItemAction.mockResolvedValue({
      success: false,
      error: "expired",
    });
    getFullCartAction.mockResolvedValue(null);
    const res = await post({
      corrections: [{ itemKey: "k1", action: "remove", quantity: 0 }],
    });
    expect(await res.json()).toEqual({ ok: false, cart: null });
  });

  it("refuses a non-JSON content type with 415 and writes nothing", async () => {
    const res = await post(
      { corrections: [{ itemKey: "k", action: "remove", quantity: 0 }] },
      "text/plain",
    );
    expect(res.status).toBe(415);
    expect(removeCartItemAction).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "nope"],
    ["no corrections", {}],
    ["an empty list", { corrections: [] }],
    [
      "an unknown action",
      { corrections: [{ itemKey: "k", action: "add", quantity: 1 }] },
    ],
    [
      "a reduce to zero",
      { corrections: [{ itemKey: "k", action: "reduce", quantity: 0 }] },
    ],
    [
      "a fractional quantity",
      { corrections: [{ itemKey: "k", action: "reduce", quantity: 1.5 }] },
    ],
    ["no line key", { corrections: [{ action: "remove", quantity: 0 }] }],
    ["a null entry", { corrections: [null] }],
  ])("refuses %s with 400 and writes nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(removeCartItemAction).not.toHaveBeenCalled();
    expect(updateCartItemAction).not.toHaveBeenCalled();
  });

  it("caps the list", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      itemKey: `k${i}`,
      action: "remove",
      quantity: 0,
    }));
    expect(parseCorrections({ corrections: many })).toBeNull();
  });
});

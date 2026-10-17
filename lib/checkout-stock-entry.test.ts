import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkpoint C1 (checkout plan v3 §2): checkout entry corrects the cart and
 * records one alert per line, and leaves for the BAG — never an error screen —
 * only when the correction empties the cart.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const getFullCartAction = vi.fn();
const removeCartItemAction = vi.fn();
const updateCartItemAction = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("./cart-actions", () => ({
  getFullCartAction: () => getFullCartAction(),
  removeCartItemAction: (...a: unknown[]) => removeCartItemAction(...a),
  updateCartItemAction: (...a: unknown[]) => updateCartItemAction(...a),
}));

type Cart = Parameters<
  typeof import("./checkout-stock-entry").correctCartAtEntry
>[0];

function cart(items: Array<Record<string, unknown>>): Cart {
  return { itemsCount: items.length, items } as unknown as Cart;
}

const heldOut = {
  key: "k-small",
  name: "Base Layer",
  quantity: 1,
  stockStatus: "outofstock",
  stockQuantity: 0,
  variation: [{ attribute: "Size", value: "Small" }],
};
const short = {
  key: "k-gloves",
  name: "Gloves",
  quantity: 3,
  stockStatus: "instock",
  stockQuantity: 2,
  variation: [],
};
const fine = {
  key: "k-socks",
  name: "Socks",
  quantity: 1,
  stockStatus: "instock",
  stockQuantity: null,
  variation: [],
};

let entry: typeof import("./checkout-stock-entry");

beforeEach(async () => {
  vi.clearAllMocks();
  removeCartItemAction.mockResolvedValue({ success: true, cart: {} });
  updateCartItemAction.mockResolvedValue({ success: true, cart: {} });
  entry = await import("./checkout-stock-entry");
});

describe("correctCartAtEntry", () => {
  it("leaves a clean cart alone", async () => {
    const alerts: import("./stock-hold").StockAlert[] = [];
    const c = cart([fine]);
    await expect(entry.correctCartAtEntry(c, alerts)).resolves.toBe(c);
    expect(alerts).toEqual([]);
    expect(getFullCartAction).not.toHaveBeenCalled();
  });

  it("removes the held-out line, reduces the short one, keeps the session, and alerts per line", async () => {
    const corrected = cart([fine]);
    getFullCartAction.mockResolvedValue(corrected);
    const alerts: import("./stock-hold").StockAlert[] = [];
    await expect(
      entry.correctCartAtEntry(cart([heldOut, short, fine]), alerts),
    ).resolves.toBe(corrected);
    expect(removeCartItemAction).toHaveBeenCalledWith("k-small", {
      keepCheckoutSession: true,
    });
    expect(updateCartItemAction).toHaveBeenCalledWith("k-gloves", 2, {
      keepCheckoutSession: true,
    });
    expect(alerts).toEqual([
      { kind: "removed", name: "Base Layer – Small" },
      { kind: "reduced", name: "Gloves", quantity: 2 },
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an emptied cart to the bag with the alerts, not to /checkout/error", async () => {
    getFullCartAction.mockResolvedValue(cart([]));
    const alerts: import("./stock-hold").StockAlert[] = [];
    await expect(
      entry.correctCartAtEntry(cart([heldOut]), alerts),
    ).rejects.toThrow("NEXT_REDIRECT");
    const url = redirect.mock.calls[0]?.[0] ?? "";
    expect(url.startsWith("/?bag_alerts=")).toBe(true);
    expect(url).not.toContain("/checkout/error");
    const { bagAlertsFromSearch } = await import("./stock-hold");
    expect(bagAlertsFromSearch(url.slice(1))).toEqual([
      { kind: "removed", name: "Base Layer – Small" },
    ]);
  });
});

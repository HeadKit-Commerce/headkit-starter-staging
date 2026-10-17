import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKOUT_SESSION_COOKIE } from "@/lib/checkout-session-cookie";

/**
 * `rebuildCartFromKlaviyoAction` (checkout plan v3 §4.5) is a cart mutation:
 * the rebuilt cart's token must land in the `hk-cart-token` cookie so the
 * shopper's next request reads that cart, and an open Stripe Checkout Session
 * priced for the OLD contents must be expired first (ENG-784 mechanism 1).
 * Boundaries mocked as in cart-actions.auth.test.ts — no real network.
 */

const cookieGet = vi.fn();
const cookieSet = vi.fn();
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGet,
    set: cookieSet,
    delete: cookieDelete,
  }),
}));

const getCartToken = vi.fn();
vi.mock("@/lib/cart", () => ({
  getCartToken: () => getCartToken(),
  cartTokenCookieOptions: () => ({ name: "hk-cart-token", path: "/" }),
}));

const rebuildFromKlaviyo = vi.fn();
const expireCheckoutSession = vi.fn(async () => ({}));
const createServerHeadkit = vi.fn((..._args: unknown[]) => ({
  cart: { rebuildFromKlaviyo },
  payments: { expireCheckoutSession },
}));
vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkit(...args),
}));

/** A JWT-shaped token whose payload carries `user_id` and a far `exp`. */
function token(userId: string): string {
  const payload = btoa(
    // A fixed far-future exp: the same user id must always build the same
    // token, and "expiring soon" must never trigger a refresh.
    JSON.stringify({ user_id: userId, exp: 4102444800 }),
  );
  return `h.${payload}.s`;
}

const { rebuildCartFromKlaviyoAction } = await import("./cart-actions");

beforeEach(() => {
  vi.clearAllMocks();
  cookieGet.mockReturnValue(undefined);
});

describe("rebuildCartFromKlaviyoAction", () => {
  it("sends the key and stores the rebuilt cart's token", async () => {
    getCartToken.mockReturnValue(undefined);
    const cart = { token: token("t_new"), items: [{}] };
    rebuildFromKlaviyo.mockResolvedValue(cart);

    const result = await rebuildCartFromKlaviyoAction("KEY=");

    expect(rebuildFromKlaviyo).toHaveBeenCalledWith("KEY=");
    expect(result).toEqual({ success: true, cart });
    expect(cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "hk-cart-token", value: cart.token }),
    );
  });

  it("points the cookie at a NEW session the store fell back to", async () => {
    getCartToken.mockReturnValue(token("t_old"));
    const cart = { token: token("t_fresh"), items: [{}] };
    rebuildFromKlaviyo.mockResolvedValue(cart);

    await rebuildCartFromKlaviyoAction("KEY");

    expect(createServerHeadkit.mock.calls[0]?.[0]).toBe(token("t_old"));
    expect(cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({ value: cart.token }),
    );
  });

  it("expires an open checkout session before changing the cart", async () => {
    getCartToken.mockReturnValue(token("t_old"));
    cookieGet.mockImplementation((name: string) =>
      name === CHECKOUT_SESSION_COOKIE ? { value: "cs_test_open" } : undefined,
    );
    rebuildFromKlaviyo.mockResolvedValue({ token: token("t_old"), items: [] });

    await rebuildCartFromKlaviyoAction("KEY");

    expect(expireCheckoutSession).toHaveBeenCalledWith(
      "cs_test_open",
      "CART_CHANGED",
    );
    expect(cookieDelete).toHaveBeenCalledWith(CHECKOUT_SESSION_COOKIE);
    expect(expireCheckoutSession.mock.invocationCallOrder[0]).toBeLessThan(
      rebuildFromKlaviyo.mock.invocationCallOrder[0]!,
    );
  });

  it("answers a failure instead of throwing", async () => {
    getCartToken.mockReturnValue(undefined);
    rebuildFromKlaviyo.mockRejectedValue(new Error("CART_REBUILD_INVALID"));

    const result = await rebuildCartFromKlaviyoAction("bad");

    expect(result.success).toBe(false);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

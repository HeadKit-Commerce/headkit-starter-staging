import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * After Shopify ORDERS_PAID, commerce GetCart mints a new empty cart token.
 * getCartAction must persist that rotation — Shopify GIDs are not JWTs, so
 * the JWT-only persist path in withCartRetry never runs for hosted checkout.
 */

const createServerHeadkitMock = vi.fn();
const getCartTokenMock = vi.fn();
const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGetMock,
    set: cookieSetMock,
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/cart", () => ({
  getCartToken: () => getCartTokenMock(),
  cartTokenCookieOptions: () => ({ name: "hk-cart-token", path: "/" }),
  // A Shopify cart GID is not a JWT: it has no `exp`.
  cartTokenSecondsLeft: () => null,
}));

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

function fakeSdk(cart: { token: string; itemsCount?: number }): {
  cart: { get: ReturnType<typeof vi.fn> };
} {
  return {
    cart: {
      get: vi.fn().mockResolvedValue(cart),
    },
  };
}

let getCartAction: typeof import("./cart-actions").getCartAction;

beforeEach(async () => {
  vi.clearAllMocks();
  cookieGetMock.mockReturnValue(undefined);
  const mod = await import("./cart-actions");
  getCartAction = mod.getCartAction;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCartAction persists a rotated Shopify cart token", () => {
  it("writes the cookie when commerce returns a different token", async () => {
    getCartTokenMock.mockReturnValue("gid://shopify/Cart/old");
    createServerHeadkitMock.mockReturnValue(
      fakeSdk({ token: "gid://shopify/Cart/new", itemsCount: 0 }),
    );

    const cart = await getCartAction();

    expect(cart?.token).toBe("gid://shopify/Cart/new");
    expect(cookieSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hk-cart-token",
        value: "gid://shopify/Cart/new",
      }),
    );
  });

  it("does not rewrite the cookie when the token is unchanged", async () => {
    getCartTokenMock.mockReturnValue("gid://shopify/Cart/same");
    createServerHeadkitMock.mockReturnValue(
      fakeSdk({ token: "gid://shopify/Cart/same", itemsCount: 2 }),
    );

    await getCartAction();

    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});

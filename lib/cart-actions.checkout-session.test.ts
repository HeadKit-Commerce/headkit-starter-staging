import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ENG-784 mechanism 1 — expire-on-cart-mutation.
 *
 * withCartRetry is the single choke point every cart mutation flows through:
 * when the httpOnly `hk-checkout-session` cookie is present and the caller
 * did not pass `keepCheckoutSession: true`, the active Stripe Checkout
 * Session is expired (reason CART_CHANGED) and the cookie deleted BEFORE the
 * mutation runs. Expire failures never block the mutation (mechanism 2 —
 * amount verification at manual capture — backstops).
 *
 * Also covers expireCheckoutSessionAction, which expires via the SDK and
 * clears the cookie. The cookie is SET by `POST /api/checkout/active-session`
 * (its attributes are asserted in that route's test), not by an action.
 *
 * Mocks the boundaries (next/headers cookies, @/lib/cart, @/lib/sdk.server)
 * per the node-vitest style used by cart-actions.auth.test.ts — no network.
 */

const createServerHeadkitMock = vi.fn();
const getCartTokenMock = vi.fn();
const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();
const cookieDeleteMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGetMock,
    set: cookieSetMock,
    delete: cookieDeleteMock,
  }),
}));

vi.mock("@/lib/cart", () => ({
  getCartToken: () => getCartTokenMock(),
  cartTokenCookieOptions: () => ({ name: "hk-cart-token", path: "/" }),
}));

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

/** Minimal SDK stub: cart mutations resolve; expire is observable. */
function fakeSdk(): {
  cart: { addItem: ReturnType<typeof vi.fn> };
  payments: { expireCheckoutSession: ReturnType<typeof vi.fn> };
} {
  const cart = { key: "1", token: "ct-new" };
  return {
    cart: {
      addItem: vi.fn().mockResolvedValue(cart),
    },
    payments: {
      expireCheckoutSession: vi
        .fn()
        .mockResolvedValue({ ok: true, outcome: "expired" }),
    },
  };
}

/** Map cookie name → value for a given test scenario. */
function stubCookies(values: Record<string, string>): void {
  cookieGetMock.mockImplementation((name: string) =>
    name in values ? { value: values[name] } : undefined,
  );
}

let sdk: ReturnType<typeof fakeSdk>;
let addToCartAction: typeof import("./cart-actions").addToCartAction;
let expireCheckoutSessionAction: typeof import("../app/checkout/actions").expireCheckoutSessionAction;

beforeEach(async () => {
  vi.clearAllMocks();
  sdk = fakeSdk();
  createServerHeadkitMock.mockReturnValue(sdk);
  getCartTokenMock.mockReturnValue("ct");
  const cartMod = await import("./cart-actions");
  addToCartAction = cartMod.addToCartAction;
  const checkoutMod = await import("../app/checkout/actions");
  expireCheckoutSessionAction = checkoutMod.expireCheckoutSessionAction;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withCartRetry expire-before-mutate (ENG-784 mechanism 1)", () => {
  it("expires the cookie's session with CART_CHANGED, deletes the cookie, then mutates", async () => {
    stubCookies({ "hk-checkout-session": "cs_active" });

    const result = await addToCartAction({
      productId: 1,
      quantity: 1,
    } as never);

    expect(sdk.payments.expireCheckoutSession).toHaveBeenCalledWith(
      "cs_active",
      "CART_CHANGED",
    );
    expect(cookieDeleteMock).toHaveBeenCalledWith("hk-checkout-session");
    expect(sdk.cart.addItem).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    // Ordering: expire fires BEFORE the mutation attempt.
    const expireOrder =
      sdk.payments.expireCheckoutSession.mock.invocationCallOrder[0];
    const mutateOrder = sdk.cart.addItem.mock.invocationCallOrder[0];
    expect(expireOrder!).toBeLessThan(mutateOrder!);
  });

  it("keepCheckoutSession: true skips expiry and keeps the cookie", async () => {
    stubCookies({ "hk-checkout-session": "cs_active" });

    const result = await addToCartAction(
      { productId: 1, quantity: 1 } as never,
      { keepCheckoutSession: true },
    );

    expect(sdk.payments.expireCheckoutSession).not.toHaveBeenCalled();
    expect(cookieDeleteMock).not.toHaveBeenCalledWith("hk-checkout-session");
    expect(result.success).toBe(true);
  });

  it("no hk-checkout-session cookie → no expiry attempted", async () => {
    stubCookies({});

    const result = await addToCartAction({
      productId: 1,
      quantity: 1,
    } as never);

    expect(sdk.payments.expireCheckoutSession).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("expire failure never blocks the mutation (mechanism 2 backstops)", async () => {
    stubCookies({ "hk-checkout-session": "cs_active" });
    sdk.payments.expireCheckoutSession.mockRejectedValue(
      new Error("checkout session does not belong to this cart"),
    );

    const result = await addToCartAction({
      productId: 1,
      quantity: 1,
    } as never);

    expect(sdk.cart.addItem).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    // Cookie is still dropped — the session is dead-to-us either way.
    expect(cookieDeleteMock).toHaveBeenCalledWith("hk-checkout-session");
  });
});

describe("checkout session expire action (ENG-784)", () => {
  it("expireCheckoutSessionAction expires via the SDK and clears the cookie", async () => {
    stubCookies({ "hk-checkout-session": "cs_old" });

    await expireCheckoutSessionAction("cs_old", "SUPERSEDED");

    expect(sdk.payments.expireCheckoutSession).toHaveBeenCalledWith(
      "cs_old",
      "SUPERSEDED",
    );
    expect(cookieDeleteMock).toHaveBeenCalledWith("hk-checkout-session");
  });

  it("expireCheckoutSessionAction swallows SDK errors and still clears the cookie", async () => {
    stubCookies({ "hk-checkout-session": "cs_old" });
    sdk.payments.expireCheckoutSession.mockRejectedValue(new Error("conflict"));

    await expect(
      expireCheckoutSessionAction("cs_old", "CART_CHANGED"),
    ).resolves.toBeUndefined();
    expect(cookieDeleteMock).toHaveBeenCalledWith("hk-checkout-session");
  });

  it("expireCheckoutSessionAction without a cart token skips the SDK call but clears the cookie", async () => {
    stubCookies({ "hk-checkout-session": "cs_old" });
    getCartTokenMock.mockReturnValue(undefined);

    await expireCheckoutSessionAction("cs_old", "CART_CHANGED");

    expect(sdk.payments.expireCheckoutSession).not.toHaveBeenCalled();
    expect(cookieDeleteMock).toHaveBeenCalledWith("hk-checkout-session");
  });

  it("supersede race: cookie already holds the NEW session → expire keeps it", async () => {
    // refreshSession registers the replacement session, THEN expires the old
    // one. The expire must not clobber the new session's tracking cookie.
    stubCookies({ "hk-checkout-session": "cs_new" });

    await expireCheckoutSessionAction("cs_old", "SUPERSEDED");

    expect(sdk.payments.expireCheckoutSession).toHaveBeenCalledWith(
      "cs_old",
      "SUPERSEDED",
    );
    expect(cookieDeleteMock).not.toHaveBeenCalled();
  });
});

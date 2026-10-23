import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, GraphQLError } from "@headkit/sdk";
import { isHangingPromiseRejectionError } from "next/dist/server/dynamic-rendering-utils";

/**
 * A prerender interruption must not become a null cart.
 *
 * Under Cache Components a client prefetch of `/checkout` or `/quote` runs a
 * RUNTIME prerender, which resolves `cookies()`, so `cart.get()` fires and the
 * prefetch then completes with the fetch still pending. Next rejects it with a
 * `HANGING_PROMISE_REJECTION` error, the SDK transport wraps that in a
 * `ConnectionError` carrying it as `cause`, and a catch that swallows it logs
 * a provider failure and renders the shopper a terminal no-cart page.
 *
 * Next's own `unstable_rethrow` is exercised here (not mocked), and the double
 * is checked against Next's own `isHangingPromiseRejectionError`, so a renamed
 * digest fails this file instead of leaving the fix quietly inert. No
 * prerender runs here; the route-level `connection()` boundary is covered at
 * source level by `app/checkout/prefetch-cart-guard.test.ts`.
 */

const cartMock = vi.fn();
const createServerHeadkitMock = vi.fn();
const getCartTokenMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/cart", () => ({
  getCartToken: () => getCartTokenMock(),
  cartTokenCookieOptions: () => ({ name: "hk-cart-token", path: "/" }),
  cartTokenSecondsLeft: () => null,
}));

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

/** The error Next rejects a pending `fetch()` with once a prerender ends. */
function hangingPromiseRejection(): Error {
  return Object.assign(
    new Error(
      "During prerendering, fetch() rejects when the prerender is complete. " +
        'This occurred at route "/checkout".',
    ),
    { digest: "HANGING_PROMISE_REJECTION" },
  );
}

/** What the SDK transport throws around it (`packages/sdk/src/transport.ts`). */
function wrappedInterruption(): { inner: Error; outer: ConnectionError } {
  const inner = hangingPromiseRejection();
  return { inner, outer: new ConnectionError(inner.message, inner) };
}

let mod: typeof import("./cart-actions");

beforeEach(async () => {
  vi.clearAllMocks();
  getCartTokenMock.mockReturnValue("ct");
  createServerHeadkitMock.mockReturnValue({
    cart: { get: cartMock, addItem: cartMock, selectShipping: cartMock },
    payments: { expireCheckoutSession: vi.fn() },
  });
  mod = await import("./cart-actions");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the double is the error Next actually throws", () => {
  it("is accepted by Next's own isHangingPromiseRejectionError", () => {
    expect(isHangingPromiseRejectionError(hangingPromiseRejection())).toBe(
      true,
    );
  });

  it("the SDK's ConnectionError keeps the fetch rejection as `cause`", () => {
    const { inner, outer } = wrappedInterruption();
    expect(outer.cause).toBe(inner);
  });
});

describe("getFullCartAction does not swallow a prerender interruption", () => {
  it("rethrows the wrapped rejection without logging a provider failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { inner, outer } = wrappedInterruption();
    cartMock.mockRejectedValue(outer);

    await expect(mod.getFullCartAction()).rejects.toBe(inner);
    expect(logged).not.toHaveBeenCalled();
  });

  it("rethrows an unwrapped rejection too", async () => {
    cartMock.mockRejectedValue(hangingPromiseRejection());
    await expect(mod.getFullCartAction()).rejects.toMatchObject({
      digest: "HANGING_PROMISE_REJECTION",
    });
  });

  it("a provider error still returns null and still logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    cartMock.mockRejectedValue(
      new GraphQLError([{ message: "cart session expired" }]),
    );

    await expect(mod.getFullCartAction()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith(
      "[getFullCartAction] cart.get() failed → no cart",
      expect.objectContaining({ error: "cart session expired" }),
    );
  });

  it("a transport failure with an unrelated cause still returns null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cartMock.mockRejectedValue(
      new ConnectionError("fetch failed", new Error("ECONNREFUSED")),
    );

    await expect(mod.getFullCartAction()).resolves.toBeNull();
  });
});

describe("the sibling cart actions carry the same rule", () => {
  it("getCartAction rethrows rather than returning null", async () => {
    const { inner, outer } = wrappedInterruption();
    cartMock.mockRejectedValue(outer);
    await expect(mod.getCartAction()).rejects.toBe(inner);
  });

  it("getCartAction still returns null for a provider error", async () => {
    cartMock.mockRejectedValue(new Error("boom"));
    await expect(mod.getCartAction()).resolves.toBeNull();
  });

  it("a mutation rethrows rather than reporting a shopper-facing failure", async () => {
    const { inner, outer } = wrappedInterruption();
    cartMock.mockRejectedValue(outer);
    await expect(
      mod.addToCartAction({ productId: 1, quantity: 1 } as never),
    ).rejects.toBe(inner);
    await expect(mod.selectShippingAction("0", "flat_rate:1")).rejects.toBe(
      inner,
    );
  });

  it("a mutation still reports a provider error to the shopper", async () => {
    cartMock.mockRejectedValue(new Error("Out of stock"));
    await expect(
      mod.addToCartAction({ productId: 1, quantity: 1 } as never),
    ).resolves.toEqual({ success: false, error: "Out of stock" });
  });
});

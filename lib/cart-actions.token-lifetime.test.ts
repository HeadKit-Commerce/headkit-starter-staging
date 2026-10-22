import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cart cookie lives as long as the cart token it carries, and every cart
 * change writes the fresh token WooCommerce returns.
 *
 * THE DEFECT (Bike Society, 2026-10-22). `withCartRetry` kept the old cookie
 * unless its token had under an hour left, and the cookie had a fixed 48h
 * `maxAge`, so the cart died 48h after the FIRST add-to-cart however actively
 * the shopper used it, and /checkout then showed "Your cart session has
 * expired". The Store API re-mints the Cart-Token with a fresh `exp` on every
 * response, so keeping it slides the cart from the shopper's last change by
 * whatever lifetime the token carries: 30 days from theme 0.4.89, 48h on an
 * older theme (WooCommerce's default) — both are exercised below.
 *
 * Uses the REAL `lib/cart.ts` and `lib/cart-actions.ts`; only the request
 * cookies and the SDK are stubbed.
 */

const createServerHeadkitMock = vi.fn();
const cookieValues = new Map<string, string>();
const cookieSetMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
    set: cookieSetMock,
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

const HOUR = 3600;
const DAY = 86_400;
const T0 = 1_792_665_214; // a real rehearsal `iat`, 2026-10-22

/** A WooCommerce-shaped Cart-Token: base64url segments, `exp` in seconds. */
function cartToken(iat: number, lifetime: number, userId = "t_83d2"): string {
  const b64url = (o: object): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    user_id: userId,
    iat,
    exp: iat + lifetime,
    // `?`/`>` in a claim forces `_`/`-` into the base64url payload.
    iss: "store-api??>>",
  })}.sig`;
}

function sdkReturning(token: string): {
  cart: { addItem: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
} {
  const cart = { key: "1", token, itemsCount: 1 };
  return {
    cart: {
      addItem: vi.fn().mockResolvedValue(cart),
      get: vi.fn().mockResolvedValue(cart),
    },
  };
}

function lastCartCookie(): { value: string; maxAge: number } | undefined {
  const calls = cookieSetMock.mock.calls
    .map((c) => c[0] as { name: string; value: string; maxAge: number })
    .filter((c) => c.name === "hk-cart-token");
  return calls.at(-1);
}

let actions: typeof import("./cart-actions");

beforeEach(async () => {
  vi.clearAllMocks();
  cookieValues.clear();
  vi.useFakeTimers();
  actions = await import("./cart-actions");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withCartRetry keeps the fresh cart token", () => {
  it("first add-to-cart: the cookie lives as long as the token (48h)", async () => {
    vi.setSystemTime(T0 * 1000);
    createServerHeadkitMock.mockReturnValue(
      sdkReturning(cartToken(T0, 48 * HOUR)),
    );

    await actions.addToCartAction({ id: "1", quantity: 1 });

    expect(lastCartCookie()?.maxAge).toBe(48 * HOUR);
  });

  it("a change 40h in rewrites the cookie with the new token and a fresh lifetime", async () => {
    // The old cookie carries a 48h token with 8h left — the pre-fix gate
    // (rewrite only under 1h left) skipped exactly this write, so the cart
    // died at 48h from the FIRST add instead of 48h from the last.
    const old = cartToken(T0, 48 * HOUR);
    cookieValues.set("hk-cart-token", old);
    const now = T0 + 40 * HOUR;
    vi.setSystemTime(now * 1000);
    const fresh = cartToken(now, 48 * HOUR);
    createServerHeadkitMock.mockReturnValue(sdkReturning(fresh));

    await actions.addToCartAction({ id: "1", quantity: 1 });

    expect(lastCartCookie()).toMatchObject({ value: fresh, maxAge: 48 * HOUR });
  });

  it("the lifetime follows the token: 30 days from theme 0.4.89", async () => {
    vi.setSystemTime(T0 * 1000);
    createServerHeadkitMock.mockReturnValue(
      sdkReturning(cartToken(T0, 30 * DAY)),
    );

    await actions.addToCartAction({ id: "1", quantity: 1 });

    expect(lastCartCookie()?.maxAge).toBe(30 * DAY);
  });

  it("a token with no readable exp (Shopify cart GID) falls back to 48h", async () => {
    vi.setSystemTime(T0 * 1000);
    createServerHeadkitMock.mockReturnValue(
      sdkReturning("gid://shopify/Cart/abc"),
    );

    await actions.addToCartAction({ id: "1", quantity: 1 });

    expect(lastCartCookie()).toMatchObject({
      value: "gid://shopify/Cart/abc",
      maxAge: 48 * HOUR,
    });
  });
});

describe("getCartAction sizes the cookie from the token it writes", () => {
  it("a re-minted token on read carries its own lifetime", async () => {
    cookieValues.set("hk-cart-token", cartToken(T0, 48 * HOUR));
    const now = T0 + 30 * HOUR;
    vi.setSystemTime(now * 1000);
    const fresh = cartToken(now, 48 * HOUR);
    createServerHeadkitMock.mockReturnValue(sdkReturning(fresh));

    await actions.getCartAction();

    expect(lastCartCookie()).toMatchObject({ value: fresh, maxAge: 48 * HOUR });
  });
});

describe("getCartAction extends the cart on a plain visit, at most once a day", () => {
  // CartCountSync reads the cart on every page load. The Store API re-mints
  // the token on each read, so writing every one would set the cookie on every
  // page view; the theme renews the session row on the same one-day rule
  // (inc/headkit-cart-read-extend.php).

  it("a visit 25h after the token was written keeps the fresher token", async () => {
    cookieValues.set("hk-cart-token", cartToken(T0, 30 * DAY));
    const now = T0 + 25 * HOUR;
    vi.setSystemTime(now * 1000);
    const fresh = cartToken(now, 30 * DAY);
    createServerHeadkitMock.mockReturnValue(sdkReturning(fresh));

    await actions.getCartAction();

    expect(lastCartCookie()).toMatchObject({ value: fresh, maxAge: 30 * DAY });
  });

  it("a visit 23h after the token was written leaves the cookie alone", async () => {
    cookieValues.set("hk-cart-token", cartToken(T0, 30 * DAY));
    const now = T0 + 23 * HOUR;
    vi.setSystemTime(now * 1000);
    createServerHeadkitMock.mockReturnValue(
      sdkReturning(cartToken(now, 30 * DAY)),
    );

    const cart = await actions.getCartAction();

    expect(cart).not.toBeNull();
    expect(lastCartCookie()).toBeUndefined();
  });

  it("a token for another session is written at once, however fresh", async () => {
    cookieValues.set("hk-cart-token", cartToken(T0, 30 * DAY, "t_old"));
    const now = T0 + HOUR;
    vi.setSystemTime(now * 1000);
    const other = cartToken(now, 30 * DAY, "t_new");
    createServerHeadkitMock.mockReturnValue(sdkReturning(other));

    await actions.getCartAction();

    expect(lastCartCookie()?.value).toBe(other);
  });

  it("a rotated Shopify cart GID is written at once", async () => {
    cookieValues.set("hk-cart-token", "gid://shopify/Cart/old");
    vi.setSystemTime(T0 * 1000);
    createServerHeadkitMock.mockReturnValue(
      sdkReturning("gid://shopify/Cart/new"),
    );

    await actions.getCartAction();

    expect(lastCartCookie()?.value).toBe("gid://shopify/Cart/new");
  });

  it("the same token back is never rewritten", async () => {
    const token = cartToken(T0, 30 * DAY);
    cookieValues.set("hk-cart-token", token);
    vi.setSystemTime((T0 + 3 * DAY) * 1000);
    createServerHeadkitMock.mockReturnValue(sdkReturning(token));

    await actions.getCartAction();

    expect(lastCartCookie()).toBeUndefined();
  });
});

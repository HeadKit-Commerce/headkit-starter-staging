import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "@headkit/sdk";

/**
 * `/api/checkout/sync-line-items` must build the SDK with the shopper's auth
 * token (hk-auth-token cookie) so its GetCart is AUTH-flavored. WC core
 * flavor-locks the session customer blob to the request's WP user — a
 * token-only GetCart on a logged-in shopper's session reads (and destroys)
 * the guest flavor, pushing the default-zone $10 rate to Stripe while the UI
 * shows the shopper's $5 choice. Belt-and-braces alongside the theme-level
 * identity unification (Cart-Token → WP user).
 * Mechanism: .planning/debug/stripe-shipping-desync-logged-in.md
 *
 * Mock style mirrors lib/cart-actions.auth.test.ts (boundaries mocked, no
 * network). `@/lib/auth-cookie` runs REAL so the cookie-name contract is
 * proven, not assumed.
 */

const createServerHeadkitMock = vi.fn();
const getCartTokenMock = vi.fn();
const cookieGetMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGetMock,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/cart", () => ({
  getCartToken: () => getCartTokenMock(),
  cartTokenCookieOptions: () => ({ name: "hk-cart-token", path: "/" }),
}));

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

/** Minimal SDK stub for the payments namespace the route calls. */
function fakeSdk(): {
  payments: {
    syncCheckoutSessionLineItems: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
} {
  return {
    payments: {
      syncCheckoutSessionLineItems: vi
        .fn()
        .mockResolvedValue({ ok: true, shippingOptionMapping: null }),
      getCheckoutSession: vi.fn().mockResolvedValue({ status: "open" }),
    },
  };
}

function stubCookies(values: Record<string, string>): void {
  cookieGetMock.mockImplementation((name: string) =>
    name in values ? { value: values[name] } : undefined,
  );
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/checkout/sync-line-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let POST: typeof import("./route").POST;
let sdk: ReturnType<typeof fakeSdk>;

beforeEach(async () => {
  vi.clearAllMocks();
  sdk = fakeSdk();
  createServerHeadkitMock.mockReturnValue(sdk);
  getCartTokenMock.mockResolvedValue("ct");
  const mod = await import("./route");
  POST = mod.POST;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sync-line-items forwards hk-auth-token so GetCart is auth-flavored", () => {
  it("logged-in: passes the hk-auth-token cookie as authToken (arg #2)", async () => {
    stubCookies({ "hk-auth-token": "jwt-x" });

    const res = await POST(postRequest({ sessionId: "cs_test_1" }));

    expect(res.status).toBe(200);
    // createServerHeadkit(cartToken, klaviyoId, authToken)
    const call = createServerHeadkitMock.mock.calls[0];
    expect(call?.[0]).toBe("ct");
    expect(call?.[2]).toBe("jwt-x");
  });

  it("guest: absent cookie → authToken undefined (guest path unchanged)", async () => {
    stubCookies({});

    const res = await POST(postRequest({ sessionId: "cs_test_1" }));

    expect(res.status).toBe(200);
    const call = createServerHeadkitMock.mock.calls[0];
    expect(call?.[0]).toBe("ct");
    expect(call?.[2]).toBeUndefined();
  });

  it("still 401s when no cart token exists", async () => {
    stubCookies({ "hk-auth-token": "jwt-x" });
    getCartTokenMock.mockResolvedValue(undefined);

    const res = await POST(postRequest({ sessionId: "cs_test_1" }));

    expect(res.status).toBe(401);
    expect(createServerHeadkitMock).not.toHaveBeenCalled();
  });
});

describe("sync-line-items dead-session signal (ENG-784, D7)", () => {
  it("409 {ok:false, sessionStatus} when sync fails and the session is not open", async () => {
    stubCookies({});
    sdk.payments.syncCheckoutSessionLineItems.mockRejectedValue(
      new Error("No such checkout.session"),
    );
    sdk.payments.getCheckoutSession.mockResolvedValue({ status: "expired" });

    const res = await POST(postRequest({ sessionId: "cs_dead" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, sessionStatus: "expired" });
  });

  it("500 (transient) when sync fails but the session is still open", async () => {
    stubCookies({});
    sdk.payments.syncCheckoutSessionLineItems.mockRejectedValue(
      new Error("network blip"),
    );
    sdk.payments.getCheckoutSession.mockResolvedValue({ status: "open" });

    const res = await POST(postRequest({ sessionId: "cs_alive" }));

    expect(res.status).toBe(500);
  });

  it("500 when sync fails and the status retrieve also fails (never guess dead)", async () => {
    stubCookies({});
    sdk.payments.syncCheckoutSessionLineItems.mockRejectedValue(
      new Error("boom"),
    );
    sdk.payments.getCheckoutSession.mockRejectedValue(new Error("boom too"));

    const res = await POST(postRequest({ sessionId: "cs_unknown" }));

    expect(res.status).toBe(500);
  });
});

describe("sync-line-items pre-payment stock gate", () => {
  it("409 {ok:false, code: CART_ITEM_UNAVAILABLE, issues} when commerce refuses an unavailable line", async () => {
    stubCookies({});
    sdk.payments.syncCheckoutSessionLineItems.mockRejectedValue(
      new GraphQLError([
        {
          message: "no longer available",
          extensions: {
            code: "CART_ITEM_UNAVAILABLE",
            issues: [{ code: "OUT_OF_STOCK", itemKey: "k", available: 0 }],
          },
        },
      ]),
    );

    const res = await POST(postRequest({ sessionId: "cs_open" }));

    expect(res.status).toBe(409);
    // The issues travel with the code, so checkout corrects the named lines in
    // place (checkout plan v3 §2.2) — only the server can still read them.
    expect(await res.json()).toEqual({
      ok: false,
      code: "CART_ITEM_UNAVAILABLE",
      issues: [{ code: "OUT_OF_STOCK", itemKey: "k", available: 0 }],
    });
    // Decided from the code alone — no session status read needed.
    expect(sdk.payments.getCheckoutSession).not.toHaveBeenCalled();
  });
});

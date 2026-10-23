import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * /checkout when its own Stripe session cannot be created.
 *
 * Session minting lives in {@link CheckoutSessionGate} behind Suspense so the
 * order summary can stream first. Failures still redirect to
 * `/checkout?error=<reason>` (never the exception text). LOOP GUARD: a request
 * that already arrived with `?error=` and fails again renders in place.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const createCheckoutSessionActionMock = vi.fn();
const CART = {
  itemsCount: 1,
  items: [{ key: "a" }],
  totals: { totalPrice: "1000" },
  needsShipping: false,
  shippingRates: [],
  paymentMethods: ["headkit-payments"],
  billingAddress: null,
};

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));
vi.mock("@/lib/cart-actions", () => ({
  getFullCartAction: async () => CART,
}));
vi.mock("@/lib/checkout-stock-entry", () => ({
  correctCartAtEntry: async (cart: unknown) => cart,
}));
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({ storeSettings: { checkoutType: "payment" } }),
}));
vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: async () => ({ bnplMessagingEnabled: false }),
}));
vi.mock("@/lib/ga4-ecommerce", () => ({
  buildBeginCheckoutFromCart: () => null,
}));
vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: () => ({
    pickupLocations: { list: async () => [] },
  }),
}));
vi.mock("@/lib/account-actions", () => ({ getCustomer: vi.fn() }));
vi.mock("./actions", () => ({
  createCheckoutSessionAction: (...args: unknown[]) =>
    createCheckoutSessionActionMock(...args),
}));
vi.mock("./checkout-page-content", () => ({ CheckoutPageContent: () => null }));
vi.mock("@/components/checkout/checkout-pending-shell", () => ({
  CheckoutPendingShell: () => null,
}));

let CheckoutPage: typeof import("./page").default;
let CheckoutSessionGate: typeof import("./checkout-session-gate").CheckoutSessionGate;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  CheckoutPage = (await import("./page")).default;
  CheckoutSessionGate = (await import("./checkout-session-gate"))
    .CheckoutSessionGate;
});

/** Every string rendered anywhere in a server element tree. */
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf(
      (node as ReactElement<{ children?: unknown }>).props.children,
    );
  }
  return "";
}

function gateProps(error?: string) {
  return {
    cart: CART as never,
    stockAlerts: [],
    returnUrl: "https://example.test/checkout/success",
    arrivedFromFailure: typeof error === "string" && error.length > 0,
    isAuthenticated: false,
    bnplMessagingEnabled: false,
    ...(error ? { error } : {}),
  };
}

describe("/checkout session creation failure", () => {
  it("page returns before minting a Stripe session (pending shell can paint)", async () => {
    createCheckoutSessionActionMock.mockResolvedValue({
      clientSecret: "cs_secret",
      sessionId: "cs_1",
      publishableKey: "pk_test",
    });
    const page = await CheckoutPage({ searchParams: Promise.resolve({}) });
    expect(isValidElement(page)).toBe(true);
    // Session create lives in CheckoutSessionGate — not awaited by page.tsx.
    expect(createCheckoutSessionActionMock).not.toHaveBeenCalled();
  });

  it("returns to /checkout with only the reason, never the exception text", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(
      new Error('stripe error 401: {"error":{"message":"Invalid API Key"}}'),
    );
    await expect(CheckoutSessionGate(gateProps())).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=session_creation_failed",
    );
  });

  it("returns an incomplete session to /checkout as invalid_session", async () => {
    createCheckoutSessionActionMock.mockResolvedValue({
      clientSecret: "",
      sessionId: "cs_1",
      publishableKey: "pk",
    });
    await expect(CheckoutSessionGate(gateProps())).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=invalid_session",
    );
  });

  it("LOOP GUARD: a second consecutive failure renders in place", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(new Error("boom"));
    const gate = await CheckoutSessionGate(gateProps("payment_failed"));
    expect(redirectMock).not.toHaveBeenCalled();
    const text = textOf(gate);
    expect(text).toContain("We couldn't start your checkout");
    expect(text).not.toContain("boom");
  });

  it("LOOP GUARD: the same reason twice is said once (the content banner owns it)", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(new Error("boom"));
    const gate = await CheckoutSessionGate(
      gateProps("session_creation_failed"),
    );
    expect(redirectMock).not.toHaveBeenCalled();
    expect(textOf(gate)).not.toContain("We couldn't start your checkout");
  });
});

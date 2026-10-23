import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * /checkout when its own Stripe session cannot be created.
 *
 * A session failure is RECOVERABLE — the cart is intact — so the shopper goes
 * back to `/checkout?error=<reason>` carrying the reason and nothing else (the
 * old redirect put the exception message in the URL for the error page to
 * print). LOOP GUARD: a request that already arrived with `?error=` and fails
 * again renders in place instead of redirecting a second time.
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
vi.mock("@/lib/sdk.server", () => ({ createServerHeadkit: vi.fn() }));
vi.mock("@/lib/account-actions", () => ({ getCustomer: vi.fn() }));
vi.mock("./actions", () => ({
  createCheckoutSessionAction: (...args: unknown[]) =>
    createCheckoutSessionActionMock(...args),
}));
vi.mock("./checkout-page-content", () => ({ CheckoutPageContent: () => null }));

let CheckoutPage: typeof import("./page").default;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  CheckoutPage = (await import("./page")).default;
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

describe("/checkout session creation failure", () => {
  it("returns to /checkout with only the reason, never the exception text", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(
      new Error('stripe error 401: {"error":{"message":"Invalid API Key"}}'),
    );
    await expect(
      CheckoutPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
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
    await expect(
      CheckoutPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=invalid_session",
    );
  });

  it("LOOP GUARD: a second consecutive failure renders in place", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(new Error("boom"));
    const page = await CheckoutPage({
      searchParams: Promise.resolve({ error: "payment_failed" }),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    const text = textOf(page);
    expect(text).toContain("We couldn't start your checkout");
    expect(text).not.toContain("boom");
  });

  it("LOOP GUARD: the same reason twice is said once (the content banner owns it)", async () => {
    createCheckoutSessionActionMock.mockRejectedValue(new Error("boom"));
    const page = await CheckoutPage({
      searchParams: Promise.resolve({ error: "session_creation_failed" }),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(textOf(page)).not.toContain("We couldn't start your checkout");
  });
});

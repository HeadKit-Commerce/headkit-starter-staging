import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /checkout with no cart is "your cart is empty", never "session expired".
 *
 * THE DEFECT (Bike Society, 2026-10-22). A missing `hk-cart-token` cookie made
 * `getFullCartAction` answer `null`, and the page sent `null` to
 * `/checkout/error?reason=session_expired` BEFORE its empty-cart check. A
 * visitor who never had a cart, a cart whose cookie aged out, and a Back or
 * refresh after an order (the success page deletes the cookie) all saw
 * "Your cart session has expired". Stock WooCommerce shows an empty cart.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const getFullCartActionMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
  headers: async () =>
    new Headers({
      host: "shop.example",
      "x-forwarded-proto": "https",
    }),
}));
vi.mock("@/lib/cart-actions", () => ({
  getFullCartAction: () => getFullCartActionMock(),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({
    storeSettings: { checkoutType: "payment", domain: "shop.example" },
  }),
}));
vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: async () => ({ bnplMessagingEnabled: false }),
}));
vi.mock("@/lib/sdk.server", () => ({ createServerHeadkit: vi.fn() }));
vi.mock("@/lib/account-actions", () => ({ getCustomer: vi.fn() }));
vi.mock("./actions", () => ({ createCheckoutSessionAction: vi.fn() }));
vi.mock("./checkout-page-content", () => ({ CheckoutPageContent: () => null }));
vi.mock("./checkout-session-gate", () => ({
  CheckoutSessionGate: () => null,
}));
vi.mock("@/components/checkout/checkout-pending-shell", () => ({
  CheckoutPendingShell: () => null,
}));
vi.mock("@/lib/ga4-ecommerce", () => ({
  buildBeginCheckoutFromCart: () => null,
}));

let CheckoutPage: typeof import("./page").default;

beforeEach(async () => {
  vi.clearAllMocks();
  CheckoutPage = (await import("./page")).default;
});

async function landing(): Promise<string> {
  await expect(
    CheckoutPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow(/NEXT_REDIRECT/);
  return redirectMock.mock.calls[0]?.[0] ?? "";
}

describe("/checkout without a cart", () => {
  it("sends a missing cart to the empty-cart page", async () => {
    getFullCartActionMock.mockResolvedValue(null);
    expect(await landing()).toBe("/checkout/error?reason=empty_cart");
  });

  it("sends a cart with no lines to the same page", async () => {
    getFullCartActionMock.mockResolvedValue({ itemsCount: 0, items: [] });
    expect(await landing()).toBe("/checkout/error?reason=empty_cart");
  });
});

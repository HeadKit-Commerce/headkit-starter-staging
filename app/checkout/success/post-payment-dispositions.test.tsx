import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { GraphQLError } from "@headkit/sdk";

/**
 * The two Stripe return pages AFTER the money moved. Neither may reach the
 * error boundary or the forever-"processing" screen for a failure commerce has
 * classified:
 *
 * - `orderFailure` on the session, or a thrown `ORDER_REFUSED` → <OrderRefused>
 *   (refunded, terminal);
 * - a thrown `ORDER_VALIDATION` → <CompleteOrder> (still paid, one detail);
 * - anything else on the order page → <PaymentProcessing> naming the order,
 *   instead of the old `throw orderErr`.
 *
 * And the recoverable routes carry the reason only, to `/checkout`.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const getCheckoutSessionAction = vi.fn();
const processCheckoutAction = vi.fn();
const processCheckoutOrderAction = vi.fn();
const getOrderAction = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({ storeSettings: { checkoutType: "payment" } }),
}));
// `@/app/checkout/actions` and `../actions` are the SAME module, imported by
// the two pages under different specifiers. Both mocks must be the full
// surface: when they differ, which one wins depends on resolution order and
// differs between machines.
const actionsMock = () => ({
  getCheckoutSessionAction: (...a: unknown[]) => getCheckoutSessionAction(...a),
  processCheckoutAction: (...a: unknown[]) => processCheckoutAction(...a),
  processCheckoutOrderAction: (...a: unknown[]) =>
    processCheckoutOrderAction(...a),
  getOrderAction: (...a: unknown[]) => getOrderAction(...a),
});
vi.mock("@/app/checkout/actions", () => actionsMock());
vi.mock("../actions", () => actionsMock());

const { default: CartReturnPage } = await import("./page");
const { default: OrderReturnPage } = await import("./[orderId]/page");
const { OrderRefused } = await import("@/components/checkout/order-refused");
const { CompleteOrder } = await import("@/components/checkout/complete-order");
const { PaymentProcessing } =
  await import("@/components/checkout/payment-processing");

const ADDRESS = {
  firstName: "Ada",
  lastName: "Lovelace",
  address1: "1 Queen Street",
  address2: "",
  city: "Adelaide",
  state: "SA",
  postcode: "5000",
  country: "AU",
  phone: "",
};

const PAID = {
  sessionId: "cs_1",
  status: "complete",
  paymentStatus: "paid",
  customerEmail: "ada@example.com",
  cartToken: "ct_1",
  paymentIntentId: "pi_1",
  paymentMethod: "card",
  livemode: false,
  orderFailure: null,
  billingAddress: { ...ADDRESS, email: "ada@example.com" },
  shippingAddress: ADDRESS,
  lineItems: [],
};

const REFUSED = new GraphQLError([
  {
    message: "order refused",
    extensions: {
      code: "ORDER_REFUSED",
      reason: "woocommerce_rest_product_out_of_stock",
    },
  },
]);
const INVALID = new GraphQLError([
  {
    message: "needs a corrected detail",
    extensions: {
      code: "ORDER_VALIDATION",
      reason: "woocommerce_rest_invalid_address_country",
      field: "billing_country",
      allowedCountries: ["AU"],
    },
  },
]);

function element(node: unknown): ReactElement<Record<string, unknown>> {
  if (!isValidElement(node)) throw new Error("not an element");
  return node as ReactElement<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cart return page (/checkout/success)", () => {
  const visit = () =>
    CartReturnPage({ searchParams: Promise.resolve({ session_id: "cs_1" }) });

  it("renders OrderRefused for a stamped session and finalizes nothing", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      ...PAID,
      orderId: "0",
      orderFailure: {
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "succeeded",
      },
    });
    const page = element(await visit());
    expect(page.type).toBe(OrderRefused);
    expect(processCheckoutAction).not.toHaveBeenCalled();
  });

  it("renders OrderRefused when its own finalize throws ORDER_REFUSED", async () => {
    getCheckoutSessionAction.mockResolvedValue({ ...PAID, orderId: "0" });
    processCheckoutAction.mockRejectedValue(REFUSED);
    const page = element(await visit());
    expect(page.type).toBe(OrderRefused);
    expect(page.props["refusal"]).toEqual({
      reason: "woocommerce_rest_product_out_of_stock",
    });
    // No poll for an order that can never exist.
    expect(getCheckoutSessionAction).toHaveBeenCalledTimes(1);
  });

  it("renders CompleteOrder (no order id) when its finalize throws ORDER_VALIDATION", async () => {
    getCheckoutSessionAction.mockResolvedValue({ ...PAID, orderId: "0" });
    processCheckoutAction.mockRejectedValue(INVALID);
    const page = element(await visit());
    expect(page.type).toBe(CompleteOrder);
    expect(page.props["orderId"]).toBe("");
    expect(page.props["sessionId"]).toBe("cs_1");
    expect(page.props["failure"]).toMatchObject({
      side: "billing",
      attribute: "country",
      allowedCountries: ["AU"],
    });
  });

  it("sends a plain expiry back to /checkout, not the dead end", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      ...PAID,
      status: "expired",
    });
    await expect(visit()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=session_expired",
    );
  });

  it("sends a failed session read back to /checkout with the reason only", async () => {
    getCheckoutSessionAction.mockRejectedValue(new Error("gateway 502"));
    await expect(visit()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=processing_error",
    );
  });

  it("never sends an empty country when the session carries none", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      ...PAID,
      orderId: "0",
      billingAddress: { ...ADDRESS, country: "", email: "ada@example.com" },
      shippingAddress: { ...ADDRESS, country: "" },
    });
    processCheckoutAction.mockResolvedValue({
      orderId: "77",
      orderKey: "k77",
    });
    await expect(visit()).rejects.toThrow(/NEXT_REDIRECT/);
    const input = processCheckoutAction.mock.calls[0]?.[0] as {
      billingAddress: Record<string, unknown>;
      shippingAddress: Record<string, unknown>;
    };
    expect("country" in input.billingAddress).toBe(false);
    expect("country" in input.shippingAddress).toBe(false);
  });
});

describe("order return page (/checkout/success/[orderId])", () => {
  const visit = () =>
    OrderReturnPage({
      params: Promise.resolve({ orderId: "278931" }),
      searchParams: Promise.resolve({ key: "wc_k", session_id: "cs_1" }),
    });

  beforeEach(() => {
    // A draft order is unreadable over REST until finalized.
    getOrderAction.mockRejectedValue(new Error("status 401 cannot_view"));
    getCheckoutSessionAction.mockResolvedValue({
      ...PAID,
      orderId: "278931",
      orderKey: "wc_k",
    });
  });

  it("renders OrderRefused for a stamped session before anything else", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      ...PAID,
      status: "complete",
      paymentStatus: "unpaid",
      orderFailure: { reason: "woocommerce_rest_cart_coupon_error" },
    });
    const page = element(await visit());
    expect(page.type).toBe(OrderRefused);
    expect(processCheckoutOrderAction).not.toHaveBeenCalled();
  });

  it("renders OrderRefused for a thrown ORDER_REFUSED", async () => {
    processCheckoutOrderAction.mockRejectedValue(REFUSED);
    expect(element(await visit()).type).toBe(OrderRefused);
  });

  it("renders CompleteOrder for a thrown ORDER_VALIDATION instead of throwing", async () => {
    processCheckoutOrderAction.mockRejectedValue(INVALID);
    const page = element(await visit());
    expect(page.type).toBe(CompleteOrder);
    expect(page.props["orderId"]).toBe("278931");
    expect(page.props["orderKey"]).toBe("wc_k");
  });

  it("falls back to the processing screen naming the order for anything unclassified", async () => {
    processCheckoutOrderAction.mockRejectedValue(new Error("upstream 500"));
    const page = element(await visit());
    expect(page.type).toBe(PaymentProcessing);
    expect(page.props).toMatchObject({ sessionId: "cs_1", orderId: "278931" });
  });

  it("sends a plain expiry back to /checkout", async () => {
    getCheckoutSessionAction.mockResolvedValue({ ...PAID, status: "expired" });
    await expect(visit()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/checkout?error=session_expired",
    );
  });
});

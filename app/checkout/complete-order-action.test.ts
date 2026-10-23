import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "@headkit/sdk";

/**
 * `completeOrderAction` re-finalises a PAID order after the shopper corrected
 * one detail. What this pins, with the SDK stubbed at the client boundary:
 *
 * - the `payment_data` it sends is EXACTLY what the page it retries sends —
 *   both are driven through the same builder and compared value for value.
 *   Its `checkout_session_id` is the theme's duplicate-finalize claim key, so
 *   identical data is what keeps a retry from creating a second order;
 * - the correction is a patch on the side it names, and a blank field cannot
 *   wipe one the session carried;
 * - the order page adopts the draft (`processCheckoutOrder`), the cart page
 *   creates it (`processCheckout`);
 * - the session is checked before anything is sent, and nothing throws.
 *
 * It proves what the storefront SENDS, never that WooCommerce accepts it.
 */

const processCheckoutOrder = vi.fn();
const processCheckout = vi.fn();
const getCheckoutSession = vi.fn();
const cookieJar = new Map<string, string>();

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: () => ({
    checkout: {
      processCheckoutOrder: (...args: unknown[]) =>
        processCheckoutOrder(...args),
      process: (...args: unknown[]) => processCheckout(...args),
    },
    payments: {
      getCheckoutSession: (...args: unknown[]) => getCheckoutSession(...args),
    },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/cart", () => ({ getCartToken: async () => "cart-token-1" }));

const { completeOrderAction } = await import("@/app/checkout/actions");
const { buildStripeCartPaymentData, buildStripeOrderPaymentData } =
  await import("@/lib/checkout-payment-data");

const SESSION = {
  status: "complete",
  paymentStatus: "paid",
  orderId: "278931",
  orderKey: "wc_order_k",
  cartToken: "cart-token-1",
  customerEmail: "shopper@example.com",
  paymentIntentId: "pi_1",
  paymentMethod: "card",
  livemode: false,
  cardBrand: "visa",
  cardLast4: "4242",
  walletType: "google_pay",
  stripeCustomerId: "cus_1",
  orderFailure: null,
  billingAddress: {
    firstName: "Wallet",
    lastName: "Holder",
    address1: "1 Market Street",
    address2: "",
    city: "San Francisco",
    state: "CA",
    postcode: "94105",
    country: "US",
    email: "shopper@example.com",
    phone: "",
  },
  shippingAddress: {
    firstName: "Ada",
    lastName: "Lovelace",
    address1: "1 Queen Street",
    address2: "",
    city: "Adelaide",
    state: "SA",
    postcode: "5000",
    country: "AU",
    phone: "0400000000",
  },
  lineItems: [],
};

function validationError(field: string): GraphQLError {
  return new GraphQLError([
    {
      message: "this order needs a corrected detail",
      extensions: { code: "ORDER_VALIDATION", reason: "x", field },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  cookieJar.clear();
  getCheckoutSession.mockResolvedValue(SESSION);
  processCheckoutOrder.mockResolvedValue({
    orderId: "278931",
    orderKey: "wc_order_k",
  });
  processCheckout.mockResolvedValue({ orderId: "9001", orderKey: "wc_k2" });
});

describe("order page retry (adopts the draft order)", () => {
  it("sends the same payment_data the order page builds, and a billing-only patch", async () => {
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: {
        firstName: "Ada",
        lastName: "Lovelace",
        address1: "1 Queen Street",
        city: "Adelaide",
        state: "SA",
        postcode: "5000",
        country: "AU",
      },
    });

    expect(result).toEqual({
      ok: true,
      path: "/checkout/success/278931?key=wc_order_k",
    });
    expect(processCheckout).not.toHaveBeenCalled();
    expect(processCheckoutOrder).toHaveBeenCalledTimes(1);
    const [orderId, input] = processCheckoutOrder.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(orderId).toBe("278931");
    expect(input["paymentData"]).toEqual(
      buildStripeOrderPaymentData("cs_1", SESSION),
    );
    expect(input["billingAddress"]).toMatchObject({
      address1: "1 Queen Street",
      country: "AU",
      email: "shopper@example.com",
    });
    // Shipping is untouched: the shopper was not asked about it.
    expect(input["shippingAddress"]).toMatchObject(
      expect.objectContaining({ city: "Adelaide", country: "AU" }),
    );
    expect(input["billingEmail"]).toBe("shopper@example.com");
  });

  it("a blank field in the patch cannot wipe what the session carried", async () => {
    await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { email: "ada@example.com", city: "   " },
    });
    const input = processCheckoutOrder.mock.calls[0]?.[1] as Record<
      string,
      Record<string, unknown> | unknown
    >;
    expect(input["billingAddress"]).toMatchObject({
      city: "San Francisco",
      email: "ada@example.com",
    });
    expect(input["billingEmail"]).toBe("ada@example.com");
  });

  it("patches SHIPPING for a shipping-side detail and leaves billing alone", async () => {
    await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "shipping",
      fields: { postcode: "5001" },
    });
    const input = processCheckoutOrder.mock.calls[0]?.[1] as Record<
      string,
      Record<string, unknown>
    >;
    expect(input["shippingAddress"]?.["postcode"]).toBe("5001");
    expect(input["billingAddress"]?.["postcode"]).toBe("94105");
  });

  it("refuses a session that names a different order, sending nothing", async () => {
    getCheckoutSession.mockResolvedValue({ ...SESSION, orderId: "1" });
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { email: "ada@example.com" },
    });
    expect(result).toEqual({ ok: false, kind: "transient" });
    expect(processCheckoutOrder).not.toHaveBeenCalled();
  });

  it("refuses an unpaid session, sending nothing", async () => {
    getCheckoutSession.mockResolvedValue({
      ...SESSION,
      paymentStatus: "unpaid",
    });
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { email: "ada@example.com" },
    });
    expect(result).toEqual({ ok: false, kind: "transient" });
    expect(processCheckoutOrder).not.toHaveBeenCalled();
  });

  it("answers refused, without finalizing, when the session already carries a refusal", async () => {
    getCheckoutSession.mockResolvedValue({
      ...SESSION,
      orderFailure: {
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "succeeded",
      },
    });
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { email: "ada@example.com" },
    });
    expect(result).toMatchObject({ ok: false, kind: "refused" });
    expect(processCheckoutOrder).not.toHaveBeenCalled();
  });

  it("treats an order the webhook already finalized as success", async () => {
    processCheckoutOrder.mockRejectedValue(
      new Error("This order cannot be paid for."),
    );
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { email: "ada@example.com" },
    });
    expect(result).toEqual({
      ok: true,
      path: "/checkout/success/278931?key=wc_order_k",
    });
  });

  it("returns a second typed refusal as a value, never a throw", async () => {
    processCheckoutOrder.mockRejectedValue(validationError("billing_postcode"));
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { country: "AU" },
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "validation",
      failure: { side: "billing", attribute: "postcode" },
    });
  });

  it("returns ORDER_REFUSED on the retry as refused", async () => {
    processCheckoutOrder.mockRejectedValue(
      new GraphQLError([
        {
          message: "refused",
          extensions: {
            code: "ORDER_REFUSED",
            reason: "woocommerce_rest_product_out_of_stock",
          },
        },
      ]),
    );
    const result = await completeOrderAction("278931", "wc_order_k", "cs_1", {
      side: "billing",
      fields: { country: "AU" },
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "refused",
      refusal: { reason: "woocommerce_rest_product_out_of_stock" },
    });
  });

  it("returns a transport failure as transient, never a throw", async () => {
    getCheckoutSession.mockRejectedValue(new Error("socket hang up"));
    await expect(
      completeOrderAction("278931", "wc_order_k", "cs_1", {
        side: "billing",
        fields: {},
      }),
    ).resolves.toEqual({ ok: false, kind: "transient" });
  });
});

describe("cart page retry (creates the order)", () => {
  it("calls processCheckout with the cart page's own payment_data", async () => {
    const result = await completeOrderAction("", "", "cs_1", {
      side: "billing",
      fields: { country: "AU", address1: "1 Queen Street" },
    });
    expect(processCheckoutOrder).not.toHaveBeenCalled();
    expect(processCheckout).toHaveBeenCalledTimes(1);
    const input = processCheckout.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input["paymentData"]).toEqual(
      buildStripeCartPaymentData("cs_1", SESSION),
    );
    expect(input["billingAddress"]).toMatchObject({ country: "AU" });
    expect(result).toEqual({
      ok: true,
      path: "/checkout/success/9001?key=wc_k2&session_id=cs_1",
    });
  });

  it("answers transient when the finalize returns no order to route to", async () => {
    processCheckout.mockResolvedValue({ orderId: "0", orderKey: null });
    await expect(
      completeOrderAction("", "", "cs_1", {
        side: "billing",
        fields: { email: "ada@example.com" },
      }),
    ).resolves.toEqual({ ok: false, kind: "transient" });
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { OrderValidationFailure } from "@/lib/order-validation";

/**
 * The complete-your-order screen a shopper reaches holding a charged card.
 * Pins: the money sentence leads and nothing technical renders; the form shape
 * follows the field; a submit sends a PATCH for the side it names; a second
 * typed refusal is shown beside the form it keeps; a refused retry swaps to
 * the refused screen; and the blocked case renders no form at all.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const completeOrderAction = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/checkout/actions", () => ({
  completeOrderAction: (...args: unknown[]) => completeOrderAction(...args),
}));

const { CompleteOrder } = await import("./complete-order");

const COUNTRY_FAILURE: OrderValidationFailure = {
  reason: "woocommerce_rest_invalid_address_country",
  side: "billing",
  attribute: "country",
  message:
    "Sorry, we do not allow orders from the provided country (United States (US))",
  allowedCountries: ["AU", "NZ"],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(failure: OrderValidationFailure, orderId = "278931"): void {
  act(() => {
    root.render(
      <CompleteOrder
        failure={failure}
        orderId={orderId}
        orderKey="wc_order_secret"
        sessionId="cs_secret"
        shippingAddress={{
          firstName: "Ada",
          lastName: "Lovelace",
          address1: "1 Queen Street",
          city: "Adelaide",
          state: "SA",
          postcode: "5000",
          country: "AU",
        }}
        billingAddress={{ country: "US" }}
        customerEmail="ada@example.com"
      />,
    );
  });
}

async function submit(): Promise<void> {
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("CompleteOrder", () => {
  it("leads with the money, names the order, and renders nothing technical", () => {
    render(COUNTRY_FAILURE);
    const text = container.textContent ?? "";
    expect(text).toContain("Nothing more will be charged");
    expect(text).toContain("order #278931");
    expect(text).toContain("Australia or New Zealand");
    for (const secret of [
      "woocommerce_",
      "cs_secret",
      "wc_order_secret",
      "(US)",
    ]) {
      expect(container.innerHTML).not.toContain(secret);
    }
  });

  it("offers only the countries WooCommerce accepts, prefilled from shipping", () => {
    render(COUNTRY_FAILURE);
    const select = container.querySelector("select");
    const options = [...(select?.options ?? [])].map((o) => o.value);
    expect(options).toEqual(["", "AU", "NZ"]);
    expect(select?.value).toBe("AU");
  });

  it("submits a billing patch and navigates on success", async () => {
    completeOrderAction.mockResolvedValue({
      ok: true,
      path: "/checkout/success/278931?key=k",
    });
    render(COUNTRY_FAILURE);
    await submit();
    expect(completeOrderAction).toHaveBeenCalledTimes(1);
    const [orderId, orderKey, sessionId, correction] = completeOrderAction.mock
      .calls[0] as [string, string, string, { side: string; fields: object }];
    expect([orderId, orderKey, sessionId]).toEqual([
      "278931",
      "wc_order_secret",
      "cs_secret",
    ]);
    expect(correction.side).toBe("billing");
    expect(correction.fields).toMatchObject({
      country: "AU",
      address1: "1 Queen Street",
      email: "ada@example.com",
    });
    expect(push).toHaveBeenCalledWith("/checkout/success/278931?key=k");
  });

  it("keeps the form and says what is still wrong on a second typed refusal", async () => {
    completeOrderAction.mockResolvedValue({
      ok: false,
      kind: "validation",
      failure: {
        ...COUNTRY_FAILURE,
        attribute: "postcode",
        message: "Please enter a valid postcode.",
        allowedCountries: [],
      },
    });
    render(COUNTRY_FAILURE);
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Please enter a valid postcode.",
    );
    expect(container.querySelector("form")).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("swaps to the refused screen when the retry is refused outright", async () => {
    completeOrderAction.mockResolvedValue({
      ok: false,
      kind: "refused",
      refusal: {
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "succeeded",
      },
    });
    render(COUNTRY_FAILURE);
    await submit();
    const text = container.textContent ?? "";
    expect(text).toContain("We couldn't place your order");
    expect(text).toContain("has been refunded");
    expect(container.querySelector("form")).toBeNull();
  });

  it("refuses to submit with a required field blank, without calling the store", async () => {
    render({ ...COUNTRY_FAILURE, attribute: "email", allowedCountries: [] });
    const input = container.querySelector("input");
    expect(container.querySelectorAll("input")).toHaveLength(1);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(completeOrderAction).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Email is required",
    );
  });

  it("renders no form for a country the store does not ship to", () => {
    render({
      ...COUNTRY_FAILURE,
      side: "shipping",
      message: "Sorry, we do not ship orders to the provided country.",
    });
    expect(container.querySelector("form")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("We need to finish your order with you");
    expect(text).toContain("Nothing more will be charged");
    expect(text).toContain("Contact us");
  });

  it("says 'your order' on the cart page, which has no order id", () => {
    render(COUNTRY_FAILURE, "");
    expect(container.textContent).toContain("your order");
    expect(container.textContent).not.toContain("#");
  });
});

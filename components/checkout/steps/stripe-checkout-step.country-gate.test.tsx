// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AddressInput } from "@headkit/sdk";
import type { AllowedCountries } from "@/lib/allowed-countries";

/**
 * The pre-charge country gate on the Payment Element (card and BNPL — both
 * confirm through `checkout.confirm()`): a disallowed billing or destination
 * country stops the Pay click before the stock hold, any session write and
 * the confirm, and shows the sentence.
 *
 * Covers the flows whose billing country this component can see without the
 * Billing element: Ship-to-Home "same as shipping" and the Billing-step flows.
 * The DISTINCT-billing branch (the shopper unticks the box and types an
 * address) needs the element's change events and is not driven here. The
 * prop threading from page.tsx is covered by
 * `app/checkout/country-policy-wiring.test.ts`.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const confirm = vi.fn();
const holdCheckoutStockAction = vi.fn();
const updateBillingAddress = vi.fn();
let sessionBillingCountry: string | null = null;

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  PaymentElement: () => <div />,
  BillingAddressElement: () => <div />,
  CurrencySelectorElement: () => <div />,
  useCheckout: () => ({
    type: "success",
    checkout: {
      confirm,
      total: { total: { amount: "$10.00" } },
      billingAddress: sessionBillingCountry
        ? { address: { country: sessionBillingCountry } }
        : null,
    },
  }),
}));
vi.mock("@/app/checkout/checkout-actions-context", () => ({
  useCheckoutActions: () => ({ actions: { updateBillingAddress } }),
}));
vi.mock("@/app/checkout/actions", () => ({
  holdCheckoutStockAction: (...args: unknown[]) =>
    holdCheckoutStockAction(...args),
  releaseCheckoutStockAction: vi.fn(),
}));
vi.mock("@/components/checkout/stock-alerts", () => ({
  useStockRefusal: () => vi.fn(),
}));
vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));
vi.mock("@/lib/checkout-billing-cookie", () => ({
  writeBillingAddressCookie: () => {},
}));

const POLICY: AllowedCountries = {
  billing: { countries: ["AU", "NZ"], mode: "specific" },
  shipping: { countries: ["AU"], mode: "specific" },
};

const address = (country: string): AddressInput => ({
  firstName: "Ada",
  lastName: "Lovelace",
  address1: "1 Main St",
  city: "Town",
  state: "",
  postcode: "1000",
  country,
});

let container: HTMLDivElement;
let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

async function clickPay(props: Record<string, unknown>): Promise<void> {
  const { StripePaymentStep } = await import("./stripe-checkout-step");
  await act(async () => {
    root.render(<StripePaymentStep sessionId="cs_test_1" {...props} />);
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("no Pay button");
  await act(async () => {
    button.click();
    // Ship-to-Home waits two animation frames for the billing element to
    // unmount before it holds and confirms.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionBillingCountry = null;
  holdCheckoutStockAction.mockResolvedValue({ status: "held" });
  confirm.mockResolvedValue({ type: "success" });
  updateBillingAddress.mockResolvedValue({ type: "success" });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  warn.mockRestore();
});

function expectNothingCharged(): void {
  expect(holdCheckoutStockAction).not.toHaveBeenCalled();
  expect(updateBillingAddress).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
}

describe("Pay refuses a disallowed country before any charge", () => {
  it("Billing-step flow: a disallowed billing country never reaches confirm", async () => {
    await clickPay({ countryPolicy: POLICY, billingAddress: address("US") });
    expectNothingCharged();
    expect(container.textContent).toContain(
      "We can only accept payments with a billing address in Australia or New Zealand.",
    );
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[country-gate]");
  });

  it("falls back to the session's billing address when the step carries none", async () => {
    sessionBillingCountry = "US";
    await clickPay({ countryPolicy: POLICY });
    expectNothingCharged();
  });

  it("Ship-to-Home, same as shipping: the shipping address is the billing country sent", async () => {
    await clickPay({
      countryPolicy: POLICY,
      showBillingSameAsShipping: true,
      shippingAddress: address("US"),
    });
    expectNothingCharged();
    expect(container.textContent).toContain(
      "billing address is in United States",
    );
  });

  it("Ship-to-Home: an allowed billing country to a destination not shipped to is refused", async () => {
    await clickPay({
      countryPolicy: POLICY,
      showBillingSameAsShipping: true,
      shippingAddress: address("NZ"),
    });
    expectNothingCharged();
    expect(container.textContent).toContain(
      "We don't deliver to New Zealand. We deliver to Australia.",
    );
  });

  it("an allowed country proceeds to the hold and the confirm", async () => {
    await clickPay({
      countryPolicy: POLICY,
      showBillingSameAsShipping: true,
      shippingAddress: address("AU"),
    });
    expect(holdCheckoutStockAction).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("Click & Collect: the destination is not checked", async () => {
    await clickPay({
      countryPolicy: POLICY,
      billingAddress: address("NZ"),
      shippingAddress: address("NZ"),
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("no policy gates nothing", async () => {
    await clickPay({ billingAddress: address("US") });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

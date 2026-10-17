// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Checkpoint C3 on the Payment Element (checkout plan v3 §1): the Pay click
 * reserves the cart's stock BEFORE `checkout.confirm()`, confirms only on held
 * or not-required, and after a failed confirm asks commerce to release — which
 * commerce decides on the live PaymentIntent, not this component.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
const confirm = vi.fn();
const holdCheckoutStockAction = vi.fn();
const releaseCheckoutStockAction = vi.fn();
const handleStockRefusal = vi.fn();

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  PaymentElement: () => <div />,
  BillingAddressElement: () => <div />,
  CurrencySelectorElement: () => <div />,
  useCheckout: () => ({
    type: "success",
    checkout: { confirm, total: { total: { amount: "$10.00" } } },
  }),
}));
vi.mock("@/app/checkout/checkout-actions-context", () => ({
  useCheckoutActions: () => ({ actions: null }),
}));
vi.mock("@/app/checkout/actions", () => ({
  holdCheckoutStockAction: (...args: unknown[]) =>
    holdCheckoutStockAction(...args),
  releaseCheckoutStockAction: (...args: unknown[]) =>
    releaseCheckoutStockAction(...args),
}));
vi.mock("@/components/checkout/stock-alerts", () => ({
  useStockRefusal: () => handleStockRefusal,
}));
vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));
vi.mock("@/lib/checkout-billing-cookie", () => ({
  writeBillingAddressCookie: () => {},
}));

let container: HTMLDivElement;
let root: Root;

async function clickPay(): Promise<void> {
  const { StripePaymentStep } = await import("./stripe-checkout-step");
  await act(async () => {
    root.render(<StripePaymentStep sessionId="cs_test_1" />);
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("no Pay button");
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  holdCheckoutStockAction.mockImplementation(async () => {
    calls.push("hold");
    return { status: "held" };
  });
  confirm.mockImplementation(async () => {
    calls.push("confirm");
    return { type: "success" };
  });
  releaseCheckoutStockAction.mockResolvedValue(undefined);
  handleStockRefusal.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Pay click on the Payment Element", () => {
  it("holds the stock for this session BEFORE confirming", async () => {
    await clickPay();
    expect(holdCheckoutStockAction).toHaveBeenCalledWith("cs_test_1");
    expect(calls).toEqual(["hold", "confirm"]);
    expect(releaseCheckoutStockAction).not.toHaveBeenCalled();
  });

  it("confirms when nothing needs holding", async () => {
    holdCheckoutStockAction.mockResolvedValue({ status: "not_required" });
    await clickPay();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "refused",
      { status: "refused", issues: [{ code: "OUT_OF_STOCK", itemKey: "k" }] },
    ],
    ["unavailable", { status: "unavailable" }],
  ])(
    "does NOT confirm when the hold is %s, and hands it to the in-place correction",
    async (_label, outcome) => {
      holdCheckoutStockAction.mockResolvedValue(outcome);
      await clickPay();
      expect(confirm).not.toHaveBeenCalled();
      expect(handleStockRefusal).toHaveBeenCalledWith(outcome);
      // The Pay button is usable again for the retry.
      expect(container.querySelector("button")?.disabled).toBe(false);
    },
  );

  it("asks commerce to release after a failed confirm", async () => {
    confirm.mockResolvedValue({
      type: "error",
      error: { message: "Your card was declined." },
    });
    await clickPay();
    expect(releaseCheckoutStockAction).toHaveBeenCalledWith({
      checkoutSessionId: "cs_test_1",
    });
    expect(container.textContent).toContain("Your card was declined.");
  });

  it("asks commerce to release when confirm throws", async () => {
    confirm.mockRejectedValue(new Error("network"));
    await clickPay();
    expect(releaseCheckoutStockAction).toHaveBeenCalledWith({
      checkoutSessionId: "cs_test_1",
    });
  });
});

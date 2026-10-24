// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The processing poller: a refusal stamped mid-poll REPLACES the processing
 * screen in place (no route, so no flash of "processing"), and cancel /
 * expiry return the shopper to `/checkout` — never to `/checkout/error`,
 * which the poller cannot know is warranted. The first poll runs on mount.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
const getCheckoutSessionAction = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/app/checkout/actions", () => ({
  getCheckoutSessionAction: (...args: unknown[]) =>
    getCheckoutSessionAction(...args),
}));

const { PaymentProcessingPoller } = await import("./payment-processing-poller");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // Default: still settling — immediate mount poll must not route away.
  getCheckoutSessionAction.mockResolvedValue({
    status: "complete",
    paymentStatus: "unpaid",
    paymentIntentStatus: "processing",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <PaymentProcessingPoller sessionId="cs_1">
        <p>Your payment is processing</p>
      </PaymentProcessingPoller>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_500);
  });
}

describe("PaymentProcessingPoller", () => {
  it("renders its children until something terminal happens", async () => {
    await mount();
    expect(container.textContent).toBe("Your payment is processing");
  });

  it("swaps to the refused screen in place when the session carries a refusal", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      status: "complete",
      paymentStatus: "paid",
      orderId: "0",
      orderFailure: {
        reason: "woocommerce_rest_product_out_of_stock",
        message: "Item is out of stock.",
        refundStatus: "succeeded",
      },
    });
    await mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCheckoutSessionAction).toHaveBeenCalled();
    expect(container.textContent).toContain("We couldn't place your order");
    expect(container.textContent).not.toContain("Your payment is processing");
    expect(replace).not.toHaveBeenCalled();
    const reads = getCheckoutSessionAction.mock.calls.length;
    await tick();
    expect(getCheckoutSessionAction.mock.calls.length).toBe(reads);
  });

  it("returns a cancelled authorization to /checkout for sold-out correction", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      status: "complete",
      paymentStatus: "unpaid",
      paymentIntentStatus: "canceled",
    });
    await mount();
    expect(replace).toHaveBeenCalledWith("/checkout");
  });

  it("routes stock auth-released refusals to /checkout, not OrderRefused", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      status: "complete",
      paymentStatus: "unpaid",
      orderFailure: {
        reason: "woocommerce_rest_product_out_of_stock",
        message: "Item is out of stock.",
        refundStatus: "authorization_released",
      },
    });
    await mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith("/checkout");
    expect(container.textContent).not.toContain("We couldn't place your order");
  });

  it("returns an expired session to /checkout, not the dead end", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      status: "expired",
      paymentStatus: "unpaid",
    });
    await mount();
    expect(replace).toHaveBeenCalledWith("/checkout?error=session_expired");
  });

  it("routes a paid session with a real order to its confirmation", async () => {
    getCheckoutSessionAction.mockResolvedValue({
      status: "complete",
      paymentStatus: "paid",
      orderId: "12",
      orderKey: "k",
    });
    await mount();
    expect(replace).toHaveBeenCalledWith(
      "/checkout/success/12?key=k&session_id=cs_1",
    );
  });
});

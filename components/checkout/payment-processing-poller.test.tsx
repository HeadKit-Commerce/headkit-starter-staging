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

// One instance, as Next's own useRouter returns: a fresh object per render
// would restart the poller's effect on every state change.
const router = { replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/checkout/actions", () => ({
  getCheckoutSessionAction: (...args: unknown[]) =>
    getCheckoutSessionAction(...args),
}));

const { PaymentProcessingPoller } = await import("./payment-processing-poller");
const {
  PAYMENT_TIMED_OUT_BODY,
  PAYMENT_TIMED_OUT_HEADING,
  PAYMENT_TIMED_OUT_REASSURANCE,
} = await import("./payment-processing-timed-out");

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

async function tick(ms = 2_500): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Runs out the fast window (120s) with the session still settling. */
async function timeOut(): Promise<void> {
  await mount();
  await tick(120_000);
}

function checkAgainButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Check again"),
  );
  if (!button) throw new Error("no Check again button");
  return button;
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

  it("routes a release-pending Afterpay refusal to /checkout naming Afterpay", async () => {
    // Hold-first: commerce holds an Afterpay release until the shopper is
    // back, so the first read after the return bridge can still be pending.
    getCheckoutSessionAction.mockResolvedValue({
      status: "complete",
      paymentStatus: "unpaid",
      paymentIntentStatus: "requires_capture",
      paymentMethodType: "afterpay_clearpay",
      orderFailure: {
        reason: "woocommerce_rest_product_out_of_stock",
        refundStatus: "authorization_release_pending",
      },
    });
    await mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith("/checkout?released_by=afterpay");
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

  describe("when the fast window runs out", () => {
    it("keeps the processing screen up until 120s", async () => {
      await mount();
      await tick(117_500);
      expect(container.textContent).toBe("Your payment is processing");
    });

    it("replaces the processing screen with copy that is true either way", async () => {
      await timeOut();
      const text = container.textContent ?? "";
      expect(text).not.toContain("Your payment is processing");
      expect(text).toContain(PAYMENT_TIMED_OUT_HEADING);
      expect(text).toContain(PAYMENT_TIMED_OUT_BODY);
      expect(text).toContain(PAYMENT_TIMED_OUT_REASSURANCE);
      // Never a success or a failure claim.
      expect(text).not.toMatch(/order (has been|was) (confirmed|placed)/i);
      expect(text).not.toMatch(/couldn't place|not placed|failed|declined/i);
      expect(replace).not.toHaveBeenCalled();
    });

    it("keeps checking behind it and routes a late paid order immediately", async () => {
      await timeOut();
      getCheckoutSessionAction.mockResolvedValue({
        status: "complete",
        paymentStatus: "paid",
        orderId: "12",
        orderKey: "k",
      });
      await tick(15_000);
      expect(replace).toHaveBeenCalledWith(
        "/checkout/success/12?key=k&session_id=cs_1",
      );
    });

    it("shows the refusal when commerce stamps a refused capture later", async () => {
      await timeOut();
      getCheckoutSessionAction.mockResolvedValue({
        status: "complete",
        paymentStatus: "unpaid",
        paymentIntentStatus: "canceled",
        paymentMethodType: "card",
        orderFailure: {
          reason: "headkit_capture_refused",
          message:
            "We couldn't complete your payment with your payment provider, so your order was not placed.",
          refundStatus: "authorization_released",
        },
      });
      await tick(15_000);
      const text = container.textContent ?? "";
      expect(text).toContain("We couldn't place your order");
      expect(text).toContain(
        "We couldn't complete your payment with your payment provider",
      );
      expect(text).toContain("Your card was not charged.");
      expect(text).not.toContain(PAYMENT_TIMED_OUT_HEADING);
      expect(replace).not.toHaveBeenCalled();
    });

    it("checks again straight away when asked", async () => {
      await timeOut();
      const reads = getCheckoutSessionAction.mock.calls.length;
      getCheckoutSessionAction.mockResolvedValue({
        status: "expired",
        paymentStatus: "unpaid",
      });
      await act(async () => {
        checkAgainButton().click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(getCheckoutSessionAction.mock.calls.length).toBe(reads + 1);
      expect(replace).toHaveBeenCalledWith("/checkout?error=session_expired");
    });

    it("stops the background checks after 15 minutes but still checks on request", async () => {
      await timeOut();
      await tick(15 * 60_000);
      const reads = getCheckoutSessionAction.mock.calls.length;
      await tick(60_000);
      expect(getCheckoutSessionAction.mock.calls.length).toBe(reads);
      await act(async () => {
        checkAgainButton().click();
        await Promise.resolve();
      });
      expect(getCheckoutSessionAction.mock.calls.length).toBe(reads + 1);
    });
  });
});

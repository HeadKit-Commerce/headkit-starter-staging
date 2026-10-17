// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Rehearsal S1: a C3 stock refusal at Pay put checkout on its error screen,
 * "IntegrationError: This Element has already been destroyed". The thrower was
 * this badge in the order summary, not the payment form: from a buyer country
 * Stripe rejects (measured from a Thai IP), the element reports `loaderror`
 * and Stripe destroys it, while react-stripe-js keeps it and forwards the next
 * options change to it. The stock correction changes the total, the total is
 * the badge's `amount`, and the throw from that passive effect reaches the
 * route's error boundary. Any other total change did the same (a shipping
 * rate at Delivery, measured on the local starter against staging).
 *
 * The fake element below behaves as measured: `loaderror` on mount, then a
 * throw on any later options update.
 */

const getStripePromise = vi.fn((..._args: unknown[]) => Promise.resolve(null));
vi.mock("@/lib/stripe-js-singleton", () => ({
  getStripePromise: (...args: unknown[]) => getStripePromise(...args),
}));
vi.mock("@/lib/stripe-appearance", () => ({
  buildCheckoutAppearance: () => ({}),
  buildCheckoutFonts: () => [],
}));

function RejectedMessagingElement({
  options,
  onLoadError,
}: {
  options: { amount: number };
  onLoadError?: () => void;
}) {
  const destroyed = useRef(false);
  const firstAmount = useRef(options.amount);
  useEffect(() => {
    destroyed.current = true;
    onLoadError?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (destroyed.current && options.amount !== firstAmount.current) {
      throw new Error(
        "IntegrationError: This Element has already been destroyed. Please create a new one.",
      );
    }
  }, [options.amount]);
  return <div data-testid="pmm-element" />;
}

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentMethodMessagingElement: (props: {
    options: { amount: number };
    onLoadError?: () => void;
  }) => <RejectedMessagingElement {...props} />,
}));

const { PaymentMethodMessaging } = await import("./payment-messaging");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const uncaught: unknown[] = [];

beforeEach(() => {
  uncaught.length = 0;
  // Collapse the deferral (load → idle → near the viewport) to "now".
  vi.stubGlobal("requestIdleCallback", (cb: IdleRequestCallback): number => {
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(): void {
        this.cb(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect(): void {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container, {
    onUncaughtError: (error) => {
      uncaught.push(error);
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderBadge(price: number): Promise<void> {
  await act(async () => {
    root.render(
      <PaymentMethodMessaging
        price={price}
        currency="AUD"
        publishableKey="pk_test_platform"
        stripeAccountId="acct_123"
        enabled
      />,
    );
  });
}

it("a badge Stripe refused to load is never updated when the total changes", async () => {
  // The cart before the stock correction, then after it (A$41.90 → A$31.95).
  await renderBadge(41.9);
  await renderBadge(31.95);

  expect(uncaught).toEqual([]);
  // The host stays (it carries no height of its own); the element is gone.
  expect(
    container.querySelector('[data-testid="bnpl-messaging"]'),
  ).not.toBeNull();
  expect(container.querySelector('[data-testid="pmm-element"]')).toBeNull();
});

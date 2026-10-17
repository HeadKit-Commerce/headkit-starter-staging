// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// What Stripe.js is initialised WITH is the whole contract here: a Connect store
// must name its connected account, and a direct-mode (enterprise, own-key)
// store must name none — a `stripeAccount` there asks Stripe for a connected
// account the merchant's own key does not have. The Element and Stripe.js are
// stubbed; only the init call is observed.
const getStripePromise = vi.fn((..._args: unknown[]) => Promise.resolve(null));
vi.mock("@/lib/stripe-js-singleton", () => ({
  getStripePromise: (...args: unknown[]) => getStripePromise(...args),
}));
vi.mock("@/lib/stripe-appearance", () => ({
  buildCheckoutAppearance: () => ({}),
  buildCheckoutFonts: () => [],
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="elements">{children}</div>
  ),
  PaymentMethodMessagingElement: ({
    options,
  }: {
    options: { amount: number; currency: string };
  }) => (
    <div
      data-testid="pmm-element"
      data-amount={options.amount}
      data-currency={options.currency}
    />
  ),
}));

const { PaymentMethodMessaging } = await import("./payment-messaging");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getStripePromise.mockClear();
  // Collapse the deferral (load → idle → near the viewport) to "now": what is
  // under test is what Stripe.js is initialised with once it loads.
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
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderBadge(
  props: Partial<React.ComponentProps<typeof PaymentMethodMessaging>>,
): Promise<void> {
  await act(async () => {
    root.render(
      <PaymentMethodMessaging
        price={129.95}
        currency="AUD"
        publishableKey="pk_live_store"
        enabled
        {...props}
      />,
    );
  });
}

describe("PaymentMethodMessaging Stripe.js init", () => {
  it("Connect: initialises with the platform key AND the connected account", async () => {
    await renderBadge({
      publishableKey: "pk_live_platform",
      stripeAccountId: "acct_123",
    });

    expect(getStripePromise).toHaveBeenCalledTimes(1);
    expect(getStripePromise).toHaveBeenCalledWith("pk_live_platform", {
      stripeAccount: "acct_123",
    });
  });

  it("direct mode: initialises with the store's own key and NO stripeAccount", async () => {
    await renderBadge({ publishableKey: "pk_live_own", stripeAccountId: "" });

    expect(getStripePromise).toHaveBeenCalledTimes(1);
    const [key, options] = getStripePromise.mock.calls[0] ?? [];
    expect(key).toBe("pk_live_own");
    expect(options).toEqual({});
    expect(options).not.toHaveProperty("stripeAccount");

    const element = container.querySelector('[data-testid="pmm-element"]');
    expect(element?.getAttribute("data-amount")).toBe("12995");
    expect(element?.getAttribute("data-currency")).toBe("AUD");
  });

  it("direct mode with a null account id is the same as empty", async () => {
    await renderBadge({ publishableKey: "pk_test_own", stripeAccountId: null });

    expect(getStripePromise).toHaveBeenCalledWith("pk_test_own", {});
  });

  it("never loads Stripe.js when commerce answered the badge off", async () => {
    await renderBadge({ stripeAccountId: "", enabled: false });

    expect(getStripePromise).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
  });

  it("never loads Stripe.js without a publishable key (Shopify / no Stripe)", async () => {
    await renderBadge({ publishableKey: "", stripeAccountId: "" });

    expect(getStripePromise).not.toHaveBeenCalled();
  });

  it("renders no Element for a zero amount", async () => {
    await renderBadge({ price: 0, stripeAccountId: "" });

    expect(container.querySelector('[data-testid="pmm-element"]')).toBeNull();
  });
});

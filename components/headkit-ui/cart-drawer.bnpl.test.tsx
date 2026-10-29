// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The bag shows Stripe's "4 interest-free payments" line under its subtotal.
 *
 * `PaymentMethodMessaging` was mounted by the PDP and by checkout's Total row
 * but never by this drawer. The drawer is client-only and mounted with no
 * server props, so it reads the store's Stripe config through a server action.
 *
 * WHAT THIS PROVES is the wiring, against the REAL `PaymentMethodMessaging` gate
 * (only Stripe.js is stubbed): the config is requested on the first OPEN and
 * not before, never in quote mode, and only once; the badge host exists when the
 * store's `bnplMessagingEnabled` is on and does not exist when it is off; and the
 * element is handed the drawer's own subtotal and currency. Whether Stripe then
 * paints a message is decided server-side by buyer IP country and amount, so it
 * cannot be observed here.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children?: React.ReactNode;
  }): React.JSX.Element => <a href={href}>{children}</a>,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: () => null,
  SheetFooter: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sheet-footer">{children}</div>
  ),
  SheetHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: React.ComponentProps<"button">) => (
    <button>{children}</button>
  ),
}));

vi.mock("@/components/headkit-ui/cart-item", () => ({
  CartItemRow: (): null => null,
}));

vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <a>{children}</a>,
}));

vi.mock("@/components/headkit-ui/client-theme-provider", () => ({
  useClientTheme: (): Record<string, never> => ({}),
}));

vi.mock("@/lib/cart-actions", () => ({
  getCartAction: async (): Promise<null> => null,
  updateCartAttributesAction: async (): Promise<{ success: false }> => ({
    success: false,
  }),
}));

vi.mock("@/lib/ga4-ecommerce", () => ({
  buildViewCartFromCart: (): null => null,
  pushGa4Ecommerce: (): void => {},
}));

const messaging = vi.hoisted(() => ({
  element: [] as Array<Record<string, unknown>>,
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  PaymentMethodMessagingElement: ({
    options,
  }: {
    options: Record<string, unknown>;
  }) => {
    messaging.element.push(options);
    return <div data-testid="pmm-element" />;
  },
}));
vi.mock("@/lib/stripe-js-singleton", () => ({
  getStripePromise: () => Promise.resolve({}),
}));
vi.mock("@/lib/stripe-appearance", () => ({
  buildCheckoutAppearance: () => ({ theme: "flat" }),
  buildCheckoutFonts: () => [],
}));

const configAction = vi.hoisted(() => ({
  calls: 0,
  result: (): Promise<Record<string, unknown>> =>
    Promise.resolve({
      publishableKey: "pk_test_123",
      accountId: "acct_123",
      bnplMessagingEnabled: true,
    }),
}));
vi.mock("@/lib/stripe-bnpl-config-action", () => ({
  getStripeBnplConfigAction: (): Promise<Record<string, unknown>> => {
    configAction.calls += 1;
    return configAction.result();
  },
}));

let isQuoteMode = false;
vi.mock("@/components/checkout/checkout-mode-provider", () => ({
  useIsQuoteMode: (): boolean => isQuoteMode,
}));

const CART_DATA = {
  items: [
    {
      key: "item-1",
      name: "Test Bike",
      images: [],
      variation: [],
      quantity: 1,
      totals: { total: "50000", subtotal: "50000" },
      giftCard: null,
      addons: [],
    },
  ],
  itemsCount: 1,
  currency: { code: "AUD", symbol: "$", minorUnit: 2 },
  totals: { totalPrice: "500", totalItems: "500", totalItemsTax: "0" },
};

let cartContext: {
  cartData: unknown;
  optimisticCart: unknown;
  setCartData: () => void;
  cartOpen: boolean;
  toggleCart: () => void;
  bagAlerts: never[];
  setBagAlerts: () => void;
};
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => cartContext,
}));

function context(overrides: Partial<typeof cartContext> = {}): void {
  cartContext = {
    cartData: CART_DATA,
    optimisticCart: null,
    setCartData: () => {},
    cartOpen: true,
    toggleCart: () => {},
    bagAlerts: [],
    setBagAlerts: () => {},
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(): Promise<void> {
  const { CartDrawer } = await import("@/components/headkit-ui/cart-drawer");
  await act(async () => {
    root.render(<CartDrawer />);
  });
  // Flush the action's resolution, then the badge's deferral.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  messaging.element.length = 0;
  configAction.calls = 0;
  configAction.result = () =>
    Promise.resolve({
      publishableKey: "pk_test_123",
      accountId: "acct_123",
      bnplMessagingEnabled: true,
    });
  isQuoteMode = false;
  context();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("cart drawer BNPL messaging", () => {
  it("mounts the badge under the subtotal with the drawer's own total and currency", async () => {
    await render();

    const host = container.querySelector('[data-testid="bnpl-messaging"]');
    expect(host).not.toBeNull();
    expect(configAction.calls).toBe(1);
    expect(messaging.element).toEqual([
      expect.objectContaining({ amount: 50000, currency: "AUD" }),
    ]);

    const footer = container.querySelector('[data-testid="sheet-footer"]');
    expect(footer?.contains(host)).toBe(true);
    expect(
      footer?.textContent?.indexOf("Shipping calculated at checkout"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("renders no badge when the store's bnplMessagingEnabled is off", async () => {
    configAction.result = () =>
      Promise.resolve({
        publishableKey: "pk_test_123",
        accountId: "acct_123",
        bnplMessagingEnabled: false,
      });

    await render();

    expect(configAction.calls).toBe(1);
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
    expect(messaging.element).toHaveLength(0);
  });

  it("renders no badge for a store with no Stripe publishable key", async () => {
    configAction.result = () =>
      Promise.resolve({
        publishableKey: "",
        accountId: "",
        bnplMessagingEnabled: false,
      });

    await render();

    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
  });

  it("asks for the config on the first open, not while the bag is closed", async () => {
    context({ cartOpen: false });
    await render();
    expect(configAction.calls).toBe(0);
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();

    context({ cartOpen: true });
    await render();
    expect(configAction.calls).toBe(1);
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).not.toBeNull();

    // Closing and reopening reuses what it already has.
    context({ cartOpen: false });
    await render();
    context({ cartOpen: true });
    await render();
    expect(configAction.calls).toBe(1);
  });

  it("never fetches or mounts the badge in quote mode", async () => {
    isQuoteMode = true;

    await render();

    expect(configAction.calls).toBe(0);
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
  });

  it("mounts nothing while the bag has no items", async () => {
    context({ cartData: { ...CART_DATA, items: [], itemsCount: 0 } });

    await render();

    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
  });

  it("keeps the bag working when the config read fails", async () => {
    configAction.result = () => Promise.reject(new Error("boom"));

    await render();

    expect(configAction.calls).toBe(1);
    expect(
      container.querySelector('[data-testid="bnpl-messaging"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Shipping calculated at checkout");
  });
});

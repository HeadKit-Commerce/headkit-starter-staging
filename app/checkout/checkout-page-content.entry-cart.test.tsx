// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CartFieldsFragment } from "@headkit/sdk";
import {
  CartProvider,
  useCartContext,
} from "@/components/headkit-ui/cart-context";

/**
 * Rehearsal S2: on the checkout load that corrects the cart at entry (C1),
 * the order summary and the bag badge showed the line checkout had just
 * removed — its total and the old item count — beside the "has been removed"
 * alert. The context already held a cart read before the correction (from
 * client navigation, or the layout's badge read), and checkout only adopted
 * its corrected cart into an EMPTY context.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/checkout/actions", () => ({
  createCheckoutSessionAction: vi.fn(),
  getCheckoutAction: vi.fn(),
  expireCheckoutSessionAction: vi.fn(async () => undefined),
  updateCustomerAction: vi.fn(),
}));
vi.mock("@/lib/register-checkout-session", () => ({
  registerActiveCheckoutSession: vi.fn(async () => undefined),
}));
vi.mock("@/lib/cart-actions", () => ({
  getFullCartAction: vi.fn(async () => null),
}));
// The form itself is not under test: render only the summary it is handed.
vi.mock("@/app/checkout/CheckoutForm", () => ({
  CheckoutForm: ({ cartSidebar }: { cartSidebar: ReactNode }) => (
    <div>{cartSidebar}</div>
  ),
}));
// The summary lists what the cart context holds, as the real one does.
vi.mock("@/components/checkout/cart", () => ({
  Cart: () => {
    const { cartData } = useCartContext();
    return (
      <ul data-testid="summary">
        {cartData?.items.map((item) => (
          <li key={item.key}>{item.name}</li>
        ))}
      </ul>
    );
  },
}));

function line(key: string, name: string): CartFieldsFragment["items"][number] {
  return { key, name } as unknown as CartFieldsFragment["items"][number];
}

function cartOf(
  items: CartFieldsFragment["items"],
  totalItems: string,
): CartFieldsFragment {
  return {
    token: "tok",
    items,
    itemsCount: items.length,
    needsShipping: true,
    shippingRates: [],
    paymentMethods: [],
    currency: { code: "AUD", symbol: "$", minorUnit: 2 },
    totals: {
      totalItems,
      totalItemsTax: "0",
      totalPrice: totalItems,
    },
  } as unknown as CartFieldsFragment;
}

const preCorrection = cartOf(
  [line("a", "Shock Bolt"), line("b", "Specialized MY16 Hanger")],
  "41.90",
);
const corrected = cartOf([line("a", "Shock Bolt")], "31.95");

/** Puts the pre-correction cart in the context before checkout mounts. */
function Seed({ cart }: { cart: CartFieldsFragment }) {
  const { setCartData } = useCartContext();
  useEffect(() => {
    setCartData(cart);
  }, [cart, setCartData]);
  return null;
}

function Badge() {
  const { cartData } = useCartContext();
  return <span data-testid="badge">{cartData?.itemsCount ?? 0}</span>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("shows the cart checkout corrected at entry, not the one the context held", async () => {
  await act(async () => {
    root.render(
      <CartProvider>
        <Seed cart={preCorrection} />
        <Badge />
      </CartProvider>,
    );
  });
  expect(container.querySelector('[data-testid="badge"]')?.textContent).toBe(
    "2",
  );

  const { CheckoutPageContent } = await import("./checkout-page-content");
  await act(async () => {
    root.render(
      <CartProvider>
        <Seed cart={preCorrection} />
        <Badge />
        <CheckoutPageContent
          initialCart={corrected}
          initialStockAlerts={[
            { kind: "removed", name: "Specialized MY16 Hanger" },
          ]}
          checkoutSession={{
            clientSecret: "cs_secret",
            sessionId: "cs_test_1",
            publishableKey: "pk_test_1",
          }}
        />
      </CartProvider>,
    );
  });

  const summary = container.querySelector('[data-testid="summary"]');
  expect(summary?.textContent).toContain("Shock Bolt");
  expect(summary?.textContent).not.toContain("Specialized MY16 Hanger");
  expect(container.querySelector('[data-testid="badge"]')?.textContent).toBe(
    "1",
  );
  // The alert still names the removed line.
  expect(container.textContent).toContain("Specialized MY16 Hanger");
  // The mobile summary total is the corrected one.
  expect(container.textContent).toContain("31.95");
  expect(container.textContent).not.toContain("41.90");
});

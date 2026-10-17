// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CartProvider } from "./cart-context";

/**
 * The badge refresh must not run on a /checkout load (rehearsal S2). The page
 * corrects the cart at entry and adopts the corrected cart itself; this read
 * could land the pre-correction cart after it, and the cookie it sets
 * re-renders the route mid-stream, which drops the per-item alert.
 */

const getCartAction = vi.fn(async () => null);
vi.mock("@/lib/cart-actions", () => ({
  getCartAction: () => getCartAction(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { LazyCartDrawer, isCheckoutEntryPath } =
  await import("./lazy-cart-drawer");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getCartAction.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
});

async function mountAt(path: string): Promise<void> {
  window.history.replaceState(null, "", path);
  await act(async () => {
    root.render(
      <CartProvider>
        <LazyCartDrawer />
      </CartProvider>,
    );
  });
}

it("skips the badge read on the checkout page", async () => {
  await mountAt("/checkout");
  expect(getCartAction).not.toHaveBeenCalled();
});

it("skips it on a checkout URL carrying a query", async () => {
  await mountAt("/checkout?error=payment_failed");
  expect(getCartAction).not.toHaveBeenCalled();
});

it.each(["/", "/products/shock-bolt", "/checkout/success/278977"])(
  "reads the cart for the badge on %s",
  async (path) => {
    await mountAt(path);
    expect(getCartAction).toHaveBeenCalledTimes(1);
  },
);

it("matches only the checkout entry path", () => {
  expect(isCheckoutEntryPath("/checkout")).toBe(true);
  expect(isCheckoutEntryPath("/checkout/")).toBe(true);
  expect(isCheckoutEntryPath("/checkout/success")).toBe(false);
  expect(isCheckoutEntryPath("/checkout/error")).toBe(false);
  expect(isCheckoutEntryPath("/checkouts")).toBe(false);
});

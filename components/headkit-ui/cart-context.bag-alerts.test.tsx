// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CartProvider, useCartContext } from "./cart-context";
import { bagUrl } from "@/lib/stock-hold";

/**
 * When checkout entry empties the cart it redirects to the bag with the alerts
 * in `?bag_alerts=` (lib/stock-hold.ts). The root layout's cart provider opens
 * the bag with them, read from window.location in an effect — never a
 * request-time read — and removes the parameter from the address bar.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const seen: { current: { open: boolean; alerts: unknown[] } | null } = {
  current: null,
};

function Probe() {
  const { cartOpen, bagAlerts } = useCartContext();
  seen.current = { open: cartOpen, alerts: bagAlerts };
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  seen.current = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
});

it("opens the bag with the alerts checkout sent, and strips the parameter", async () => {
  window.history.replaceState(
    null,
    "",
    `${bagUrl([{ kind: "removed", name: "Base Layer – Small" }])}&utm=x#top`,
  );
  await act(async () => {
    root.render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
  });
  expect(seen.current).toEqual({
    open: true,
    alerts: [{ kind: "removed", name: "Base Layer – Small" }],
  });
  expect(window.location.search).toBe("?utm=x");
  expect(window.location.hash).toBe("#top");
});

it("leaves the bag closed on an ordinary page load", async () => {
  await act(async () => {
    root.render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
  });
  expect(seen.current).toEqual({ open: false, alerts: [] });
});

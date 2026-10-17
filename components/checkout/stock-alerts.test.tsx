// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HoldOutcome, StockAlert } from "@/lib/stock-hold";

/**
 * Checkpoints C2/C3 (checkout plan v3 §2.2): on a refusal the shopper STAYS on
 * checkout — unavailable lines removed, short lines reduced, the session kept
 * (the corrected cart re-syncs it), one alert per item. Checkout is left only
 * when the corrections empty the cart, for the bag, with the same alerts.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const setCartData = vi.fn();
const setBagAlerts = vi.fn();
const toggleCart = vi.fn();
const push = vi.fn();
const correctCartAction = vi.fn();
const getFullCartAction = vi.fn();

const cartData = {
  itemsCount: 4,
  items: [
    {
      key: "k-small",
      name: "Base Layer",
      quantity: 1,
      variation: [{ attribute: "Size", value: "Small" }],
    },
    { key: "k-gloves", name: "Gloves", quantity: 3, variation: [] },
  ],
};

vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({ cartData, setCartData, setBagAlerts, toggleCart }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/checkout/actions", () => ({
  correctCartAction: (...args: unknown[]) => correctCartAction(...args),
}));
vi.mock("@/lib/cart-actions", () => ({
  getFullCartAction: (...args: unknown[]) => getFullCartAction(...args),
}));

let container: HTMLDivElement;
let root: Root;
let handle: ((outcome: HoldOutcome) => Promise<void>) | null = null;

async function mount(initialAlerts: StockAlert[] = []): Promise<void> {
  const { StockAlertsProvider, useStockRefusal } =
    await import("./stock-alerts");
  function Probe() {
    handle = useStockRefusal();
    return null;
  }
  await act(async () => {
    root.render(
      <StockAlertsProvider initialAlerts={initialAlerts}>
        <Probe />
      </StockAlertsProvider>,
    );
  });
}

async function refuse(outcome: HoldOutcome): Promise<void> {
  await act(async () => {
    await handle?.(outcome);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useStockRefusal", () => {
  it("corrects the named lines in place, keeps the session, and shows one alert per item", async () => {
    correctCartAction.mockResolvedValue({ itemsCount: 2, items: [] });
    await mount();
    await refuse({
      status: "refused",
      issues: [
        { code: "OUT_OF_STOCK", itemKey: "k-small", available: 0 },
        { code: "INSUFFICIENT_STOCK", itemKey: "k-gloves", available: 2 },
      ],
    });
    expect(correctCartAction).toHaveBeenCalledWith([
      { itemKey: "k-small", action: "remove", quantity: 0 },
      { itemKey: "k-gloves", action: "reduce", quantity: 2 },
    ]);
    expect(setCartData).toHaveBeenCalledWith({ itemsCount: 2, items: [] });
    expect(push).not.toHaveBeenCalled();
    const text = container.textContent ?? "";
    expect(text).toContain(
      "Unfortunately Base Layer – Small is now unavailable and has been removed from your cart. You have not been charged.",
    );
    expect(text).toContain(
      "Unfortunately only 2 × Gloves are available. Your cart has been updated. You have not been charged.",
    );
  });

  it("leaves checkout for the bag, with the alerts, only when the cart is now empty", async () => {
    correctCartAction.mockResolvedValue({ itemsCount: 0, items: [] });
    await mount();
    await refuse({
      status: "refused",
      issues: [{ code: "OUT_OF_STOCK", itemKey: "k-small", available: 0 }],
    });
    expect(setBagAlerts).toHaveBeenCalledWith([
      { kind: "removed", name: "Base Layer – Small" },
    ]);
    expect(toggleCart).toHaveBeenCalledWith(true);
    expect(push).toHaveBeenCalledWith("/");
    expect(container.textContent).not.toContain("Unfortunately");
  });

  it("does not rewrite an unchanged cart (which would re-sync into the same refusal forever)", async () => {
    await mount();
    await refuse({ status: "refused", issues: [{ code: "OUT_OF_STOCK" }] });
    expect(correctCartAction).not.toHaveBeenCalled();
    expect(setCartData).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Unfortunately items in your cart are now unavailable.",
    );
  });

  it("shows the retry alert when the hold could not be placed", async () => {
    await mount();
    await refuse({ status: "unavailable" });
    expect(container.textContent).toContain(
      "We couldn't reserve your items just now. Please try again — you have not been charged.",
    );
    expect(correctCartAction).not.toHaveBeenCalled();
  });

  it("stays on checkout when a correction fails", async () => {
    correctCartAction.mockResolvedValue(null);
    getFullCartAction.mockRejectedValue(new Error("down"));
    await mount();
    await refuse({
      status: "refused",
      issues: [{ code: "OUT_OF_STOCK", itemKey: "k-small", available: 0 }],
    });
    expect(push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Base Layer – Small");
  });
});

it("renders the entry corrections (C1) and lets each alert be dismissed", async () => {
  await mount([
    { kind: "removed", name: "Base Layer – Small" },
    { kind: "reduced", name: "Gloves", quantity: 1 },
  ]);
  expect(container.querySelectorAll("[data-stock-alerts] > div")).toHaveLength(
    2,
  );
  const dismiss = container.querySelector<HTMLButtonElement>(
    "button[aria-label='Dismiss']",
  );
  await act(async () => {
    dismiss?.click();
  });
  expect(container.querySelectorAll("[data-stock-alerts] > div")).toHaveLength(
    1,
  );
  expect(container.textContent).toContain("Unfortunately only 1 × Gloves is");
});

// @vitest-environment jsdom

import { expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { CheckoutFormSkeleton } from "./checkout-form-skeleton";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("paints known step titles instead of anonymous skeleton bars", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(<CheckoutFormSkeleton />);
  });
  const text = host.textContent ?? "";
  expect(text).toContain("Contact");
  expect(text).toContain("Delivery");
  expect(text).toContain("Shipping Options");
  expect(text).toContain("Payment");
  expect(text).toMatch(/Or/i);
  expect(
    host.querySelector('[data-testid="checkout-form-skeleton"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('[data-testid="checkout-express-skeleton"]'),
  ).not.toBeNull();
  await act(async () => {
    root?.unmount();
  });
  host.remove();
});

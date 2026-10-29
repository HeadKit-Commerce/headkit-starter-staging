// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

/**
 * The BNPL badge renders under Stripe's `"stripe"` theme, while the checkout
 * keeps `"flat"`.
 *
 * The defect this pins: the badge handed its own `<Elements>` the checkout's
 * shared appearance, whose `theme: "flat"` paints the Afterpay / Klarna marks
 * grey and overrides `logoColor: "color"`.
 *
 * WHAT THIS COVERS: the options the badge hands its `<Elements>` — theme
 * `"stripe"`, the checkout's brand variables and fonts carried over unchanged —
 * through the REAL `buildCheckoutAppearance`, plus the other half: that shared
 * builder still answers `"flat"`, so the Payment Element, address fields and
 * express buttons are untouched. Both directions together, because moving the
 * theme into the shared builder would pass the first assertion alone.
 *
 * WHAT IT DOES NOT COVER: no Stripe.js loads, so whether Stripe actually paints
 * colour marks under this theme is a browser claim — Stripe paints this element
 * only for a buyer in a supported country.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let elementsOptions: Record<string, unknown> | null = null;
let elementOptions: Record<string, unknown> | null = null;

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({
    children,
    options,
  }: {
    children?: ReactNode;
    options: Record<string, unknown>;
  }) => {
    elementsOptions = options;
    return <>{children}</>;
  },
  PaymentMethodMessagingElement: ({
    options,
  }: {
    options: Record<string, unknown>;
  }) => {
    elementOptions = options;
    return <div data-testid="stripe-element" />;
  },
}));

vi.mock("@/lib/stripe-js-singleton", () => ({
  getStripePromise: () => Promise.resolve({}),
}));

import {
  buildCheckoutAppearance,
  buildCheckoutFonts,
} from "@/lib/stripe-appearance";
import { PaymentMethodMessaging } from "./payment-messaging";

let container: HTMLDivElement;
let root: Root;

function installObservers(): void {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(node: Element): void {
      this.cb(
        [{ isIntersecting: true, target: node } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  class RO {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
  vi.stubGlobal("ResizeObserver", RO);
}

beforeEach(() => {
  vi.useFakeTimers();
  elementsOptions = null;
  elementOptions = null;
  installObservers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <PaymentMethodMessaging
        price={84.95}
        currency="AUD"
        publishableKey="pk_test_1"
        stripeAccountId="acct_1"
        enabled
      />,
    );
  });
  // The badge waits for an idle slot before it observes the viewport.
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BNPL messaging appearance theme", () => {
  it("hands its own <Elements> the 'stripe' theme, keeping the checkout's variables and fonts", () => {
    const shared = buildCheckoutAppearance();
    expect(elementsOptions).not.toBeNull();
    const appearance = elementsOptions!.appearance as Record<string, unknown>;
    expect(appearance.theme).toBe("stripe");
    expect(appearance.variables).toEqual(shared.variables);
    expect(elementsOptions!.fonts).toEqual(buildCheckoutFonts());
    expect(elementOptions).toMatchObject({ logoColor: "color" });
  });

  it("leaves the checkout's shared appearance on 'flat'", () => {
    expect(buildCheckoutAppearance().theme).toBe("flat");
  });
});

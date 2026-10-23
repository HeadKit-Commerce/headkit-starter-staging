import { describe, expect, it } from "vitest";
import {
  CHECKOUT_BAG_REASONS,
  CHECKOUT_BANNER_COPY,
  CHECKOUT_BANNER_FALLBACK_COPY,
  CHECKOUT_DEAD_END,
  CHECKOUT_DEAD_END_FALLBACK,
  CHECKOUT_DEAD_END_REASONS,
  CHECKOUT_RECOVERABLE_REASONS,
  checkoutBannerMessage,
  checkoutDeadEndContent,
  checkoutDeadEndPath,
  checkoutFailurePath,
  isCheckoutBagReason,
  isCheckoutDeadEndReason,
  isRecoverableCheckoutFailure,
} from "./checkout-failure";

/**
 * The checkout failure ROUTING TABLE. Both halves of the rule are asserted per
 * reason, because they fail independently: every recoverable failure lands on
 * `/checkout` (cart intact, fresh Stripe session minted on load), and no
 * destination URL carries anything but the reason. That each call site uses
 * these builders is asserted at source level in
 * `app/checkout/checkout-failure-surfaces.test.ts`.
 */

/** Things a shopper must never read in a sentence or a URL. */
const TECHNICAL = /[{}[\]]|woocommerce_|GraphQL|Error:|stack|undefined|null/;

describe("checkout failure routing table", () => {
  it.each(CHECKOUT_RECOVERABLE_REASONS.map((reason) => ({ reason })))(
    "$reason returns to /checkout with only the reason in the URL",
    ({ reason }) => {
      const url = new URL(checkoutFailurePath(reason), "https://example.test");
      expect(url.pathname).toBe("/checkout");
      expect([...url.searchParams.keys()]).toEqual(["error"]);
      expect(url.searchParams.get("error")).toBe(reason);
    },
  );

  it.each(CHECKOUT_RECOVERABLE_REASONS.map((reason) => ({ reason })))(
    "$reason has one plain, non-technical sentence",
    ({ reason }) => {
      const sentence = checkoutBannerMessage(reason);
      expect(sentence).toBe(CHECKOUT_BANNER_COPY[reason]);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toMatch(TECHNICAL);
    },
  );

  it("pins the two sentences the dismissible banners render", () => {
    expect(CHECKOUT_BANNER_COPY.payment_failed).toBe(
      "Your payment was not successful. Please try again or use a different payment method.",
    );
    expect(CHECKOUT_BANNER_COPY.cart_changed).toBe(
      "Your cart changed while your payment was in progress, so that payment was cancelled and nothing was charged. Please review your updated order and pay again.",
    );
  });

  it("routes an unknown reason to /checkout with the fallback sentence", () => {
    expect(checkoutFailurePath("something_new")).toBe(
      "/checkout?error=something_new",
    );
    expect(checkoutBannerMessage("something_new")).toBe(
      CHECKOUT_BANNER_FALLBACK_COPY,
    );
    expect(checkoutBannerMessage(null)).toBe(CHECKOUT_BANNER_FALLBACK_COPY);
    // An unknown reason may have moved money; the fallback must not promise
    // it did not.
    expect(CHECKOUT_BANNER_FALLBACK_COPY).not.toMatch(/nothing was charged/i);
  });

  it("encodes a hostile reason instead of letting it shape the URL", () => {
    const url = new URL(
      checkoutFailurePath("x&message=boom"),
      "https://example.test",
    );
    expect([...url.searchParams.keys()]).toEqual(["error"]);
    expect(url.searchParams.get("error")).toBe("x&message=boom");
  });
});

describe("checkout dead ends", () => {
  const DEAD_END_TABLE = [
    { reason: "empty_cart", title: "Your cart is empty", action: "shop" },
    {
      reason: "stock_correction_empty",
      title: "Your cart is empty",
      action: "shop",
    },
    {
      reason: "session_expired",
      title: "Your cart session has expired",
      action: "shop",
    },
    {
      reason: "item_unavailable",
      title: "An item in your cart is unavailable",
      action: "checkout",
    },
  ] as const;

  it("covers every declared dead-end reason", () => {
    expect(DEAD_END_TABLE.map((row) => row.reason).sort()).toEqual(
      [...CHECKOUT_DEAD_END_REASONS].sort(),
    );
  });

  it.each(DEAD_END_TABLE)(
    "$reason stays on /checkout/error with its own content",
    ({ reason, title, action }) => {
      const url = new URL(checkoutDeadEndPath(reason), "https://example.test");
      expect(url.pathname).toBe("/checkout/error");
      expect([...url.searchParams.keys()]).toEqual(["reason"]);
      const content = checkoutDeadEndContent(reason);
      expect(content).toEqual(CHECKOUT_DEAD_END[reason]);
      expect(content.title).toBe(title);
      expect(content.action).toBe(action);
      expect(content.body).not.toMatch(TECHNICAL);
    },
  );

  it("offers a link back to checkout for a reason that is not a dead end, never a redirect", () => {
    expect(checkoutDeadEndContent("payment_failed")).toEqual(
      CHECKOUT_DEAD_END_FALLBACK,
    );
    expect(checkoutDeadEndContent(undefined)).toEqual(
      CHECKOUT_DEAD_END_FALLBACK,
    );
    expect(CHECKOUT_DEAD_END_FALLBACK.action).toBe("checkout");
  });
});

describe("session_expired is the one reason in both classes", () => {
  it("is recoverable to a caller and a dead end only to the cart gate", () => {
    expect(isRecoverableCheckoutFailure("session_expired")).toBe(true);
    expect(isCheckoutDeadEndReason("session_expired")).toBe(true);
    expect(checkoutFailurePath("session_expired")).toBe(
      "/checkout?error=session_expired",
    );
    expect(checkoutDeadEndPath("session_expired")).toBe(
      "/checkout/error?reason=session_expired",
    );
  });

  it("is the ONLY reason in both classes", () => {
    const both = CHECKOUT_DEAD_END_REASONS.filter((reason) =>
      (CHECKOUT_RECOVERABLE_REASONS as readonly string[]).includes(reason),
    );
    expect(both).toEqual(["session_expired"]);
  });

  it("sends a caller's dead-end-only reason to the error page", () => {
    expect(checkoutFailurePath("empty_cart")).toBe(
      "/checkout/error?reason=empty_cart",
    );
  });
});

describe("stock reasons go to the bag, never a screen (checkout plan v3 §2.3)", () => {
  it("names exactly the two stock dead ends", () => {
    expect([...CHECKOUT_BAG_REASONS].sort()).toEqual([
      "item_unavailable",
      "stock_correction_empty",
    ]);
    for (const reason of CHECKOUT_BAG_REASONS) {
      expect(isCheckoutBagReason(reason)).toBe(true);
    }
    for (const other of [
      "empty_cart",
      "session_expired",
      "",
      null,
      undefined,
    ]) {
      expect(isCheckoutBagReason(other)).toBe(false);
    }
  });
});

// @vitest-environment jsdom
/**
 * The contact step must hand the shopper's email to the cart on EVERY submit,
 * prefilled or typed (checkout plan v3 §4.4).
 *
 * WHY. The store sends Klaviyo's Started Checkout (with items, and the link
 * that rebuilds the cart) from WooCommerce's update-customer route — theme
 * 0.4.82, `woocommerce_store_api_cart_update_customer_from_request`. The
 * "advance" branch — a returning shopper whose email was prefilled and is
 * already on the Stripe session — used to move on without touching the cart,
 * because Stripe forbids `updateEmail` with an unchanged value. So exactly the
 * shoppers most likely to come back never started a checkout as far as Klaviyo
 * knew. The Stripe half of that rule still holds and is asserted here too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** What useCheckout() reports: the session's email, or a non-success state. */
let checkoutState: unknown = { type: "loading" };

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  ContactDetailsElement: () => <div data-testid="stripe-contact-element" />,
  useCheckout: () => checkoutState,
}));

const updateEmail = vi.fn(async () => ({ type: "success" as const }));
vi.mock("@/app/checkout/checkout-actions-context", () => ({
  useCheckoutActions: () => ({
    isLoading: false,
    actions: {
      updateEmail,
      runServerUpdate: async (fn: () => Promise<void>) => {
        await fn();
        return { type: "success" as const };
      },
    },
  }),
}));

const CART = { token: "t", items: [] };
const updateCustomerAddressAction = vi.fn(
  async (): Promise<
    { success: true; cart: typeof CART } | { success: false; error: string }
  > => ({ success: true, cart: CART }),
);
vi.mock("@/lib/cart-actions", () => ({ updateCustomerAddressAction }));

const setCartData = vi.fn();
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({ setCartData }),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("@/lib/email-marketing-actions", () => ({
  subscribeEmailAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/subscribe-outcome", () => ({
  reportSubscribeOutcome: vi.fn(),
}));

const { ContactFormStep } = await import("./contact-form-step");

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(props: {
  enableStripe: boolean;
  email: string;
  onNext: (data: unknown) => void;
}): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ContactFormStep
        enableStripe={props.enableStripe}
        onNext={props.onNext}
        defaultValues={{ email: props.email, newsletter: false }}
      />,
    );
  });
  return host;
}

async function submit(container: HTMLDivElement): Promise<void> {
  const button = container.querySelector("button[type=submit]");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("the step rendered no submit button");
  }
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset also drops an unconsumed mockImplementationOnce, so one case's
  // scripted failure can never leak into the next.
  updateCustomerAddressAction.mockReset();
  updateCustomerAddressAction.mockImplementation(async () => ({
    success: true,
    cart: CART,
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe("ContactFormStep: the email reaches the cart on every submit", () => {
  it("a prefilled email already on the session is pushed to the cart, not to Stripe", async () => {
    checkoutState = {
      type: "success",
      checkout: { email: "returning@example.test" },
    };
    const onNext = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "returning@example.test",
      onNext,
    });

    await submit(container);

    expect(updateCustomerAddressAction).toHaveBeenCalledTimes(1);
    expect(updateCustomerAddressAction).toHaveBeenCalledWith(
      { billingAddress: { email: "returning@example.test" } },
      { keepCheckoutSession: true },
    );
    expect(setCartData).toHaveBeenCalledWith(CART);
    // Stripe forbids updateEmail with an unchanged value.
    expect(updateEmail).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("a prefilled email outside Stripe is pushed to the cart too", async () => {
    checkoutState = { type: "loading" };
    const onNext = vi.fn();
    const container = await render({
      enableStripe: false,
      email: "returning@example.test",
      onNext,
    });

    await submit(container);

    expect(updateCustomerAddressAction).toHaveBeenCalledWith(
      { billingAddress: { email: "returning@example.test" } },
      { keepCheckoutSession: true },
    );
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("a failed push never holds the shopper on the step", async () => {
    checkoutState = {
      type: "success",
      checkout: { email: "returning@example.test" },
    };
    for (const failure of [
      async () => ({ success: false as const, error: "store said no" }),
      async () => {
        throw new Error("network");
      },
    ]) {
      vi.clearAllMocks();
      updateCustomerAddressAction.mockImplementationOnce(failure);
      const onNext = vi.fn();
      const container = await render({
        enableStripe: true,
        email: "returning@example.test",
        onNext,
      });

      await submit(container);

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(setCartData).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      act(() => root?.unmount());
      host?.remove();
    }
  });

  it("an email the session lacks still goes to Stripe AND the cart, once each", async () => {
    // The update-email branch (ENG-801 safety net) is unchanged by this fix.
    checkoutState = { type: "success", checkout: { email: "" } };
    const onNext = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "returning@example.test",
      onNext,
    });

    await submit(container);

    expect(updateEmail).toHaveBeenCalledWith("returning@example.test");
    expect(updateCustomerAddressAction).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

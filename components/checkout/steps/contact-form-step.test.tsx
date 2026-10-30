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

/** The store's own customer session; signed out unless a case says otherwise. */
const setAuthToken = vi.fn();
let authState: {
  isAuthenticated: boolean;
  user: { email: string; firstName?: string } | null;
} = { isAuthenticated: false, user: null };
vi.mock("@/components/headkit-ui/auth-context", () => ({
  useAuth: () => ({ ...authState, setAuthToken }),
}));

const login = vi.fn();
vi.mock("@/lib/account-actions", () => ({ login }));

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
  signInOpen?: boolean;
  onSignInOpenChange?: (open: boolean) => void;
  onSignedIn?: (email: string) => void | Promise<void>;
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
        {...(props.signInOpen !== undefined && {
          signInOpen: props.signInOpen,
        })}
        {...(props.onSignInOpenChange && {
          onSignInOpenChange: props.onSignInOpenChange,
        })}
        {...(props.onSignedIn && { onSignedIn: props.onSignedIn })}
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
  authState = { isAuthenticated: false, user: null };
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

/** Types into a controlled React input the way a keystroke would. */
async function type(
  container: HTMLElement,
  selector: string,
  value: string,
): Promise<void> {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`no input matched ${selector}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function signInWith(
  container: HTMLDivElement,
  email: string,
  password: string,
): Promise<void> {
  await type(container, "input[type=email]", email);
  await type(container, "input[type=password]", password);
  await submit(container);
}

const SIGNED_IN = {
  success: true as const,
  data: {
    token: "jwt-token",
    refreshToken: "refresh-token",
    userId: "42",
    email: "account@example.test",
    firstName: "Ada",
    lastName: "Checkout",
  },
};

describe("ContactFormStep: the inline customer sign-in", () => {
  it("shows no sign-in panel unless the shopper opened it", async () => {
    checkoutState = { type: "loading" };
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
    });

    expect(
      container.querySelector("[data-testid=checkout-sign-in]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid=stripe-contact-element]"),
    ).not.toBeNull();
  });

  it("opening it REPLACES the step body: no contact element, no Continue", async () => {
    checkoutState = { type: "loading" };
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
      signInOpen: true,
    });

    expect(
      container.querySelector("[data-testid=checkout-sign-in]"),
    ).not.toBeNull();
    expect(container.querySelector("input[type=password]")).not.toBeNull();
    expect(
      container.querySelector("[data-testid=stripe-contact-element]"),
    ).toBeNull();
    expect(
      container.querySelector("a[href='/account/forgot-password']"),
    ).not.toBeNull();
  });

  it("a wrong password shows the error and leaves checkout untouched", async () => {
    checkoutState = { type: "loading" };
    login.mockResolvedValueOnce({
      success: false,
      error: "Invalid email or password",
    });
    const onSignedIn = vi.fn();
    const onSignInOpenChange = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
      signInOpen: true,
      onSignInOpenChange,
      onSignedIn,
    });

    await signInWith(container, "account@example.test", "wrong-password");

    expect(login).toHaveBeenCalledWith(
      "account@example.test",
      "wrong-password",
    );
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Invalid email or password",
    );
    // Nothing a failed sign-in may touch: no token, no cart write, no new
    // Checkout Session, and the panel stays up to retry or go back to guest.
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(updateCustomerAddressAction).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(onSignInOpenChange).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("a failure that carries no message still says so in one sentence", async () => {
    checkoutState = { type: "loading" };
    login.mockResolvedValueOnce({ success: false });
    const onSignedIn = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
      signInOpen: true,
      onSignedIn,
    });

    await signInWith(container, "account@example.test", "wrong-password");

    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Invalid email or password",
    );
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("signing in stores the token, writes the account email to the cart, THEN asks for a new session", async () => {
    checkoutState = { type: "loading" };
    login.mockResolvedValueOnce(SIGNED_IN);
    const order: string[] = [];
    setAuthToken.mockImplementation(() => order.push("token"));
    updateCustomerAddressAction.mockImplementation(async () => {
      order.push("cart");
      return { success: true, cart: CART };
    });
    const onSignedIn = vi.fn(async () => {
      order.push("session");
    });
    const onSignInOpenChange = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
      signInOpen: true,
      onSignInOpenChange,
      onSignedIn,
    });

    await signInWith(container, "typed@example.test", "right-password");

    expect(setAuthToken).toHaveBeenCalledWith("jwt-token", {
      id: "42",
      email: "account@example.test",
      firstName: "Ada",
      lastName: "Checkout",
      refreshToken: "refresh-token",
    });
    // The ACCOUNT's email wins over whatever was typed, and the cart write keeps
    // the live session: refreshSession supersedes it itself (ENG-784).
    expect(updateCustomerAddressAction).toHaveBeenCalledWith(
      { billingAddress: { email: "account@example.test" } },
      { keepCheckoutSession: true },
    );
    expect(setCartData).toHaveBeenCalledWith(CART);
    expect(onSignedIn).toHaveBeenCalledWith("account@example.test");
    expect(onSignInOpenChange).toHaveBeenCalledWith(false);
    expect(order).toEqual(["token", "cart", "session"]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("a cart write that fails leaves the shopper signed in on a usable step", async () => {
    checkoutState = { type: "loading" };
    login.mockResolvedValueOnce(SIGNED_IN);
    updateCustomerAddressAction.mockImplementationOnce(async () => ({
      success: false as const,
      error: "store said no",
    }));
    const onSignedIn = vi.fn();
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
      signInOpen: true,
      onSignedIn,
    });

    await signInWith(container, "account@example.test", "right-password");

    expect(setAuthToken).toHaveBeenCalledTimes(1);
    // No session is recreated against a cart that never took the email.
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Signed in" }),
    );
  });

  it("a signed-in shopper never gets the panel back, and sees who they are", async () => {
    checkoutState = { type: "loading" };
    authState = {
      isAuthenticated: true,
      user: { email: "account@example.test", firstName: "Ada" },
    };
    const container = await render({
      enableStripe: true,
      email: "account@example.test",
      onNext: vi.fn(),
      signInOpen: true,
    });

    expect(
      container.querySelector("[data-testid=checkout-sign-in]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid=contact-signed-in]")?.textContent,
    ).toBe("Signed in as account@example.test");
    expect(
      container.querySelector("[data-testid=stripe-contact-element]"),
    ).not.toBeNull();
  });

  it("a guest sees no signed-in line", async () => {
    checkoutState = { type: "loading" };
    const container = await render({
      enableStripe: true,
      email: "",
      onNext: vi.fn(),
    });

    expect(
      container.querySelector("[data-testid=contact-signed-in]"),
    ).toBeNull();
  });
});

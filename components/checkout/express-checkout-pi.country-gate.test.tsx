// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AllowedCountries } from "@/lib/allowed-countries";

/**
 * The pre-charge country gate on the Payment-Intents Express Checkout Element
 * (Apple Pay / Google Pay / Link). The element's handlers are driven directly
 * with sheet payloads; a refused country must end the confirm before the cart
 * write, the PaymentIntent and `confirmPayment`, and refuse a sheet address
 * change before the cart write.
 *
 * Does NOT tap a real wallet: what the sheet itself displays for
 * `invalid_billing_address` / `address_unserviceable` is Stripe's and is a
 * device claim, not asserted here.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = {
  onConfirm: (event: unknown) => Promise<void>;
  onShippingAddressChange?: (event: unknown) => Promise<void>;
};
let handlers: Handlers | null = null;

const confirmPayment = vi.fn();
const updateCustomerAddressAction = vi.fn();
const selectShippingAction = vi.fn();
const createPaymentIntentAction = vi.fn();
const processCheckoutAction = vi.fn();
const push = vi.fn();

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ExpressCheckoutElement: (props: Handlers) => {
    handlers = props;
    return <div />;
  },
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({ update: vi.fn(async () => {}) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({ cartData: null, setCartData: vi.fn() }),
}));
vi.mock("@/lib/cart-actions", () => ({
  updateCustomerAddressAction: (...a: unknown[]) =>
    updateCustomerAddressAction(...a),
  selectShippingAction: (...a: unknown[]) => selectShippingAction(...a),
}));
vi.mock("@/app/checkout/actions", () => ({
  createPaymentIntentAction: (...a: unknown[]) =>
    createPaymentIntentAction(...a),
  processCheckoutAction: (...a: unknown[]) => processCheckoutAction(...a),
  releaseCheckoutStockAction: vi.fn(),
}));
vi.mock("@/components/checkout/stock-alerts", () => ({
  useStockRefusal: () => vi.fn(),
}));
vi.mock("@/lib/stripe-appearance", () => ({
  buildCheckoutAppearance: () => ({}),
}));

const POLICY: AllowedCountries = {
  billing: { countries: ["AU", "NZ"], mode: "specific" },
  shipping: { countries: ["AU"], mode: "specific" },
};

const SHIPPED_CART = {
  needsShipping: true,
  shippingRates: [],
  totals: { totalPrice: "100.00" },
  currency: { code: "AUD" },
};
const DIGITAL_CART = { ...SHIPPED_CART, needsShipping: false };

const sheetAddress = (country: string) => ({
  name: "Ada Lovelace",
  address: {
    line1: "1 Main St",
    city: "Town",
    postal_code: "1000",
    country,
  },
});

function confirmEvent(input: {
  billingCountry?: string;
  shippingCountry?: string;
}): { paymentFailed: ReturnType<typeof vi.fn> } & Record<string, unknown> {
  return {
    paymentFailed: vi.fn(),
    billingDetails: input.billingCountry
      ? { name: "Ada", address: { country: input.billingCountry } }
      : undefined,
    shippingAddress: input.shippingCountry
      ? sheetAddress(input.shippingCountry)
      : undefined,
  };
}

let container: HTMLDivElement;
let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

async function mount(
  cart: typeof SHIPPED_CART,
  countryPolicy?: AllowedCountries,
): Promise<Handlers> {
  const { ExpressCheckoutPi } = await import("./express-checkout-pi");
  await act(async () => {
    root.render(
      <ExpressCheckoutPi
        stripePromise={Promise.resolve(null)}
        cart={cart as never}
        {...(countryPolicy && { countryPolicy })}
      />,
    );
  });
  if (!handlers) throw new Error("ExpressCheckoutElement not rendered");
  return handlers;
}

function expectNothingCharged(): void {
  expect(updateCustomerAddressAction).not.toHaveBeenCalled();
  expect(createPaymentIntentAction).not.toHaveBeenCalled();
  expect(confirmPayment).not.toHaveBeenCalled();
  expect(processCheckoutAction).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers = null;
  createPaymentIntentAction.mockResolvedValue({
    ok: true,
    clientSecret: "pi_123_secret_abc",
  });
  confirmPayment.mockResolvedValue({
    paymentIntent: { id: "pi_123", status: "succeeded", livemode: false },
  });
  processCheckoutAction.mockResolvedValue({ orderId: "1", orderKey: "k" });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  warn.mockRestore();
});

describe("wallet confirm refuses a disallowed country before any charge", () => {
  it("a disallowed BILLING country never creates or confirms a PaymentIntent", async () => {
    const { onConfirm } = await mount(DIGITAL_CART, POLICY);
    const event = confirmEvent({ billingCountry: "US" });
    await act(async () => {
      await onConfirm(event);
    });
    expect(event.paymentFailed).toHaveBeenCalledWith({
      reason: "invalid_billing_address",
    });
    expectNothingCharged();
    expect(container.textContent).toContain(
      "We can only accept payments with a billing address in Australia or New Zealand.",
    );
    expect(String(warn.mock.calls[0]?.[0])).toContain("[country-gate]");
  });

  it("a wallet with NO billing country is judged on the destination it falls back to", async () => {
    const shipsEverywhere: AllowedCountries = {
      ...POLICY,
      shipping: { countries: [], mode: "specific" },
    };
    const { onConfirm } = await mount(SHIPPED_CART, shipsEverywhere);
    const event = confirmEvent({ shippingCountry: "US" });
    await act(async () => {
      await onConfirm(event);
    });
    expect(event.paymentFailed).toHaveBeenCalledWith({
      reason: "invalid_billing_address",
    });
    expectNothingCharged();
  });

  it("a disallowed DESTINATION is refused even when billing is allowed", async () => {
    const { onConfirm } = await mount(SHIPPED_CART, POLICY);
    const event = confirmEvent({ billingCountry: "NZ", shippingCountry: "NZ" });
    await act(async () => {
      await onConfirm(event);
    });
    expect(event.paymentFailed).toHaveBeenCalledWith({
      reason: "address_unserviceable",
    });
    expectNothingCharged();
    expect(container.textContent).toContain("We don't deliver to New Zealand.");
  });

  it("an allowed wallet proceeds to the PaymentIntent and the confirm", async () => {
    const { onConfirm } = await mount(DIGITAL_CART, POLICY);
    const event = confirmEvent({ billingCountry: "AU" });
    await act(async () => {
      await onConfirm(event);
    });
    expect(event.paymentFailed).not.toHaveBeenCalled();
    expect(createPaymentIntentAction).toHaveBeenCalledTimes(1);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
  });

  it("no policy gates nothing", async () => {
    const { onConfirm } = await mount(DIGITAL_CART);
    const event = confirmEvent({ billingCountry: "US" });
    await act(async () => {
      await onConfirm(event);
    });
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("wallet sheet address change", () => {
  it("refuses a destination the store does not ship to before the cart write", async () => {
    const { onShippingAddressChange } = await mount(SHIPPED_CART, POLICY);
    const reject = vi.fn();
    const resolve = vi.fn();
    await act(async () => {
      await onShippingAddressChange?.({
        name: "",
        address: { city: "Town", postal_code: "1000", country: "US" },
        reject,
        resolve,
      });
    });
    expect(reject).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(updateCustomerAddressAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "We don't deliver to United States.",
    );
  });
});

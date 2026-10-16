// @vitest-environment jsdom
/**
 * The delivery step's Stripe bridge, driven through the real component.
 *
 * REPRODUCE THEN PREVENT (production, www.bikesociety.com.au, 2026-10-16)
 * A New Zealand shopper could not pass Delivery: a red "Could not continue /
 * The store rejected this cart operation" toast, no money taken. WooCommerce
 * had refused `update-customer` with `invalid_state` — "The provided state
 * (VIC) is not valid. Must be one of: NTL, AUK, … OTA, STL" — an AUSTRALIAN
 * state submitted with country NZ.
 *
 * The stale value was never Stripe's. `ShippingAddressElement` clears its own
 * state when the country changes; this step copied the element's value into
 * react-hook-form only on `event.complete === true`, so the incomplete
 * transition (country switched, address not yet re-entered) left the previous
 * country's state in the form — and submit PUSHES the form's value back out
 * through `actions.updateShippingAddress` and `updateCustomerAddressAction`,
 * overwriting the element's correct empty state with it.
 *
 * So the assertions are on what LEAVES the step, which is where the refusal was
 * earned: the Stripe session update, and the WooCommerce update-customer
 * payload. Each case drives the element's `onChange` with the event shape
 * Stripe emits, including the incomplete one the old bridge discarded.
 *
 * WHAT THIS CANNOT SEE
 * Stripe's element is a boundary stub, so nothing here proves what the real
 * element emits for a given country — above all whether it renders a State
 * field for NZ (it does not) or echoes a stale `state` on an incomplete event.
 * That is a browser measurement and lives in the PR. What is proven here is the
 * bridge's own contract: for every event shape Stripe can emit, no state
 * belonging to another country reaches either consumer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The address shape `ShippingAddressElement` reports on change. */
type StripeAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type StripeChangeEvent = {
  complete: boolean;
  value: {
    name?: string;
    firstName?: string;
    lastName?: string;
    address: StripeAddress;
  };
};

/** The live element's onChange, captured at render so cases can drive it. */
let fireElementChange: ((event: StripeChangeEvent) => void) | null = null;

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  ShippingAddressElement: (props: {
    onChange?: (event: StripeChangeEvent) => void;
  }) => {
    fireElementChange = props.onChange ?? null;
    return <div data-testid="stripe-shipping-address-element" />;
  },
}));

/** Every outward push the step makes, in call order. */
const updateShippingAddress = vi.fn(async () => ({ type: "success" as const }));
const updateBillingAddress = vi.fn(async () => ({ type: "success" as const }));
const updatePhoneNumber = vi.fn(async () => ({ type: "success" as const }));
const updateCustomerAddressAction = vi.fn(async () => ({
  success: true as const,
}));

vi.mock("@/app/checkout/checkout-actions-context", () => ({
  useCheckoutActions: () => ({
    isLoading: false,
    actions: {
      updateShippingAddress,
      updateBillingAddress,
      updatePhoneNumber,
      // The real one wraps the server action in Stripe's server-update lock;
      // running the callback is the whole of what this step depends on.
      runServerUpdate: async (fn: () => Promise<void>) => {
        await fn();
        return { type: "success" as const };
      },
    },
  }),
}));

vi.mock("@/lib/cart-actions", () => ({ updateCustomerAddressAction }));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// The real input lazy-loads libphonenumber's country metadata through
// `React.lazy`; the step only needs a controlled text field to hold a phone.
vi.mock("@/components/ui/phone-input-lazy", () => ({
  PhoneInput: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <input
      aria-label="Phone"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

const { DeliveryMethodStep } = await import("./delivery-method-step");

const AU_SAVED = {
  firstName: "Ada",
  lastName: "Lovelace",
  line1: "1 Analytical Way",
  line2: "",
  city: "Melbourne",
  state: "VIC",
  country: "AU",
  postalCode: "3000",
  phone: "0400000000",
};

const NZ_TYPED: StripeAddress = {
  line1: "12 Queen Street",
  city: "Auckland",
  postal_code: "1010",
  country: "NZ",
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(
  defaultShipping: Partial<typeof AU_SAVED> | undefined,
  onNext: (data: unknown) => void = () => {},
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <DeliveryMethodStep
        enableStripe
        onNext={onNext}
        pickupLocations={[]}
        {...(defaultShipping
          ? { defaultValues: { shippingAddress: defaultShipping } }
          : {})}
      />,
    );
  });
  return host;
}

/** Drive the element the way Stripe does, then let React flush. */
async function emit(event: StripeChangeEvent): Promise<void> {
  await act(async () => {
    fireElementChange?.(event);
  });
}

function submitButton(container: HTMLDivElement): HTMLButtonElement {
  const button = container.querySelector("button[type=submit]");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("the step rendered no submit button");
  }
  return button;
}

async function submit(container: HTMLDivElement): Promise<void> {
  await act(async () => {
    submitButton(container).click();
  });
}

/** What the step last sent WooCommerce for the shipping address. */
function lastWooShipping(): Record<string, string> {
  const call = updateCustomerAddressAction.mock.calls.at(-1);
  if (!call) throw new Error("update-customer was never called");
  return (call as unknown as [{ shippingAddress: Record<string, string> }])[0]
    .shippingAddress;
}

/** What the step last sent the Stripe session. */
function lastStripeShipping(): StripeAddress {
  const call = updateShippingAddress.mock.calls.at(-1);
  if (!call) throw new Error("updateShippingAddress was never called");
  return (call as unknown as [{ address: StripeAddress }])[0].address;
}

beforeEach(() => {
  vi.clearAllMocks();
  fireElementChange = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("DeliveryMethodStep — the state it pushes matches the country", () => {
  it("sends NZ with no state after a switch away from AU, and does not block on 'State is required'", async () => {
    // The production sequence. The form opens on the shopper's saved AU address
    // (state VIC), the shopper picks NZ — Stripe reports an INCOMPLETE value
    // while the rest of the address is re-entered, which is the event the old
    // bridge threw away — then finishes the NZ address.
    const container = render(AU_SAVED);
    await emit({
      complete: true,
      value: {
        address: {
          ...AU_SAVED,
          postal_code: AU_SAVED.postalCode,
          state: "VIC",
        },
      },
    });
    await emit({ complete: false, value: { address: { country: "NZ" } } });
    await emit({
      complete: true,
      value: { name: "Ada Lovelace", address: NZ_TYPED },
    });

    await submit(container);

    expect(lastWooShipping()).toMatchObject({ country: "NZ", state: "" });
    expect(lastStripeShipping()).toMatchObject({ country: "NZ", state: "" });
    // No "State is required" dead end. The Stripe path renders no State field,
    // so that refinement surfaces as a permanently disabled Continue rather
    // than as a message — which is what left the shopper with nothing to fix.
    expect(submitButton(container).disabled).toBe(false);
    // The step advanced rather than toasting its own guard.
    expect(toast).not.toHaveBeenCalled();
  });

  it("pushes the country the element currently shows, not the one it has left", async () => {
    // Continue is reachable mid-transition: the stale AU line1/city/postcode
    // keep the form valid, so a shopper who switches country and presses
    // Continue before re-entering the address submits on the INCOMPLETE event —
    // the one the old bridge discarded. What left the step was then the whole
    // previous country's address, AU + VIC, which is the mismatch WooCommerce
    // refused. Mirroring country+state off every event is the only thing that
    // fixes this case: the submit-time resolve keeps the pair self-consistent
    // but cannot know the country is stale.
    const container = render(AU_SAVED);
    await emit({
      complete: true,
      value: {
        name: "Ada Lovelace",
        address: {
          ...AU_SAVED,
          postal_code: AU_SAVED.postalCode,
          state: "VIC",
        },
      },
    });
    await emit({ complete: false, value: { address: { country: "NZ" } } });

    expect(submitButton(container).disabled).toBe(false);
    await submit(container);

    expect(lastWooShipping()).toMatchObject({ country: "NZ", state: "" });
    expect(lastStripeShipping()).toMatchObject({ country: "NZ", state: "" });
  });

  it("drops a stale state even when the element never reports the transition", async () => {
    // Belt for the case the fix cannot observe: Stripe reporting `complete`
    // with the new country and the OLD state still attached. The pair is
    // resolved on the way out, so the refusal is unreachable either way.
    const container = render(AU_SAVED);
    await emit({
      complete: true,
      value: { name: "Ada Lovelace", address: { ...NZ_TYPED, state: "VIC" } },
    });

    await submit(container);

    expect(lastWooShipping()).toMatchObject({ country: "NZ", state: "" });
    expect(lastStripeShipping()).toMatchObject({ country: "NZ", state: "" });
  });

  it("does not wipe a seeded country on an event that reports none", async () => {
    // The mirror reads the element's authority, and an event with no country
    // carries none. Writing "" from it would empty a country the shopper can
    // still see in the element and strand them on "Country is required" —
    // a new dead end in place of the old one.
    const container = render(AU_SAVED);
    await emit({
      complete: true,
      value: {
        name: "Ada Lovelace",
        address: {
          ...AU_SAVED,
          postal_code: AU_SAVED.postalCode,
          state: "VIC",
        },
      },
    });
    await emit({ complete: false, value: { address: {} } });

    expect(submitButton(container).disabled).toBe(false);
    await submit(container);

    expect(lastWooShipping()).toMatchObject({ country: "AU", state: "VIC" });
  });

  it("still requires and sends a state for AU", async () => {
    // Only the phone is pre-filled: it is the one field the Stripe element does
    // not collect, so seeding it keeps this case about the state alone.
    const container = render({ phone: "0400000000" });

    // An AU address with no state: Stripe's element would not call this
    // complete, and the step must not advance on it either.
    await emit({
      complete: false,
      value: {
        address: {
          line1: "1 Analytical Way",
          city: "Melbourne",
          postal_code: "3000",
          country: "AU",
        },
      },
    });
    expect(submitButton(container).disabled).toBe(true);
    await submit(container);
    expect(updateCustomerAddressAction).not.toHaveBeenCalled();

    // With the state the element collects for AU, the same address goes through
    // carrying it.
    await emit({
      complete: true,
      value: {
        name: "Ada Lovelace",
        address: {
          line1: "1 Analytical Way",
          city: "Sydney",
          state: "NSW",
          postal_code: "2000",
          country: "AU",
        },
      },
    });
    await submit(container);

    expect(lastWooShipping()).toMatchObject({ country: "AU", state: "NSW" });
    expect(lastStripeShipping()).toMatchObject({ country: "AU", state: "NSW" });
  });
});

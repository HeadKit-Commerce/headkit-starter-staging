// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AllowedCountries } from "@/lib/allowed-countries";

/**
 * The Billing step (Click & Collect and no-shipping flows) cannot advance on a
 * billing country the store does not sell to: the rule is in the form schema,
 * so Continue stays disabled with the sentence shown, and nothing is pushed to
 * the Stripe session.
 *
 * Drives the Stripe branch only (the one both `CheckoutForm` mounts render),
 * with the element as a boundary stub, so what the real element emits per
 * country is not proven here.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ElementChange = {
  complete: boolean;
  value: {
    name?: string;
    address: {
      line1?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  };
};
let fireElementChange: ((event: ElementChange) => void) | null = null;

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  BillingAddressElement: (props: {
    onChange?: (event: ElementChange) => void;
  }) => {
    fireElementChange = props.onChange ?? null;
    return <div />;
  },
}));

const updateBillingAddress = vi.fn(async () => ({ type: "success" as const }));
const updatePhoneNumber = vi.fn(async () => ({ type: "success" as const }));
vi.mock("@/app/checkout/checkout-actions-context", () => ({
  useCheckoutActions: () => ({
    actions: { updateBillingAddress, updatePhoneNumber },
  }),
}));
vi.mock("@/components/ui/phone-input-lazy", () => ({
  PhoneInput: ({ value }: { value?: string }) => (
    <input aria-label="Phone" readOnly value={value ?? ""} />
  ),
}));

const { BillingAddressStep } = await import("./billing-address-step");

const POLICY: AllowedCountries = {
  billing: { countries: ["AU", "NZ"], mode: "specific" },
  shipping: { countries: ["AU", "NZ"], mode: "specific" },
};

const seeded = (country: string) => ({
  billingAddress: {
    firstName: "Ada",
    lastName: "Lovelace",
    line1: "1 Main St",
    city: "Town",
    state: "",
    country,
    postalCode: "1000",
    phone: "0400000000",
  },
});

let container: HTMLDivElement;
let root: Root;
const onNext = vi.fn();

async function render(props: Record<string, unknown>): Promise<void> {
  await act(async () => {
    root.render(
      <BillingAddressStep enableStripe={true} onNext={onNext} {...props} />,
    );
  });
  // Let the resolver settle after the seeded-country effect.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function typeInElement(country: string): Promise<void> {
  await act(async () => {
    fireElementChange?.({
      complete: true,
      value: {
        name: "Ada Lovelace",
        address: {
          line1: "1 Main St",
          city: "Town",
          postal_code: "1000",
          country,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function continueButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (!button) throw new Error("no Continue button");
  return button;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fireElementChange = null;
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

describe("Billing step country rule", () => {
  it("a SEEDED disallowed country shows why Continue is disabled", async () => {
    await render({ countryPolicy: POLICY, defaultValues: seeded("GB") });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "We can only accept billing addresses in Australia or New Zealand.",
    );
    expect(continueButton().disabled).toBe(true);
  });

  it("a disallowed country typed into the element blocks the step and writes nothing", async () => {
    await render({ countryPolicy: POLICY, defaultValues: seeded("AU") });
    await typeInElement("GB");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Australia or New Zealand",
    );
    expect(continueButton().disabled).toBe(true);
    await act(async () => {
      continueButton().click();
    });
    expect(updateBillingAddress).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("an allowed country advances and pushes the address", async () => {
    await render({ countryPolicy: POLICY, defaultValues: seeded("AU") });
    await typeInElement("NZ");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(continueButton().disabled).toBe(false);
    await act(async () => {
      continueButton().click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(updateBillingAddress).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("no policy keeps today's behaviour", async () => {
    await render({ defaultValues: seeded("GB") });
    await typeInElement("GB");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(continueButton().disabled).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

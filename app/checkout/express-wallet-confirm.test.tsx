// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import { walletConfirmRefusal } from "@/lib/wallet-shipping";

/**
 * **The whole wallet chain: who may mount, and what a confirm does.**
 *
 * Three changes live here, in order of how they were shipped. Stage 1
 * (`fdad9b04`) refused a wallet confirm that would charge a shipping-less
 * total. Stage 2 (#273) hid the wallet until the page had priced delivery.
 * This file now holds stage 3 (2c), which REVERSES that gate and closes the
 * undercharge at confirm instead: the cart is priced from the address the
 * wallet sheet itself collected, and the attempt is refused so the buyer
 * approves the new amount on a fresh tap.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COVERS — the real rules composed with the real component
 * ---------------------------------------------------------------------------
 * `components/checkout/express-checkout-top.test.ts` holds
 * `shouldMountExpressCheckout` and `lib/wallet-shipping.test.ts` holds
 * `walletConfirmPlan`, both as pure functions. That is not enough on its own:
 * a correct rule nobody calls is the shape this defect already had twice. So
 * the host below reproduces `CheckoutForm`'s own call site and drives the REAL
 * component through it, with the REAL cart action and the REAL sync fetch
 * stubbed at their own boundaries rather than the decision stubbed out:
 *
 *   - an unpriced cart plus a confirm event carrying a full address writes
 *     that address to the cart, syncs the session, refuses the attempt with
 *     the new total, and CHARGES NOTHING;
 *   - a confirm event with no usable address refuses with no cart write;
 *   - a destination WooCommerce will not price refuses saying so;
 *   - a cart already priced for delivery confirms with no round trip at all;
 *   - a failed write, a failed sync and a hung write each refuse rather than
 *     charge;
 *   - a Click & Collect cart never mounts, and never prices;
 *   - stage 1's floor is still wired and still fires on a desynced session.
 *
 * Both directions are required throughout. "Refuses" alone is satisfied by a
 * component that refuses everything, which is a worse bug than the one being
 * fixed — so every refusal case is paired with a confirm case built from the
 * same fixtures.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STOPS — read this before trusting it further
 * ---------------------------------------------------------------------------
 * - **It cannot tap Apple Pay, and nothing in CI can.** Stripe's element is
 *   stubbed. This proves what the storefront renders, what it writes, and what
 *   it tells the event — not that a real sheet appears, not what Stripe
 *   charges, and nothing about the wallet's own address collection. **In
 *   particular it cannot show that the sheet is re-tappable after a refusal,
 *   which is the one thing the two-tap flow depends on.** That is a device
 *   claim and the PR lists the exact steps that settle it.
 * - **It does not reach WooCommerce.** `updateCustomerAddressAction` is a spy,
 *   so this proves the payload the storefront SENDS and nothing about what
 *   WooCommerce does with it. Whether a given address makes Woo select a rate
 *   is a Store API claim, measured in research
 *   `261010-bs-applepay-shipping-callbacks` (finding 3a: `city` AND `postcode`
 *   together) and not re-derivable here.
 * - **It does not drive `CheckoutForm`.** The host reproduces that one call
 *   site; the wiring is held by a SOURCE assertion at the end of this file,
 *   which can see that the cart is passed and nothing else.
 * - jsdom lays nothing out and loads no CSS, so "no empty gap" is asserted as
 *   absent markup, not as a measured box.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** One shipping rate as the Store API reports it. */
interface Rate {
  rateId: string;
  name: string;
  price: string;
  taxes: string;
  selected: boolean;
}

const hoisted = vi.hoisted(() => ({
  /** The single cart fixture — read by the gate AND by the component. */
  cart: null as unknown,
  /** Minor units the stubbed SESSION charges for shipping, or null for none. */
  sessionShippingMinorUnits: null as number | null,
  /** The stubbed session's own formatted total. */
  sessionTotalAmount: "A$29.95",
  confirm: vi.fn(),
  /** `updateCustomerAddressAction` — the real cart server action's boundary. */
  updateCustomerAddress: vi.fn(),
  /** Every `fetch` the component makes. */
  fetch: vi.fn(),
  setCartData: vi.fn(),
  /** Bumped every time Stripe's element is CREATED — the remount signal. */
  elementCreations: 0,
  /** Set when Stripe's element was actually created. */
  onConfirm: null as
    ((event: StripeExpressCheckoutElementConfirmEvent) => void) | null,
  onAvailablePaymentMethodsChange: null as
    | ((event: {
        elementType: "expressCheckout";
        paymentMethods: { applePay?: { available: boolean } };
      }) => void)
    | null,
}));

/** The session shape the component reads, built from the live hoisted values. */
const stubSession = () => ({
  shipping:
    hoisted.sessionShippingMinorUnits === null
      ? null
      : {
          shippingOption: {
            id: "shr_test",
            minorUnitsAmount: hoisted.sessionShippingMinorUnits,
            amount: "A$12.00",
            currency: "aud",
            displayName: "Standard",
            deliveryEstimate: null,
          },
          taxAmounts: null,
        },
  total: { total: { minorUnitsAmount: 0, amount: hoisted.sessionTotalAmount } },
});

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  ExpressCheckoutElement: (props: {
    onConfirm: (event: StripeExpressCheckoutElementConfirmEvent) => void;
    onAvailablePaymentMethodsChange: (event: {
      elementType: "expressCheckout";
      paymentMethods: { applePay?: { available: boolean } };
    }) => void;
  }) => {
    hoisted.onConfirm = props.onConfirm;
    hoisted.onAvailablePaymentMethodsChange =
      props.onAvailablePaymentMethodsChange;
    // Counted from an EFFECT, so it counts MOUNTS and not renders. A
    // render-time counter made the remount assertion vacuous: the refusal
    // calls `setError`, which re-renders the component, so the count reached
    // 2 with the `key` bump deleted.
    useEffect(() => {
      hoisted.elementCreations += 1;
    }, []);
    return null;
  },
  useCheckout: () => ({
    type: "success",
    checkout: {
      ...stubSession(),
      confirm: hoisted.confirm,
      // Stripe's documented "I am about to change server state" wrapper. The
      // real one runs the callback and then re-fetches the session, which is
      // exactly what makes the refreshed figures readable — so the stub does
      // both, and returns the session as it stands AFTER the callback.
      runServerUpdate: async (work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (err) {
          return {
            type: "error" as const,
            error: { message: err instanceof Error ? err.message : "failed" },
          };
        }
        return { type: "success" as const, session: stubSession() };
      },
    },
  }),
}));

vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({
    cartData: hoisted.cart,
    setCartData: hoisted.setCartData,
    toggleCart: vi.fn(),
  }),
}));

vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));

vi.mock("@/lib/cart-actions", () => ({
  updateCustomerAddressAction: (...args: unknown[]) =>
    hoisted.updateCustomerAddress(...args),
}));

const { ExpressCheckoutTop, shouldMountExpressCheckout } =
  await import("@/components/checkout/express-checkout-top");

/**
 * WooCommerce's two Click & Collect rows, which this store returns on EVERY
 * cart — before any address, with nothing selected (finding 3a). A cart with
 * no destination therefore looks rate-bearing while having no delivery rate,
 * and an UNSELECTED pickup row is not a pickup cart: it is every cart's
 * starting state.
 */
const pickupRows: Rate[] = [
  {
    rateId: "pickup_location:1",
    name: "Adelaide City",
    price: "0",
    taxes: "0",
    selected: false,
  },
  {
    rateId: "pickup_location:2",
    name: "Brighton",
    price: "0",
    taxes: "0",
    selected: false,
  },
];

/**
 * A cart carrying exactly these rates, with the cart-level totals WooCommerce
 * derives from the selection: `total_shipping` is 0 until a delivery rate is
 * selected (measured — that is why a no-destination cart reports 2995 for a
 * 4195 order).
 */
function cartWithRates(
  rates: Rate[],
  opts: { needsShipping?: boolean } = {},
): unknown {
  const selected = rates.find(
    (r) =>
      r.selected &&
      !r.rateId.includes("local_pickup") &&
      !r.rateId.includes("pickup_location"),
  );
  return {
    needsShipping: opts.needsShipping ?? true,
    currency: { code: "AUD", symbol: "$", minorUnit: 2 },
    totals: {
      totalPrice: selected ? "41.95" : "29.95",
      totalShipping: selected?.price ?? "0",
      totalShippingTax: selected?.taxes ?? "0",
    },
    shippingRates: [{ packageId: "0", name: "Shipping", shippingRates: rates }],
    items: [],
  };
}

const paidDelivery: Rate = {
  rateId: "flat_rate:8",
  name: "Standard Delivery",
  price: "10.91",
  taxes: "1.09",
  selected: true,
};

const freeDelivery: Rate = {
  rateId: "advanced_free_shipping",
  name: "Free Delivery",
  price: "0",
  taxes: "0",
  selected: true,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * `CheckoutForm`'s own call site, reproduced: the gate decides whether
 * `ExpressCheckoutTop` is rendered at all.
 */
function CheckoutHost({ step }: { step: CheckoutFormStepEnum }) {
  return shouldMountExpressCheckout(
    step,
    hoisted.cart as Parameters<typeof shouldMountExpressCheckout>[1],
  ) ? (
    <ExpressCheckoutTop sessionId="cs_test_283750" />
  ) : null;
}

function mount(
  step: CheckoutFormStepEnum = CheckoutFormStepEnum.CONTACT,
): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CheckoutHost step={step} />);
  });
}

function unmount(): void {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

/** Tell the component Stripe found a wallet, so the chrome can render. */
async function reportWalletAvailable(): Promise<void> {
  await act(async () => {
    hoisted.onAvailablePaymentMethodsChange?.({
      elementType: "expressCheckout",
      paymentMethods: { applePay: { available: true } },
    });
  });
}

/** The address Apple Pay collected for order 283750 — a real AU destination. */
const SHEET_ADDRESS = {
  name: "A Buyer",
  address: {
    line1: "1 Example St",
    line2: null,
    city: "Adelaide",
    state: "SA",
    postal_code: "5000",
    country: "AU",
  },
};

/**
 * A confirm event shaped like the one Apple Pay produced for 283750.
 *
 * `shippingAddress` is REQUIRED and has no default: a default would make
 * `walletConfirmEvent(undefined)` — the "the sheet gave no address" case —
 * silently build an event carrying the full address, and that test then passes
 * for the wrong reason. It did, once.
 */
function walletConfirmEvent(shippingAddress: unknown): {
  event: StripeExpressCheckoutElementConfirmEvent;
  paymentFailed: ReturnType<typeof vi.fn>;
} {
  const paymentFailed = vi.fn();
  const event = {
    expressPaymentType: "apple_pay",
    paymentFailed,
    shippingAddress,
  } as unknown as StripeExpressCheckoutElementConfirmEvent;
  return { event, paymentFailed };
}

/** Fire the confirm handler and let its async chain settle. */
async function confirmAndSettle(
  event: StripeExpressCheckoutElementConfirmEvent,
): Promise<void> {
  await act(async () => {
    hoisted.onConfirm!(event);
  });
  // The re-price is three awaits deep (write → sync → refusal), and each
  // settles on its own microtask turn.
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** The `/api/checkout/sync-line-items` call, or undefined when none was made. */
function syncCall(): unknown[] | undefined {
  return hoisted.fetch.mock.calls.find((call) =>
    String(call[0]).includes("/api/checkout/sync-line-items"),
  );
}

beforeEach(() => {
  hoisted.confirm.mockReset();
  hoisted.confirm.mockResolvedValue({ type: "success" });
  hoisted.updateCustomerAddress.mockReset();
  hoisted.setCartData.mockReset();
  hoisted.fetch.mockReset();
  hoisted.onConfirm = null;
  hoisted.onAvailablePaymentMethodsChange = null;
  hoisted.sessionShippingMinorUnits = null;
  hoisted.sessionTotalAmount = "A$29.95";
  hoisted.elementCreations = 0;
  hoisted.cart = null;
  vi.stubGlobal("fetch", hoisted.fetch);

  // The default chain: the address write prices the cart, and the sync then
  // re-prices the session. Individual tests break one link.
  hoisted.updateCustomerAddress.mockImplementation(async () => ({
    success: true,
    cart: cartWithRates([...pickupRows, paidDelivery]),
  }));
  hoisted.fetch.mockImplementation(async (url: unknown) => {
    if (String(url).includes("/api/checkout/sync-line-items")) {
      hoisted.sessionShippingMinorUnits = 1200;
      hoisted.sessionTotalAmount = "A$41.95";
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: false, json: async () => ({}) };
  });
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("an unpriced cart is PRICED from the sheet's address, and the attempt refused", () => {
  it("writes the sheet's whole address, syncs, refuses with the new total, and charges nothing", async () => {
    hoisted.cart = cartWithRates(pickupRows);

    mount(CheckoutFormStepEnum.CONTACT);
    await reportWalletAvailable();
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    // 1. the destination the SHEET gave, as a full replace, with no phone key
    //    (omitting it is what preserves a phone the page already set) and
    //    never a billing address (an all-empty one wipes the session's saved
    //    customer data — commerce's ENG-838 note).
    expect(hoisted.updateCustomerAddress).toHaveBeenCalledTimes(1);
    const [input, opts] = hoisted.updateCustomerAddress.mock.calls[0]!;
    expect(input).toEqual({
      shippingAddress: {
        firstName: "A",
        lastName: "Buyer",
        address1: "1 Example St",
        address2: "",
        city: "Adelaide",
        state: "SA",
        postcode: "5000",
        country: "AU",
      },
    });
    // 2. ENG-784 mechanism 1 is opted out of DELIBERATELY: the session the
    //    next tap confirms against must survive this mutation. The component's
    //    head carries the five reasons that is safe.
    expect(opts).toEqual({ keepCheckoutSession: true });

    // 3. the session is re-synced in the same sequence, not left to an effect
    //    (CheckoutForm's own sync effect returns early on CONTACT).
    expect(syncCall()).toBeDefined();

    // 4. NOTHING IS CHARGED on this attempt — the hard rule of the whole
    //    change, and what separates it from the rejected candidate 4.
    expect(hoisted.confirm).not.toHaveBeenCalled();

    // 5. the refusal quotes the session's OWN formatted total, so the figure
    //    cannot disagree with what the next sheet displays.
    expect(paymentFailed).toHaveBeenCalledTimes(1);
    const refusal = paymentFailed.mock.calls[0]?.[0];
    expect(refusal?.message).toContain("A$41.95");
    // `fail` dismisses the sheet. An open sheet keeps showing the amount it
    // was built with, so re-authorising in it would approve one figure and
    // charge another.
    expect(refusal?.reason).toBe("fail");
    expect(container?.textContent ?? "").toContain(String(refusal?.message));

    // 6. and the page now agrees with the cart.
    expect(hoisted.setCartData).toHaveBeenCalledTimes(1);
  });

  it("REMOUNTS Stripe's element, so no stale sheet can re-authorise", async () => {
    // The amount moved under a sheet that is already open, and whether a
    // `reason` really dismisses it is a device behaviour this cannot observe.
    // Destroying the element makes the guarantee structural instead.
    hoisted.cart = cartWithRates(pickupRows);

    mount(CheckoutFormStepEnum.CONTACT);
    expect(hoisted.elementCreations).toBe(1);
    const { event } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.elementCreations).toBe(2);
  });

  it("prices a FREE-shipping cart too, and quotes its unchanged total", async () => {
    // The population PR #273's gate hid for nothing: an over-threshold cart
    // with no address is indistinguishable from a sub-threshold one in the
    // Store API payload (finding 3c), so it is priced like any other. The
    // amount does not move, and the attempt is STILL refused — the no-charge
    // rule is unconditional, which is the only way it can be relied on.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: true,
      cart: cartWithRates([...pickupRows, freeDelivery]),
    }));
    hoisted.fetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/checkout/sync-line-items")) {
        // A free rate is a priced rate, and commerce emits it as a zero
        // shipping option.
        hoisted.sessionShippingMinorUnits = 0;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed.mock.calls[0]?.[0]?.message).toContain("A$29.95");
  });
});

describe("an unpriced cart that cannot be priced is refused, and nothing is charged", () => {
  it("refuses an event with NO shipping address, without touching the cart", async () => {
    hoisted.cart = cartWithRates(pickupRows);

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(undefined);
    await confirmAndSettle(event);

    // No write, no sync, no charge — there is nothing to price from, so the
    // cart must not be mutated at all.
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(syncCall()).toBeUndefined();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed.mock.calls[0]?.[0]?.reason).toBe(
      "invalid_shipping_address",
    );
  });

  it("refuses an address missing the postcode, without touching the cart", async () => {
    // Finding 3a: WooCommerce needs `city` AND `postcode` together, so writing
    // a half address buys nothing.
    hoisted.cart = cartWithRates(pickupRows);

    mount(CheckoutFormStepEnum.ADDRESS);
    const { event, paymentFailed } = walletConfirmEvent({
      name: "A Buyer",
      address: {
        line1: "1 Example St",
        line2: null,
        city: "Adelaide",
        state: "SA",
        postal_code: "",
        country: "AU",
      },
    });
    await confirmAndSettle(event);

    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed.mock.calls[0]?.[0]?.reason).toBe(
      "invalid_shipping_address",
    );
  });

  it("refuses a destination WooCommerce will not price, and skips the sync", async () => {
    // The write landed but no delivery rate came back. The session is already
    // right for a cart that gained no shipping, so there is nothing to sync —
    // and the buyer is told the address is the problem, which is correctable
    // in the sheet.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: true,
      cart: cartWithRates(pickupRows),
    }));

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.updateCustomerAddress).toHaveBeenCalledTimes(1);
    expect(syncCall()).toBeUndefined();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed.mock.calls[0]?.[0]?.reason).toBe(
      "address_unserviceable",
    );
  });

  it("refuses when the RE-SYNC fails, quoting no figure", async () => {
    // The dangerous half of `keepCheckoutSession: true`: the cart now bills
    // delivery and the session does not. It degrades to a refusal — never an
    // undercharge — and no total may be quoted, because the session is still
    // priced below the cart.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.fetch.mockImplementation(async () => ({
      ok: false,
      json: async () => ({}),
    }));

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.confirm).not.toHaveBeenCalled();
    const message = String(paymentFailed.mock.calls[0]?.[0]?.message);
    expect(message).not.toMatch(/\d/);
    // And the next tap is refused by stage 1 for the same reason, which is why
    // the two messages are the same sentence.
    expect(message).toBe(
      walletConfirmRefusal({
        cartShippingCost: 12,
        sessionShippingMinorUnits: null,
      })!.message,
    );
  });

  it("refuses when the address WRITE fails", async () => {
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: false,
      error: "Failed to update customer",
    }));

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(syncCall()).toBeUndefined();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
  });

  it("refuses when the write THROWS, rather than leaving the sheet waiting", async () => {
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => {
      throw new Error("network");
    });

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
  });

  it("refuses a hung write once the timeout fires, still without charging", async () => {
    // A wallet sheet left spinning is worse than any refusal, and this store's
    // WordPress origin is rate-limited near 1.8 req/s and has had outages.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(
      () => new Promise(() => {}),
    );
    vi.useFakeTimers();
    try {
      mount(CheckoutFormStepEnum.CONTACT);
      const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
      await act(async () => {
        hoisted.onConfirm!(event);
      });
      expect(paymentFailed).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(paymentFailed).toHaveBeenCalledTimes(1);
      expect(hoisted.confirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a cart already priced for delivery confirms, with no round trip", () => {
  it("confirms when the session carries the rate the cart selected", async () => {
    hoisted.cart = cartWithRates([...pickupRows, paidDelivery]);
    hoisted.sessionShippingMinorUnits = 1200;

    mount(CheckoutFormStepEnum.PAYMENT);
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(paymentFailed).not.toHaveBeenCalled();
    // The path that was already correct pays nothing for this change: no cart
    // write, no sync, no remount.
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(syncCall()).toBeUndefined();
    expect(hoisted.elementCreations).toBe(1);
  });

  it("confirms a cart that needs no shipping with no address in the event", async () => {
    // Gift cards / virtual products: nothing to price, one tap as always.
    hoisted.cart = cartWithRates([], { needsShipping: false });

    mount(CheckoutFormStepEnum.CONTACT);
    const { event, paymentFailed } = walletConfirmEvent(undefined);
    await confirmAndSettle(event);

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(paymentFailed).not.toHaveBeenCalled();
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
  });
});

describe("Click & Collect stays out, at BOTH decisions", () => {
  it("never mounts once a pickup rate is selected", () => {
    // Captain's decision: Express is not available for pickup. Under this
    // change the hazard is sharper — the confirm path would write the sheet's
    // shipping address to the cart and convert a pickup order into a delivery
    // one.
    hoisted.cart = cartWithRates([
      { ...pickupRows[0]!, selected: true },
      pickupRows[1]!,
    ]);

    mount(CheckoutFormStepEnum.ADDRESS);

    expect(hoisted.onConfirm).toBeNull();
    expect(
      container?.querySelector('[data-testid="express-checkout-section"]'),
    ).toBeNull();
    // No dangling chrome: no label, no divider, no empty gap.
    expect(container?.innerHTML ?? "x").toHaveLength(0);
  });

  it("DOES mount when the pickup rows are merely offered", () => {
    // The half of #273's gate that was wrong: an unselected pickup row is not
    // a pickup cart, it is every cart's starting state on this store, and
    // refusing it is what hid the button for everyone.
    hoisted.cart = cartWithRates(pickupRows);

    mount(CheckoutFormStepEnum.CONTACT);

    expect(hoisted.onConfirm).not.toBeNull();
  });

  it("refuses, and does NOT price, if a pickup cart ever reaches confirm", async () => {
    // The mount gate above is what keeps this unreachable; this is the same
    // rule at the decision that would do the damage, so the two cannot
    // disagree. Mounted directly, bypassing the host's gate.
    hoisted.cart = cartWithRates([
      { ...pickupRows[0]!, selected: true },
      pickupRows[1]!,
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<ExpressCheckoutTop sessionId="cs_test_283750" />);
    });
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
  });
});

describe("stage 1 is still the floor, and still fires", () => {
  it("refuses a confirm when the session LOST the cart's shipping", async () => {
    // The cart carries a selected rate (so it is "priced" and no re-price is
    // attempted) while the session does not — a cart mutation ahead of its
    // re-sync, or the measured trap that an explicit rate choice does not
    // survive an address change. Deleting stage 1 because the plan makes it
    // quiet would uncover exactly these states.
    hoisted.cart = cartWithRates([...pickupRows, paidDelivery]);
    hoisted.sessionShippingMinorUnits = null;

    mount(CheckoutFormStepEnum.PAYMENT);
    await reportWalletAvailable();
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
    expect(paymentFailed.mock.calls[0]?.[0]).toMatchObject({ reason: "fail" });
    expect(container?.textContent ?? "").toContain(
      String(paymentFailed.mock.calls[0]?.[0]?.message ?? " "),
    );
  });

  it("refuses WITHOUT mutating anything when there is no session id to sync", async () => {
    // Pricing the cart while the session cannot be re-priced is the one state
    // that must not be entered: it would leave the session below the cart with
    // nothing able to raise it.
    hoisted.cart = cartWithRates(pickupRows);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<ExpressCheckoutTop />);
    });
    const { event, paymentFailed } = walletConfirmEvent(SHEET_ADDRESS);
    await confirmAndSettle(event);

    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
  });
});

describe("the call site", () => {
  it("passes the cart to the gate, not the step alone", () => {
    // The host above reproduces the call site; this is what holds the real
    // one. A source reading is all it can be — rendering `CheckoutForm` mounts
    // Stripe from an effect and stops at a skeleton, so an assertion made
    // through it would be vacuous.
    const src = readFileSync(
      join(process.cwd(), "app/checkout/CheckoutForm.tsx"),
      "utf8",
    );
    const calls = src.match(/shouldMountExpressCheckout\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("shouldMountExpressCheckout(currentStep, cartData)");
  });
});

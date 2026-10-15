// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import type {
  EcePartialAddress,
  EceShippingAddressChangeEvent,
  EceShippingChangeDecision,
  EceShippingRateChangeEvent,
} from "@/lib/stripe-ece-shipping-preview";

/**
 * **The wallet sheet re-prices IN-SHEET: `shippingaddresschange` and
 * `shippingratechange` on a Checkout Session.**
 *
 * These two handlers exist only under Stripe's private preview "Event handlers
 * for Express Checkout Element with Checkout Sessions"
 * (`feature_flags.checkout_ece_shipping_events`). They replace the
 * refuse-and-ask-for-a-second-tap workaround as the NORMAL path: the sheet's
 * own total becomes what WooCommerce will bill before the buyer authorises
 * anything, so the first tap pays.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COVERS — the real component, the real rules, stubs only at the edges
 * ---------------------------------------------------------------------------
 * The REAL `ExpressCheckoutTop` is rendered; Stripe's element is replaced by a
 * stub that captures the two handlers and calls them with real-shaped events,
 * and the two cart server actions plus the sync route are stubbed at their own
 * boundaries. The event-scoped `runServerUpdate` stub reproduces the two
 * properties the real one has that the decision depends on: it RUNS the
 * callback, and it RETHROWS whatever the callback threw (Stripe's own copy
 * also applies an 18 s timeout and then re-retrieves the session).
 *
 *   - an address change writes the sheet's partial destination to the cart,
 *     syncs the session, and ACCEPTS;
 *   - a destination WooCommerce prices no delivery for REJECTS, and does not
 *     sync;
 *   - a half address (no postcode) REJECTS without touching the cart;
 *   - a rate change maps the Stripe option id back to a cart rate, selects it,
 *     syncs, and ACCEPTS;
 *   - a rate change whose option id is in no mapping REJECTS without touching
 *     the cart;
 *   - a failed sync REJECTS;
 *   - a Local Pickup cart ACCEPTS rate changes (and address changes);
 *   - and a confirm on the cart those handlers left behind goes straight
 *     through `checkout.confirm` with no refusal and no second round trip.
 *
 * Both directions throughout: "rejects" alone is satisfied by a component that
 * rejects everything, which would hide the wallet's shipping step entirely.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STOPS — read this before trusting it further
 * ---------------------------------------------------------------------------
 * - **It cannot tap Apple Pay or Google Pay, and nothing in CI can.** Stripe's
 *   element is stubbed, so this proves what the storefront does when the
 *   handler is called — not that a real sheet calls it, not that the preview
 *   flag is on for an account, not what the sheet displays, and nothing about
 *   whether an accept really refreshes the wallet's total. Those are device
 *   claims and the PR lists the steps that settle them.
 * - **It proves nothing about the flag.** Whether the handlers fire at all is
 *   decided inside Stripe.js from the session's own init response; the reading
 *   that settles it is quoted in `lib/stripe-ece-shipping-preview.ts` and in
 *   the component's head, from the `custom-checkout` chunk.
 * - **It does not reach WooCommerce.** The cart actions are spies, so this
 *   proves the payload the storefront SENDS. Whether a given destination makes
 *   Woo select a rate is a Store API claim (research
 *   `261010-bs-applepay-shipping-callbacks` finding 3a: `city` AND `postcode`
 *   together).
 * - jsdom lays nothing out, so the inline copy is asserted as text, not as a
 *   painted box.
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
  cart: null as unknown,
  sessionShippingMinorUnits: null as number | null,
  sessionTotalAmount: "A$29.95",
  confirm: vi.fn(),
  updateCustomerAddress: vi.fn(),
  selectShipping: vi.fn(),
  fetch: vi.fn(),
  setCartData: vi.fn(),
  onConfirm: null as
    ((event: StripeExpressCheckoutElementConfirmEvent) => void) | null,
  onShippingAddressChange: null as
    | ((
        event: EceShippingAddressChangeEvent,
      ) => Promise<EceShippingChangeDecision>)
    | null,
  onShippingRateChange: null as
    | ((
        event: EceShippingRateChangeEvent,
      ) => Promise<EceShippingChangeDecision>)
    | null,
  onAvailablePaymentMethodsChange: null as
    | ((event: {
        elementType: "expressCheckout";
        paymentMethods: { applePay?: { available: boolean } };
      }) => void)
    | null,
}));

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
    onShippingAddressChange?: (
      event: EceShippingAddressChangeEvent,
    ) => Promise<EceShippingChangeDecision>;
    onShippingRateChange?: (
      event: EceShippingRateChangeEvent,
    ) => Promise<EceShippingChangeDecision>;
  }) => {
    hoisted.onConfirm = props.onConfirm;
    hoisted.onAvailablePaymentMethodsChange =
      props.onAvailablePaymentMethodsChange;
    hoisted.onShippingAddressChange = props.onShippingAddressChange ?? null;
    hoisted.onShippingRateChange = props.onShippingRateChange ?? null;
    return null;
  },
  useCheckout: () => ({
    type: "success",
    checkout: {
      ...stubSession(),
      confirm: hoisted.confirm,
      // The GLOBAL one. It must never be called from inside a shipping
      // handler — Stripe's preview note forbids it and it deadlocks — so this
      // throws rather than spying, which makes that an assertion.
      runServerUpdate: async () => {
        throw new Error(
          "a shipping handler must use the EVENT-SCOPED runServerUpdate",
        );
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
  selectShippingAction: (...args: unknown[]) => hoisted.selectShipping(...args),
}));

const { ExpressCheckoutTop } =
  await import("@/components/checkout/express-checkout-top");

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

const standard: Rate = {
  rateId: "flat_rate:8",
  name: "Standard Delivery",
  price: "10.91",
  taxes: "1.09",
  selected: true,
};

const express: Rate = {
  rateId: "flat_rate:9",
  name: "Express Delivery",
  price: "16.36",
  taxes: "1.64",
  selected: false,
};

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

/** The mapping `/api/checkout/sync-line-items` returns for the rates. */
const MAPPING = [
  { rateId: "flat_rate:8", stripeShippingRateId: "shr_standard" },
  { rateId: "flat_rate:9", stripeShippingRateId: "shr_express" },
  { rateId: "pickup_location:1", stripeShippingRateId: "shr_pickup" },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: Record<string, unknown> = {}): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ExpressCheckoutTop sessionId="cs_test_283750" {...props} />);
  });
}

function rerender(props: Record<string, unknown> = {}): void {
  act(() => {
    root!.render(<ExpressCheckoutTop sessionId="cs_test_283750" {...props} />);
  });
}

/**
 * The event-scoped `runServerUpdate`, with the two properties the decision
 * depends on: it runs the callback, and a throw inside it propagates (which is
 * how the handler learns to reject). Stripe's own copy additionally times out
 * at 18 s and re-retrieves the session.
 */
const eventRunServerUpdate = async (
  work: () => Promise<unknown>,
): Promise<void> => {
  await work();
};

/** The partial address a wallet reports as the buyer picks a destination. */
const SHEET_PARTIAL_ADDRESS = {
  city: "Adelaide",
  state: "SA",
  postal_code: "5000",
  country: "AU",
};

async function fireAddressChange(
  address: unknown = SHEET_PARTIAL_ADDRESS,
): Promise<EceShippingChangeDecision> {
  let decision: EceShippingChangeDecision = { type: "reject" };
  await act(async () => {
    decision = await hoisted.onShippingAddressChange!({
      name: "A Buyer",
      address: (address ?? null) as EcePartialAddress | null,
      runServerUpdate: eventRunServerUpdate,
    });
  });
  return decision;
}

async function fireRateChange(
  stripeShippingRateId: string | null,
): Promise<EceShippingChangeDecision> {
  let decision: EceShippingChangeDecision = { type: "reject" };
  await act(async () => {
    decision = await hoisted.onShippingRateChange!({
      ...(stripeShippingRateId === null
        ? {}
        : { rate: { id: stripeShippingRateId } }),
      runServerUpdate: eventRunServerUpdate,
    });
  });
  return decision;
}

function syncCall(): unknown[] | undefined {
  return hoisted.fetch.mock.calls.find((call) =>
    String(call[0]).includes("/api/checkout/sync-line-items"),
  );
}

beforeEach(() => {
  hoisted.confirm.mockReset();
  hoisted.confirm.mockResolvedValue({ type: "success" });
  hoisted.updateCustomerAddress.mockReset();
  hoisted.selectShipping.mockReset();
  hoisted.setCartData.mockReset();
  hoisted.fetch.mockReset();
  hoisted.onConfirm = null;
  hoisted.onShippingAddressChange = null;
  hoisted.onShippingRateChange = null;
  hoisted.onAvailablePaymentMethodsChange = null;
  hoisted.sessionShippingMinorUnits = null;
  hoisted.sessionTotalAmount = "A$29.95";
  hoisted.cart = null;
  vi.stubGlobal("fetch", hoisted.fetch);

  // The happy chain: the destination prices the cart, the rate change moves
  // it, and the sync re-prices the session and hands back the mapping.
  hoisted.updateCustomerAddress.mockImplementation(async () => ({
    success: true,
    cart: cartWithRates([...pickupRows, standard, express]),
  }));
  hoisted.selectShipping.mockImplementation(async () => ({
    success: true,
    cart: cartWithRates([
      ...pickupRows,
      { ...standard, selected: false },
      { ...express, selected: true },
    ]),
  }));
  hoisted.fetch.mockImplementation(async (url: unknown) => {
    if (String(url).includes("/api/checkout/sync-line-items")) {
      hoisted.sessionShippingMinorUnits = 1200;
      hoisted.sessionTotalAmount = "A$41.95";
      return {
        ok: true,
        json: async () => ({ ok: true, shippingOptionMapping: MAPPING }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("the two preview handlers are registered at all", () => {
  it("hands Stripe's element both shipping handlers", () => {
    // The whole change is inert without this, and the Checkout-subpath
    // component's DECLARED type omits both props — so a cast regression that
    // dropped them would compile and ship a silent no-op.
    hoisted.cart = cartWithRates(pickupRows);

    mount();

    expect(typeof hoisted.onShippingAddressChange).toBe("function");
    expect(typeof hoisted.onShippingRateChange).toBe("function");
  });
});

describe("shippingaddresschange prices the cart and accepts", () => {
  it("writes the sheet's partial destination, syncs, and accepts", async () => {
    hoisted.cart = cartWithRates(pickupRows);

    mount();
    const decision = await fireAddressChange();

    // 1. the destination the SHEET gave, as a full replace. `address1` is ""
    //    because the wallet withholds the street until confirm, and omitting
    //    the key would leave a street the buyer typed on the page standing
    //    beside a NEW suburb — `update-customer` merges field by field.
    expect(hoisted.updateCustomerAddress).toHaveBeenCalledTimes(1);
    const [input, opts] = hoisted.updateCustomerAddress.mock.calls[0]!;
    expect(input).toEqual({
      shippingAddress: {
        firstName: "A",
        lastName: "Buyer",
        address1: "",
        address2: "",
        city: "Adelaide",
        state: "SA",
        postcode: "5000",
        country: "AU",
      },
    });
    // 2. the session must SURVIVE the mutation — it is the one the sheet is
    //    about to confirm against (ENG-784 mechanism 1 opt-out).
    expect(opts).toEqual({ keepCheckoutSession: true });

    // 3. the session is re-synced INSIDE the update, so Stripe's own
    //    re-retrieve sees the new total.
    expect(syncCall()).toBeDefined();

    // 4. accepted — the sheet advances showing WooCommerce's figure.
    expect(decision).toEqual({ type: "accept" });
    // 5. nothing is charged by a shipping change.
    expect(hoisted.confirm).not.toHaveBeenCalled();
    // 6. and the page agrees with the cart.
    expect(hoisted.setCartData).toHaveBeenCalledTimes(1);
  });

  it("accepts a FREE-shipping destination too, and quotes nothing", async () => {
    // An over-threshold cart is indistinguishable from a sub-threshold one
    // before a destination exists (finding 3c), so it takes the same path. A
    // zero-priced rate is a PRICED rate.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: true,
      cart: cartWithRates([
        ...pickupRows,
        {
          rateId: "advanced_free_shipping",
          name: "Free Delivery",
          price: "0",
          taxes: "0",
          selected: true,
        },
      ]),
    }));

    mount();

    expect(await fireAddressChange()).toEqual({ type: "accept" });
    expect(syncCall()).toBeDefined();
  });
});

describe("shippingaddresschange rejects rather than quoting a wrong figure", () => {
  it("rejects a destination WooCommerce prices no delivery for, and skips the sync", async () => {
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: true,
      cart: cartWithRates(pickupRows),
    }));

    mount();
    await reportWalletAvailable();
    const decision = await fireAddressChange();

    expect(hoisted.updateCustomerAddress).toHaveBeenCalledTimes(1);
    // Nothing to sync: the session is already right for a cart that gained no
    // shipping, and syncing would quote a total that does not cover delivery.
    expect(syncCall()).toBeUndefined();
    expect(decision).toEqual({ type: "reject" });
    // The page says the address is the problem, which is what the buyer can
    // act on. (The sheet gets only "rejected" — these events carry no
    // `paymentFailed`.)
    expect(container?.textContent ?? "").toContain(
      "delivery cost for that address",
    );
    // Even on a rejection the page agrees with the cart: the destination
    // landed, the pricing did not.
    expect(hoisted.setCartData).toHaveBeenCalledTimes(1);
  });

  it("rejects a half address WITHOUT touching the cart", async () => {
    // Finding 3a: WooCommerce needs `city` AND `postcode` together, so writing
    // half a destination buys nothing.
    hoisted.cart = cartWithRates(pickupRows);

    mount();
    const decision = await fireAddressChange({
      city: "Adelaide",
      state: "SA",
      postal_code: "",
      country: "AU",
    });

    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(syncCall()).toBeUndefined();
    expect(decision).toEqual({ type: "reject" });
  });

  it("rejects when the SYNC fails, so the sheet never shows an unpriced total", async () => {
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.fetch.mockImplementation(async () => ({
      ok: false,
      json: async () => ({}),
    }));

    mount();

    expect(await fireAddressChange()).toEqual({ type: "reject" });
    expect(syncCall()).toBeDefined();
  });

  it("rejects when the cart WRITE fails", async () => {
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.updateCustomerAddress.mockImplementation(async () => ({
      success: false,
      error: "Failed to update customer",
    }));

    mount();

    expect(await fireAddressChange()).toEqual({ type: "reject" });
    expect(syncCall()).toBeUndefined();
  });

  it("rejects when there is NO session id to re-price, without mutating the cart", async () => {
    // Pricing the cart while the session cannot follow is the one state that
    // must not be entered: it leaves the session below the cart with nothing
    // able to raise it.
    hoisted.cart = cartWithRates(pickupRows);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<ExpressCheckoutTop />);
    });

    expect(await fireAddressChange()).toEqual({ type: "reject" });
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
  });
});

describe("shippingratechange selects the WooCommerce rate behind the Stripe option", () => {
  it("maps the option id, selects that rate, syncs, and accepts", async () => {
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);

    mount();
    // The mapping comes from a sync, so drive the address change first — which
    // is also the real order of events in a sheet.
    await fireAddressChange();
    hoisted.fetch.mockClear();

    const decision = await fireRateChange("shr_express");

    expect(hoisted.selectShipping).toHaveBeenCalledTimes(1);
    expect(hoisted.selectShipping.mock.calls[0]).toEqual([
      "0",
      "flat_rate:9",
      { keepCheckoutSession: true },
    ]);
    expect(syncCall()).toBeDefined();
    expect(decision).toEqual({ type: "accept" });
    expect(hoisted.confirm).not.toHaveBeenCalled();
  });

  it("uses the PAGE's mapping when this component has not synced yet", async () => {
    // A rate change can be the first shipping event of all on a cart the page
    // already priced, so the seed prop has to be honoured.
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);

    mount({ shippingOptionMapping: MAPPING });
    const decision = await fireRateChange("shr_standard");

    expect(hoisted.selectShipping.mock.calls[0]?.[1]).toBe("flat_rate:8");
    expect(decision).toEqual({ type: "accept" });
  });

  it("rejects an option id in NO mapping, without touching the cart", async () => {
    // Stripe recreates its option ids on every sync, so an id that resolves to
    // nothing means the table is stale — and selecting a guess is a
    // wrong-price order.
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);

    mount({ shippingOptionMapping: MAPPING });
    const decision = await fireRateChange("shr_from_a_previous_sync");

    expect(hoisted.selectShipping).not.toHaveBeenCalled();
    expect(syncCall()).toBeUndefined();
    expect(decision).toEqual({ type: "reject" });
  });

  it("rejects an event carrying no rate id at all", async () => {
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);

    mount({ shippingOptionMapping: MAPPING });

    expect(await fireRateChange(null)).toEqual({ type: "reject" });
    expect(hoisted.selectShipping).not.toHaveBeenCalled();
  });

  it("rejects when the SELECT fails", async () => {
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);
    hoisted.selectShipping.mockImplementation(async () => ({
      success: false,
      error: "Failed to select shipping",
    }));

    mount({ shippingOptionMapping: MAPPING });

    expect(await fireRateChange("shr_express")).toEqual({ type: "reject" });
    expect(syncCall()).toBeUndefined();
  });
});

describe("Local Pickup is selectable in the sheet", () => {
  it("accepts a pickup rate change and re-syncs", async () => {
    // Monolithic WooCommerce Apple Pay / Google Pay offer Local Pickup in the
    // shipping picker. Commerce #681 puts pickup on the session; selecting it
    // must select the cart rate and sync — not reject.
    hoisted.cart = cartWithRates([...pickupRows, standard, express]);
    hoisted.selectShipping.mockImplementation(async (_pkg: string, rateId: string) => ({
      success: true,
      cart: cartWithRates([
        { ...pickupRows[0]!, selected: rateId === pickupRows[0]!.rateId },
        { ...pickupRows[1]!, selected: false },
        { ...standard, selected: false },
        { ...express, selected: false },
      ]),
    }));

    mount({ shippingOptionMapping: MAPPING });
    const decision = await fireRateChange("shr_pickup");

    expect(hoisted.selectShipping).toHaveBeenCalled();
    expect(hoisted.selectShipping.mock.calls[0]?.[1]).toBe("pickup_location:1");
    expect(decision).toEqual({ type: "accept" });
  });

  it("still allows address and rate changes when pickup is already selected", async () => {
    hoisted.cart = cartWithRates([
      { ...pickupRows[0]!, selected: true },
      pickupRows[1]!,
      standard,
      express,
    ]);

    mount({ shippingOptionMapping: MAPPING });

    expect(await fireRateChange("shr_standard")).toEqual({ type: "accept" });
    expect(hoisted.selectShipping).toHaveBeenCalled();
  });
});

describe("the confirm after an in-sheet re-price is ONE tap", () => {
  it("confirms with no refusal and no second round trip", async () => {
    // This is the whole point of the preview: by the time the buyer
    // authorises, the cart is priced and the session carries that shipping, so
    // `walletConfirmPlan` answers "confirm" and the confirm-time
    // price-and-refuse fallback never runs.
    hoisted.cart = cartWithRates(pickupRows);
    hoisted.setCartData.mockImplementation((cart: unknown) => {
      hoisted.cart = cart;
    });

    mount();
    await fireAddressChange();
    // The page re-renders with the priced cart the handler published, which is
    // what the real `useCartContext` does.
    rerender();
    hoisted.updateCustomerAddress.mockClear();
    hoisted.fetch.mockClear();

    const paymentFailed = vi.fn();
    await act(async () => {
      hoisted.onConfirm!({
        expressPaymentType: "apple_pay",
        paymentFailed,
        shippingAddress: {
          name: "A Buyer",
          address: {
            line1: "1 Example St",
            line2: null,
            city: "Adelaide",
            state: "SA",
            postal_code: "5000",
            country: "AU",
          },
        },
      } as unknown as StripeExpressCheckoutElementConfirmEvent);
    });

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(paymentFailed).not.toHaveBeenCalled();
    expect(hoisted.updateCustomerAddress).not.toHaveBeenCalled();
    expect(syncCall()).toBeUndefined();
  });
});

describe("the call site", () => {
  it("seeds the sheet's rate mapping from the page", () => {
    // A source reading is all this can be: rendering `CheckoutForm` mounts
    // Stripe from an effect and stops at a skeleton, so an assertion made
    // through it would be vacuous.
    const src = readFileSync(
      join(process.cwd(), "app/checkout/CheckoutForm.tsx"),
      "utf8",
    );
    expect(src).toContain("shippingOptionMapping } : {})}");
  });
});

/** Tell the component Stripe found a wallet, so the inline copy can render. */
async function reportWalletAvailable(): Promise<void> {
  await act(async () => {
    hoisted.onAvailablePaymentMethodsChange?.({
      elementType: "expressCheckout",
      paymentMethods: { applePay: { available: true } },
    });
  });
}

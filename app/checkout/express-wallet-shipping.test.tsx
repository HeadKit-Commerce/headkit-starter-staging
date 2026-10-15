// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";

/**
 * **A wallet confirm on a cart that bills shipping cannot reach Stripe against
 * a session that charges none.**
 *
 * This is the regression guard for live order 283750 on
 * www.bikesociety.com.au: an Apple Pay payment
 * (`pi_3UOsaCDMTJOcMWX61EfkyUbL`, `wallet.type: apple_pay`) whose Checkout
 * Session carried `shipping_options: []` and `shipping_cost: null`, so
 * `amount_total` was 2995 — the item total alone — against a WooCommerce order
 * total of 4195. The buyer authorised $12.00 less than the order they created.
 * Order 283749 is the control the suite reproduces below: also a wallet
 * payment (`wallet_type: link`) but on a free-shipping cart, which charged
 * correctly, so the fault needs wallet AND non-zero shipping together.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COVERS — the behaviour, driven through the real component
 * ---------------------------------------------------------------------------
 * It renders the REAL `ExpressCheckoutTop`, captures the `onConfirm` Stripe's
 * element would call, and invokes it with a real-shaped confirm event. The
 * claim asserted is the one that matters at the till:
 *
 *   - `checkout.confirm` is NEVER called when the cart bills shipping and the
 *     session reports none, and `event.paymentFailed` IS called, so the wallet
 *     sheet shows a failure instead of closing on a silent undercharge
 *     (ENG-789).
 *   - `checkout.confirm` IS called — the positive control — when the session
 *     reports the shipping the cart bills, and when the cart bills none.
 *
 * Both directions are required: a gate that refuses every wallet payment also
 * satisfies the first assertion, and is a worse bug than the one it replaces.
 * Each case was falsified against the pre-fix component (no gate) before being
 * kept: the first case went green only once the gate existed.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STOPS — read this before trusting it further
 * ---------------------------------------------------------------------------
 * - **It cannot tap Apple Pay.** Nobody can from CI. Stripe's element is
 *   stubbed, so this proves what the component does with a confirm event, not
 *   that a real sheet produces one, not that a real sheet renders the refusal
 *   message, and nothing about the wallet's own address collection. Those are
 *   device claims and are listed in the PR.
 * - It asserts `confirm` is not CALLED. It says nothing about what Stripe
 *   would charge if it were, and nothing about the server-side amount
 *   verification at manual capture (ENG-784 mechanism 2) which remains the
 *   authoritative backstop and is tested in commerce, not here.
 * - jsdom lays nothing out and loads no CSS, so the inline error block's
 *   appearance is not under test — only that the gate fires.
 * - It drives ONE surface. `lib/wallet-shipping.test.ts` holds the rule in
 *   isolation; neither can see a served page.
 * - **It covers the FLOOR only.** Every cart here is already priced for
 *   delivery, which is the state `walletConfirmRefusal` decides. The larger
 *   rule in front of it — whether an UNPRICED cart is priced from the sheet's
 *   own address and the attempt refused (2c), and which carts may mount at all
 *   — is `app/checkout/express-wallet-confirm.test.tsx`. Neither file can tap
 *   a wallet, so whether the sheet is re-tappable after a refusal is a device
 *   claim in both.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hoisted = vi.hoisted(() => ({
  /** Minor units the stubbed SESSION charges for shipping, or null for none. */
  sessionShippingMinorUnits: null as number | null,
  /** Major-unit tax-exclusive shipping on the stubbed CART. */
  cartTotalShipping: "0",
  /** Major-unit tax on the stubbed cart's shipping. */
  cartTotalShippingTax: "0",
  confirm: vi.fn(),
  /** The `onConfirm` the real component handed Stripe's element. */
  onConfirm: null as
    ((event: StripeExpressCheckoutElementConfirmEvent) => void) | null,
  /** The availability handler, so a test can make the wallet UI visible. */
  onAvailablePaymentMethodsChange: null as
    | ((event: {
        elementType: "expressCheckout";
        paymentMethods: { applePay?: { available: boolean } };
      }) => void)
    | null,
}));

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  // Capture the handler instead of rendering Stripe's iframe. The component
  // under test is real; only the element it mounts is replaced.
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
    return null;
  },
  useCheckout: () => ({
    type: "success",
    // `useCheckout()`'s success value spreads `StripeCheckoutSession` over the
    // actions, which is why the component reads `checkout.shipping` directly.
    checkout: {
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
      confirm: hoisted.confirm,
    },
  }),
}));

vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({
    cartData: {
      needsShipping: true,
      currency: { code: "AUD", symbol: "$", minorUnit: 2 },
      totals: {
        totalPrice: "41.95",
        totalShipping: hoisted.cartTotalShipping,
        totalShippingTax: hoisted.cartTotalShippingTax,
      },
      // The cart must carry the SELECTED rate its totals came from. It used to
      // be `[]`, which the Store API cannot produce — `total_shipping` is
      // derived from the selection — and since the 2c change that
      // inconsistency matters: a cart with shipping billed and no selected
      // rate is read as UNPRICED, which routes to the re-price path instead of
      // to the floor this file is about. The rate id and the zero-price
      // variant are WooCommerce's own (`flat_rate` / `advanced_free_shipping`).
      shippingRates: [
        {
          packageId: "0",
          name: "Shipping",
          shippingRates: [
            {
              rateId:
                hoisted.cartTotalShipping === "0"
                  ? "advanced_free_shipping"
                  : "flat_rate:8",
              name: "Standard Delivery",
              price: hoisted.cartTotalShipping,
              taxes: hoisted.cartTotalShippingTax,
              selected: true,
            },
          ],
        },
      ],
      items: [],
    },
    setCartData: vi.fn(),
    toggleCart: vi.fn(),
  }),
}));

vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));

// Every cart in this file is PRICED for delivery, so no case here may reach
// the confirm-time re-price. Throwing rather than spying makes that an
// assertion: if a future change routes a priced cart through the cart write,
// this file fails rather than quietly covering a different path.
vi.mock("@/lib/cart-actions", () => ({
  updateCustomerAddressAction: () => {
    throw new Error(
      "a priced cart must not reach the confirm-time re-price — see app/checkout/express-wallet-confirm.test.tsx",
    );
  },
}));

vi.mock("@/lib/checkout-stock", () => ({
  ensureCheckoutStockAction: async () => ({
    ok: true as const,
    cart: {
      needsShipping: true,
      currency: { code: "AUD", symbol: "$", minorUnit: 2 },
      totals: {
        totalPrice: "41.95",
        totalShipping: hoisted.cartTotalShipping,
        totalShippingTax: hoisted.cartTotalShippingTax,
      },
      shippingRates: [
        {
          packageId: "0",
          name: "Shipping",
          shippingRates: [
            {
              rateId:
                hoisted.cartTotalShipping === "0"
                  ? "advanced_free_shipping"
                  : "flat_rate:8",
              name: "Standard Delivery",
              price: hoisted.cartTotalShipping,
              taxes: hoisted.cartTotalShippingTax,
              selected: true,
            },
          ],
        },
      ],
      items: [],
    },
  }),
}));


const { ExpressCheckoutTop } =
  await import("@/components/checkout/express-checkout-top");

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ExpressCheckoutTop sessionId="cs_test_283750" />);
  });
}

/** A confirm event shaped like the one Apple Pay produced for 283750. */
function walletConfirmEvent(): {
  event: StripeExpressCheckoutElementConfirmEvent;
  paymentFailed: ReturnType<typeof vi.fn>;
} {
  const paymentFailed = vi.fn();
  const event = {
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
  } as unknown as StripeExpressCheckoutElementConfirmEvent;
  return { event, paymentFailed };
}

beforeEach(() => {
  hoisted.confirm.mockReset();
  hoisted.confirm.mockResolvedValue({ type: "success" });
  hoisted.onConfirm = null;
  hoisted.onAvailablePaymentMethodsChange = null;
  hoisted.sessionShippingMinorUnits = null;
  hoisted.cartTotalShipping = "0";
  hoisted.cartTotalShippingTax = "0";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("wallet confirm against a session with no shipping", () => {
  it("refuses the payment instead of charging the item total (order 283750)", async () => {
    // The cart bills $12.00 delivery (10.91 + 1.09 GST — the Store API's
    // tax-exclusive pair, which `shippingDisplayTotal` adds back).
    hoisted.cartTotalShipping = "10.91";
    hoisted.cartTotalShippingTax = "1.09";
    // The session carries no shipping cost at all. This is the 283750 state.
    hoisted.sessionShippingMinorUnits = null;

    mount();
    const { event, paymentFailed } = walletConfirmEvent();
    await act(async () => {
      hoisted.onConfirm!(event);
    });

    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(paymentFailed).toHaveBeenCalledTimes(1);
    expect(paymentFailed.mock.calls[0]?.[0]).toMatchObject({ reason: "fail" });
    // The sheet is given something to say, not a bare failure.
    expect(
      String(paymentFailed.mock.calls[0]?.[0]?.message ?? ""),
    ).not.toHaveLength(0);
  });

  it("shows the refusal on the page as well as in the sheet", async () => {
    hoisted.cartTotalShipping = "10.91";
    hoisted.cartTotalShippingTax = "1.09";
    hoisted.sessionShippingMinorUnits = null;

    mount();
    // The inline block renders only once Stripe has reported an available
    // wallet — the same gate the "Express checkout" heading uses — so the
    // availability event has to be driven for this assertion to mean
    // anything. Without it the message sits in state and paints nothing.
    await act(async () => {
      hoisted.onAvailablePaymentMethodsChange!({
        elementType: "expressCheckout",
        paymentMethods: { applePay: { available: true } },
      });
    });
    const { event, paymentFailed } = walletConfirmEvent();
    await act(async () => {
      hoisted.onConfirm!(event);
    });

    const shown = container?.textContent ?? "";
    expect(shown).toContain(
      String(paymentFailed.mock.calls[0]?.[0]?.message ?? "\u0000"),
    );
  });
});

describe("wallet confirm that must NOT be refused", () => {
  it("confirms when the session charges the shipping the cart bills", async () => {
    hoisted.cartTotalShipping = "10.91";
    hoisted.cartTotalShippingTax = "1.09";
    hoisted.sessionShippingMinorUnits = 1200;

    mount();
    const { event, paymentFailed } = walletConfirmEvent();
    await act(async () => {
      hoisted.onConfirm!(event);
    });

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(hoisted.confirm.mock.calls[0]?.[0]).toMatchObject({
      expressCheckoutConfirmEvent: event,
    });
    expect(paymentFailed).not.toHaveBeenCalled();
  });

  it("confirms on a free-shipping cart with no session shipping (order 283749)", async () => {
    // The control from the evidence: a wallet payment whose cart had free
    // shipping. There is nothing to drop, so the gate must stay out of it.
    hoisted.cartTotalShipping = "0";
    hoisted.cartTotalShippingTax = "0";
    hoisted.sessionShippingMinorUnits = null;

    mount();
    const { event, paymentFailed } = walletConfirmEvent();
    await act(async () => {
      hoisted.onConfirm!(event);
    });

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(paymentFailed).not.toHaveBeenCalled();
  });
});

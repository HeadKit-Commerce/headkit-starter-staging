import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import {
  deliveryRateToRestore,
  restoreDeliveryRateAfterPickup,
} from "@/lib/restore-delivery-rate";

// `express-checkout-top.tsx` statically imports two server-action modules
// (the dead-session probe and the cart action), each of which pulls
// `@headkit/sdk/server` into this module graph — unresolvable under vitest.
// The mount gate read below touches neither. Same two stubs as
// `components/checkout/express-checkout-top.test.ts`.
vi.mock("@/lib/checkout-session-status", () => ({
  isCheckoutSessionDead: async () => false,
}));
vi.mock("@/lib/cart-actions", () => ({
  updateCustomerAddressAction: vi.fn(),
}));

const { shouldMountExpressCheckout } =
  await import("@/components/checkout/express-checkout-top");

/**
 * **Switching from Click & Collect back to Ship to home brings the Express
 * wallet buttons back.**
 *
 * The defect: choosing Click & Collect selects a pickup rate on the
 * WooCommerce cart; switching back writes only the delivery ADDRESS, so
 * WooCommerce keeps the pickup method chosen (it is still valid for the new
 * address), `shouldMountExpressCheckout` goes on reading a selected pickup
 * rate, and Apple Pay / Google Pay never return — a refresh reloads the same
 * server-side cart. `lib/restore-delivery-rate.ts` carries the reasoning.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COVERS — the chain, in both directions
 * ---------------------------------------------------------------------------
 * - the pure decision (`deliveryRateToRestore`) over the six carts it can be
 *   handed, including the two that must produce NO selection call;
 * - the performing helper driven with spy deps, so "selects a rate" and "makes
 *   no extra call" are observed rather than inferred;
 * - the composition with the REAL `shouldMountExpressCheckout`: the cart before
 *   the restore hides Express and the cart the restore returns mounts it. A
 *   rule that is correct in isolation and a gate that is correct in isolation
 *   are exactly what were both true while the bug was live, so they are
 *   asserted together;
 * - Click & Collect unchanged — a pickup-selected cart still hides Express,
 *   and the call site's restore sits inside the Ship-to-home guard.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STOPS — read this before trusting it further
 * ---------------------------------------------------------------------------
 * - **It does not reach WooCommerce.** `selectShipping` is a spy, so this
 *   proves the `(packageId, rateId)` the storefront SENDS. Whether the Store
 *   API then reports the pickup rate as deselected is a Store API claim,
 *   settled by the manual plan in the PR.
 * - **It renders nothing.** `CheckoutForm` is not mounted and no delivery step
 *   is submitted, so the two assertions about the CALL SITE are source-level
 *   readings: they catch the wiring being removed or moved out of the
 *   Ship-to-home branch, and they can see no submit, no `runServerUpdate`, and
 *   no re-render.
 * - **It says nothing about the refresh.** That the reloaded cart no longer has
 *   pickup selected follows from the selection landing server-side, which only
 *   a live checkout can show.
 */

const PICKUP_RATE = {
  rateId: "pickup_location:1",
  name: "Adelaide City",
  price: "0",
  taxes: "0",
};
const STANDARD = {
  rateId: "flat_rate:4",
  name: "Standard",
  price: "12.00",
  taxes: "1.20",
};
const EXPRESS = {
  rateId: "flat_rate:9",
  name: "Express",
  price: "22.00",
  taxes: "2.20",
};

/** One package, with exactly the rates named as selected. */
function cart(
  rates: ReadonlyArray<{
    rateId: string;
    name: string;
    price: string;
    taxes: string;
  }>,
  selectedRateId: string | null,
) {
  return {
    needsShipping: true as const,
    shippingRates: [
      {
        packageId: "0",
        shippingRates: rates.map((rate) => ({
          ...rate,
          selected: rate.rateId === selectedRateId,
        })),
      },
    ],
  };
}

describe("deliveryRateToRestore", () => {
  it("picks the first delivery rate when pickup is selected and nothing was chosen before", () => {
    const rate = deliveryRateToRestore(
      cart([PICKUP_RATE, STANDARD, EXPRESS], PICKUP_RATE.rateId).shippingRates,
      undefined,
    );
    expect(rate?.rateId).toBe(STANDARD.rateId);
    // The package has to travel with it — `selectShipping` needs both.
    expect(rate?.packageId).toBe("0");
  });

  it("restores the rate the buyer had chosen when the address still offers it", () => {
    const rate = deliveryRateToRestore(
      cart([PICKUP_RATE, STANDARD, EXPRESS], PICKUP_RATE.rateId).shippingRates,
      EXPRESS.rateId,
    );
    expect(rate?.rateId).toBe(EXPRESS.rateId);
  });

  it("falls back to the first delivery rate when the previous one is no longer offered", () => {
    const rate = deliveryRateToRestore(
      cart([PICKUP_RATE, STANDARD], PICKUP_RATE.rateId).shippingRates,
      "flat_rate:gone",
    );
    expect(rate?.rateId).toBe(STANDARD.rateId);
  });

  it("answers null when a delivery rate is already selected", () => {
    expect(
      deliveryRateToRestore(
        cart([PICKUP_RATE, STANDARD], STANDARD.rateId).shippingRates,
        STANDARD.rateId,
      ),
    ).toBeNull();
  });

  it("answers null when the cart has selected nothing at all", () => {
    // Every cart's starting state. The shipping-options step owns this choice.
    expect(
      deliveryRateToRestore(cart([PICKUP_RATE, STANDARD], null).shippingRates),
    ).toBeNull();
  });

  it("answers null when the address is unserviceable (pickup only)", () => {
    expect(
      deliveryRateToRestore(
        cart([PICKUP_RATE], PICKUP_RATE.rateId).shippingRates,
        STANDARD.rateId,
      ),
    ).toBeNull();
  });
});

describe("restoreDeliveryRateAfterPickup", () => {
  it("selects a delivery rate, publishes the refreshed cart, and Express mounts again", async () => {
    const before = cart([PICKUP_RATE, STANDARD, EXPRESS], PICKUP_RATE.rateId);
    // The bug, stated as an assertion: this is the cart "Ship to home" used to
    // leave behind, and the real gate hides Express on it.
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.ADDRESS, before),
    ).toBe(false);

    const after = cart([PICKUP_RATE, STANDARD, EXPRESS], EXPRESS.rateId);
    const selectShipping = vi.fn(async () => ({
      success: true as const,
      cart: after,
    }));
    const onCart = vi.fn();

    const result = await restoreDeliveryRateAfterPickup(
      before,
      EXPRESS.rateId,
      { selectShipping, onCart },
    );

    expect(selectShipping).toHaveBeenCalledTimes(1);
    expect(selectShipping).toHaveBeenCalledWith("0", EXPRESS.rateId);
    expect(onCart).toHaveBeenCalledWith(after);
    expect(result).toBe(after);
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.ADDRESS, after),
    ).toBe(true);
  });

  it("makes no selection call when a delivery rate is already selected", async () => {
    const selected = cart([PICKUP_RATE, STANDARD], STANDARD.rateId);
    const selectShipping = vi.fn();
    const onCart = vi.fn();

    const result = await restoreDeliveryRateAfterPickup(
      selected,
      STANDARD.rateId,
      { selectShipping, onCart },
    );

    expect(selectShipping).not.toHaveBeenCalled();
    expect(onCart).not.toHaveBeenCalled();
    expect(result).toBeNull();
    // Nothing to fix: Express was already mounted on this cart.
    expect(
      shouldMountExpressCheckout(CheckoutFormStepEnum.ADDRESS, selected),
    ).toBe(true);
  });

  it("leaves an unserviceable address to the shipping-options step", async () => {
    const pickupOnly = cart([PICKUP_RATE], PICKUP_RATE.rateId);
    const selectShipping = vi.fn();

    await expect(
      restoreDeliveryRateAfterPickup(pickupOnly, undefined, {
        selectShipping,
        onCart: vi.fn(),
      }),
    ).resolves.toBeNull();
    expect(selectShipping).not.toHaveBeenCalled();
  });

  it("does not publish a cart when the selection fails", async () => {
    const before = cart([PICKUP_RATE, STANDARD], PICKUP_RATE.rateId);
    const onCart = vi.fn();

    const result = await restoreDeliveryRateAfterPickup(before, undefined, {
      selectShipping: async () => ({
        success: false as const,
        error: "Store API unavailable",
      }),
      onCart,
    });

    expect(result).toBeNull();
    expect(onCart).not.toHaveBeenCalled();
  });

  it("does nothing when there is no cart", async () => {
    const selectShipping = vi.fn();
    await expect(
      restoreDeliveryRateAfterPickup(null, STANDARD.rateId, {
        selectShipping,
        onCart: vi.fn(),
      }),
    ).resolves.toBeNull();
    expect(selectShipping).not.toHaveBeenCalled();
  });
});

describe("Click & Collect is unchanged", () => {
  it("still hides Express while a pickup rate is selected", () => {
    expect(
      shouldMountExpressCheckout(
        CheckoutFormStepEnum.ADDRESS,
        cart([PICKUP_RATE, STANDARD], PICKUP_RATE.rateId),
      ),
    ).toBe(false);
  });
});

/**
 * The call site, read as SOURCE. A rule nobody calls is the shape this defect
 * already had: the pure helpers above were satisfiable by a cart fixture while
 * the real submit path did nothing. These two assertions cannot see a submit,
 * a `runServerUpdate` or a re-render — they catch the wiring being deleted, or
 * moved out of the Ship-to-home branch and onto Click & Collect.
 */
describe("CheckoutForm wires it into the Ship-to-home submit", () => {
  const source = readFileSync(
    join(process.cwd(), "app/checkout/CheckoutForm.tsx"),
    "utf8",
  );

  it("calls the helper with the real cart action and the cart setter", () => {
    const call = source.slice(
      source.indexOf("restoreDeliveryRateAfterPickup("),
    );
    expect(source).toContain(
      'import { restoreDeliveryRateAfterPickup } from "@/lib/restore-delivery-rate"',
    );
    expect(call).toContain("formData.shippingRateId");
    expect(call).toContain("selectShippingAction(");
    expect(call).toContain("keepCheckoutSession: true");
    expect(call).toContain("onCart: setCartData");
  });

  it("guards the call on SHIPPING_TO_HOME", () => {
    const guard = source.lastIndexOf(
      "DeliveryStepEnum.SHIPPING_TO_HOME",
      source.indexOf("restoreDeliveryRateAfterPickup("),
    );
    expect(guard).toBeGreaterThan(-1);
    const between = source.slice(
      guard,
      source.indexOf("restoreDeliveryRateAfterPickup("),
    );
    // Nothing but the guard's own closing brace and the `const` binding may
    // sit between them — a CLICK_AND_COLLECT branch appearing here would mean
    // the restore had moved onto the pickup path.
    expect(between).not.toContain("CLICK_AND_COLLECT");
  });
});

/**
 * The rule that stops a wallet (Apple Pay / Google Pay / Link) confirm from
 * charging a shipping-less total.
 *
 * ## The defect
 *
 * A Checkout Session's `amount_total` is what a wallet confirm charges. The
 * session is created and re-synced by commerce's `buildCheckoutLineItemParams`
 * (platform #681: full shipping menu, selected rate first). Until a cart has a
 * selected rate there is nothing to emit, so on Contact — before any address —
 * the session goes out with `shipping_options: []` while
 * `shipping_address_collection` still makes the sheet ask for, and return, a
 * real address. ENG-780's charge-total rule still holds: only index 0 is
 * auto-applied toward `amount_total`.
 *
 * Live order 283750 on www.bikesociety.com.au is the evidence
 * (`pi_3UOsaCDMTJOcMWX61EfkyUbL`, `wallet.type: apple_pay`): session
 * `shipping_options: []`, `shipping_cost: null`, `amount_total: 2995` — the
 * item total alone — against a WooCommerce order total of 4195. The buyer
 * authorised $29.95 for a $41.95 order, the capture guard logged
 * `_headkit_amount_mismatch captured=2995 order_total=4195` and put the order
 * on hold. Order 283749 is the control that shows BOTH conditions are needed:
 * also a wallet payment (`wallet_type: link`), but its cart had free shipping,
 * so there was no shipping to drop and it charged correctly.
 *
 * Since 2026-10-14 the NORMAL path re-prices inside the sheet, through
 * Stripe's private-preview `shippingaddresschange` / `shippingratechange`
 * handlers on the Checkout-mode element — so the first tap pays the right
 * amount. That preview is a per-account flag, which is why the confirm-time
 * rules below are kept as the floor behind it rather than deleted. The whole
 * flow, the flag, and the readings behind both live at the head of
 * `components/checkout/express-checkout-top.tsx`; the preview's own event
 * shapes live in `lib/stripe-ece-shipping-preview.ts`.
 *
 * ## Why nothing here computes money
 *
 * `buildCheckoutLineItemParams` guarantees
 * `Σ line_items[i].unit_amount × quantity + shipping_option ==
 * MinorAmount(cart.Totals.TotalPrice)`, and `TotalPrice` is tax-INCLUSIVE
 * where every other Store API total is tax-exclusive with the tax in a sibling
 * field (`lib/cart-prices.ts` is the authority). Comparing those two figures
 * across a currency divisor in the browser is mechanism 2's job, done
 * server-side where the authoritative numbers are. The rule below compares
 * PRESENCE only, and there is deliberately no function in this module that
 * derives a shipping price. The one figure that reaches a shopper from here —
 * the new total quoted after a re-price — is Stripe's OWN formatted string,
 * handed in rather than computed ({@link walletRepriceRefusal}).
 *
 * ## Two halves, and the second one came later
 *
 * {@link walletConfirmRefusal} is the FLOOR: it refuses a confirm that would
 * charge a shipping-less total, and it never prices anything.
 * {@link walletConfirmPlan} sits in front of it and answers the larger
 * question — whether this authorisation can be confirmed, must be refused, or
 * can be turned into a priced cart plus a request for one more tap. The
 * floor stays reachable through it and keeps its own job; see
 * `components/checkout/express-checkout-top.tsx` for how the two compose and
 * what the re-pricing attempt is forbidden from doing.
 */

import {
  isPickupRate,
  isPricedRate,
  selectedDeliveryRate,
  type CartShippingPackageLike,
  type CartShippingRateLike,
} from "@/lib/shipping-rates";

/** What the sheet is told when a wallet confirm must not be allowed through. */
export interface WalletConfirmRefusal {
  /**
   * Stripe's `paymentFailed` reason, and the choice between the three values
   * used here is about what the SHEET does next, not about tone.
   *
   * Stripe maps these onto Apple Pay's own completion statuses: a plain
   * failure DISMISSES the sheet, while a status naming a contact field keeps
   * it OPEN so the buyer can correct that field. Both behaviours are wanted,
   * for different refusals:
   *
   * - **`"fail"` — dismiss.** Used whenever the session's AMOUNT has changed,
   *   or may be wrong, under a sheet that is already displaying a figure. An
   *   open sheet shows the amount it was built with and never re-reads the
   *   session, so re-authorising inside it would consent to one number and
   *   charge another. Dismissing forces the next tap to build a fresh request
   *   from the updated session, which is the only way the buyer can see what
   *   they are approving. This is also the original stage-1 value, chosen for
   *   a second reason that still holds: on a desync the address may be
   *   perfectly deliverable — what failed is that the session was never priced
   *   for it — and claiming the buyer's address is bad would send them to
   *   correct something that is not wrong.
   * - **`"invalid_shipping_address"` — keep open.** Used only when the sheet
   *   handed us no usable destination at all. The address genuinely is the
   *   thing that needs attention, nothing about the amount has moved, and
   *   leaving the sheet open is the one case where the buyer can fix the
   *   problem without starting again.
   * - **`"address_unserviceable"` — keep open.** Used when WooCommerce
   *   returned no delivery rate for the destination the sheet gave. Same
   *   reasoning: truthful, amount unmoved, correctable in place.
   *
   * Which status each value really produces on a device is a device claim —
   * it cannot be observed from CI, and the PR that introduced the re-pricing
   * path lists it as the open risk.
   */
  reason: "fail" | "invalid_shipping_address" | "address_unserviceable";
  message: string;
}

/** What {@link walletConfirmRefusal} needs to decide. */
export interface WalletConfirmState {
  /**
   * Tax-inclusive shipping the CART will bill, in major units — i.e.
   * `shippingDisplayTotal(cart)`. Zero on a free-shipping or
   * nothing-to-ship cart.
   */
  cartShippingCost: number;
  /**
   * Minor units the SESSION will charge for shipping — i.e.
   * `session.shipping?.shippingOption.minorUnitsAmount` — or `null` when the
   * session carries no shipping cost at all. `null` is the 283750 state.
   */
  sessionShippingMinorUnits: number | null;
}

/**
 * Refuse a wallet confirm that would charge a shipping-less total.
 *
 * **The rule is presence, not arithmetic:** a cart that bills shipping must be
 * confirming against a session that charges shipping. It deliberately does not
 * compare the two amounts — that is mechanism 2's job (the server-side
 * verification at manual capture that produced `_headkit_amount_mismatch` and
 * saved order 283750), it runs where the authoritative figures live, and
 * duplicating it here with a client-side currency-divisor conversion would
 * risk refusing CORRECT orders. Weakening mechanism 2 is explicitly out of
 * bounds; this is a second, earlier gate in front of it on the one path
 * mechanism 2 cannot reach in time to stop the charge, never a replacement.
 *
 * The failure mode it chooses is deliberate: a refused payment, with a message
 * in the wallet sheet, instead of an undercharge the merchant eats. Charging
 * the wrong amount is worse than refusing the payment (ENG-789).
 *
 * It cannot fire on either live order in the evidence: 283749 had free
 * shipping (`cartShippingCost === 0`), and a session synced from a cart with a
 * selected rate reports that rate as its shipping option. The shoppers it does
 * stop are the ones who tap a wallet before any delivery method has been
 * chosen on a cart that bills for delivery — which is exactly the population
 * that was being undercharged.
 */
export function walletConfirmRefusal(
  state: WalletConfirmState,
): WalletConfirmRefusal | null {
  const cartBillsShipping = state.cartShippingCost > 0;
  const sessionChargesShipping =
    state.sessionShippingMinorUnits !== null &&
    state.sessionShippingMinorUnits > 0;
  if (cartBillsShipping && !sessionChargesShipping) {
    return {
      reason: "fail",
      message:
        "We could not confirm the delivery cost for this order. Please close this and choose a delivery option on the checkout page.",
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * Pricing the cart from the address the wallet sheet itself collected
 * -------------------------------------------------------------------------- */

/**
 * The shipping address as a Checkout-mode wallet event carries it — the
 * confirm event (with `line1`) and the preview's `shippingaddresschange`
 * (without) alike.
 *
 * Structural and all-optional rather than Stripe's own `ShippingAddress`: the
 * declared type promises every field as a non-empty `string`, and it is a
 * hand-written declaration over a wire payload rather than a validator. The
 * whole point of {@link walletSheetDestination} is to decide whether the two
 * fields WooCommerce actually needs arrived, so it has to be able to see them
 * absent.
 */
export interface WalletSheetShippingAddress {
  name?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

/**
 * A destination ready to be written to the WooCommerce cart, in the shape
 * `AddressInput` takes.
 *
 * Every field is a plain `string`, blanks included, because the write has to
 * be a REPLACE rather than a merge — see {@link walletSheetDestination}.
 */
export interface WalletDestination {
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

/**
 * The destination the sheet collected, or `null` when it cannot price a cart.
 *
 * ## `city`, `postcode` and `country` are required, and the first two are a
 * ## measurement rather than a preference
 *
 * WooCommerce selects NO delivery rate until the cart's shipping address
 * carries **`city` AND `postcode` together** — measured on the rehearsal Store
 * API across eight address shapes (research
 * `261010-bs-applepay-shipping-callbacks` finding 3a): `address_1` is
 * irrelevant, and Woo's own geolocation supplies only `country` and `state`,
 * which is not enough. `country` is required on top because the shipping zone
 * is looked up from it. Without all three there is nothing to gain from the
 * write, so the caller refuses instead of mutating the cart for no reason.
 *
 * ## Why the write carries the WHOLE address, blanks included
 *
 * `update-customer` MERGES field by field — measured, same research, finding 4:
 * a partial update leaves omitted fields standing, so sending a new `postcode`
 * and `state` while omitting `city` produced the destination **"Sydney WA
 * 6000"**, which WooCommerce accepted and happily priced. An explicit empty
 * string DOES clear a field. So every field the sheet did not supply is sent
 * as `""`, making the write a true replace and a composite of two addresses
 * impossible.
 *
 * **`phone` is deliberately NOT in this shape**, which is the one exception and
 * is the merge semantics used on purpose: the sheet carries no phone, the
 * checkout's own steps may already have put one on the cart, and omitting the
 * key is what preserves it. Sending `""` would clear a phone number
 * WooCommerce needs for delivery.
 *
 * `email` is absent for the same reason — ENG-801's session-email push owns
 * that value — and the BILLING address is never touched here: posting an
 * all-empty billing address is what commerce's ENG-838 note records as wiping
 * the session's saved customer data and 400ing the finalize with
 * `missing_email_address`.
 *
 * ## The name is split on the first space, and that is a heuristic
 *
 * The sheet gives ONE `name` string. The order's name does not come from here
 * — both finalize routes read it from the session's own
 * `collected_information.shipping_details` — so this value exists to keep the
 * cart's address internally consistent with the destination it is being
 * priced for, and to make the finalize's cart-address fallback carry the
 * BUYER's own name rather than a stale one. A single-token name lands entirely
 * in `firstName` with an empty `lastName`, which is what the checkout steps do
 * with a one-word name too.
 */
export function walletSheetDestination(
  shippingAddress: WalletSheetShippingAddress | null | undefined,
): WalletDestination | null {
  const address = shippingAddress?.address;
  const city = trimmed(address?.city);
  const postcode = trimmed(address?.postal_code);
  const country = trimmed(address?.country);
  if (!city || !postcode || !country) return null;
  const name = trimmed(shippingAddress?.name);
  const firstSpace = name.indexOf(" ");
  return {
    firstName: firstSpace === -1 ? name : name.slice(0, firstSpace),
    lastName: firstSpace === -1 ? "" : name.slice(firstSpace + 1).trim(),
    address1: trimmed(address?.line1),
    address2: trimmed(address?.line2),
    city,
    state: trimmed(address?.state),
    postcode,
    country,
  };
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The cart state the wallet decisions read. */
export interface WalletCartState {
  needsShipping?: boolean | null;
  shippingRates?: readonly CartShippingPackageLike[] | null;
}

/**
 * Whether the cart is PRICED for a wallet shipping sync — i.e. whether
 * commerce has a shipping option to put on the Checkout Session.
 *
 * `true` on a cart that needs no shipping at all: there is nothing to price,
 * so it is not waiting on anything.
 *
 * A cart that needs shipping is priced when it carries a SELECTED, PRICED
 * rate — delivery OR Local Pickup / Click & Collect. Platform #681 puts the
 * full menu on the session (pickup included at $0, selected first), matching
 * monolithic WooCommerce Apple Pay / Google Pay behaviour. Both halves are
 * load-bearing:
 *
 * - **Selected**, because commerce emits nothing until a rate is selected —
 *   an offered-but-unselected menu still produces `shipping_options: []`.
 * - **Priced**, because `isPricedRate` separates a free rate (`price: "0"`,
 *   including pickup and `advanced_free_shipping`) from one WooCommerce has
 *   not costed.
 *
 * Unselected pickup rows on every cart (finding 3a) must NOT count: that is
 * every cart's starting state and is not yet priced for the session.
 */
export function cartPricedForDelivery(
  cart: WalletCartState | null | undefined,
): boolean {
  if (cart?.needsShipping === false) return true;
  if (cart?.needsShipping !== true) return false;
  const selected = selectedShippingRate(cart.shippingRates);
  return selected !== null && isPricedRate(selected);
}

/** The selected rate across packages, delivery or pickup, or `null`. */
function selectedShippingRate(
  packages: readonly CartShippingPackageLike[] | null | undefined,
): (CartShippingRateLike & { packageId: string }) | null {
  const delivery = selectedDeliveryRate(packages);
  if (delivery) return delivery;
  for (const pkg of packages ?? []) {
    for (const rate of pkg.shippingRates ?? []) {
      if (rate.selected && isPickupRate(rate.rateId)) {
        return { ...rate, packageId: pkg.packageId };
      }
    }
  }
  return null;
}

/** What the confirm handler should do with a wallet authorisation. */
export type WalletConfirmPlan =
  /** Hand the event to `checkout.confirm` — the session charges the right amount. */
  | { action: "confirm" }
  /**
   * Price the cart from {@link WalletDestination} and then REFUSE this
   * attempt. Nothing may be charged on it.
   */
  | { action: "price"; destination: WalletDestination }
  /** Refuse, with nothing to try. */
  | { action: "refuse"; refusal: WalletConfirmRefusal };

/** What {@link walletConfirmPlan} needs to decide. */
export interface WalletConfirmPlanState extends WalletConfirmState {
  /** The live cart. */
  cart: WalletCartState | null | undefined;
  /** `event.shippingAddress` from the Checkout-mode confirm event. */
  sheetShippingAddress: WalletSheetShippingAddress | null | undefined;
}

/**
 * Decide what to do with a wallet authorisation, given the cart, the session
 * and the address the sheet collected.
 *
 * ## The state this exists for
 *
 * A Checkout Session's `amount_total` is what a wallet confirm charges, and on
 * a cart with no destination that figure is the item total alone — live order
 * 283750, recorded at the head of this module. Until 2026-10-11 the answer was
 * to hide the wallet buttons until the page had priced delivery
 * (`shouldMountExpressCheckout`, PR #273), which cost one-tap on every
 * paid-shipping cart AND on every free-shipping cart, because the two are
 * indistinguishable in the Store API payload before a destination exists
 * (finding 3c).
 *
 * The confirm event carries the buyer's own address —
 * `city` and `postal_code` included, which are exactly the two fields
 * WooCommerce needs — so the cart can be priced from it and the buyer asked
 * for one more tap. The buttons are visible to everyone again.
 *
 * ## Why this is not candidate 4, which was rejected
 *
 * Candidate 4 re-priced the session and then CONFIRMED, charging more than the
 * sheet had displayed. That is a consent violation and no measurement makes it
 * acceptable. Here the re-priced attempt is always refused: nothing is charged
 * against a figure the buyer did not see, and the next tap builds a fresh
 * request from the updated session. `{ action: "price" }` is an instruction to
 * price AND refuse, never to price and continue.
 *
 * ## Why this is not candidate 2b, which was also rejected
 *
 * 2b seeded a destination the buyer never gave, and the hazard was that both
 * finalize routes fall back to the CART's address when the session's shipping
 * address is empty (finding 4, Path B) — so a fabricated destination could be
 * shipped to, silently, because finding 3b makes every AU address cost the
 * same and the server-side amount check therefore sees nothing.
 *
 * That hazard is INVERTED here, and it is the reason this approach is safe
 * where 2b was not: the address written to the cart is the one the SHEET
 * collected, so Path A (the session's address) and Path B (the cart's address)
 * are the same address. A silent mis-ship is impossible by construction rather
 * than by a safeguard. The hard rule that keeps it that way is that the
 * address may come ONLY from the confirm event — nothing fabricated, nothing
 * guessed, no default destination.
 *
 * ## The order of the decision
 *
 * 1. **An unknown cart refuses.** The plan cannot be made without one, and a
 *    refused payment is the cheap failure.
 * 2. **A cart already priced for shipping** (selected delivery OR Local
 *    Pickup) falls through to the stage-1 floor ({@link walletConfirmRefusal})
 *    — confirm when the amounts agree on presence, refuse when the session
 *    lost paid shipping. Pickup at $0 confirms when the cart bills no
 *    shipping, matching monolithic WooCommerce wallet checkout.
 * 3. **An unpriced cart prices**, when the sheet gave a usable destination.
 * 4. **An unpriced cart with no usable destination refuses**, saying so.
 */
export function walletConfirmPlan(
  state: WalletConfirmPlanState,
): WalletConfirmPlan {
  const { cart } = state;
  if (cart?.needsShipping !== true && cart?.needsShipping !== false) {
    return {
      action: "refuse",
      refusal: {
        reason: "fail",
        message: UNKNOWN_CART_MESSAGE,
      },
    };
  }
  if (cartPricedForDelivery(cart)) {
    const refusal = walletConfirmRefusal(state);
    return refusal ? { action: "refuse", refusal } : { action: "confirm" };
  }
  const destination = walletSheetDestination(state.sheetShippingAddress);
  if (!destination) {
    return {
      action: "refuse",
      refusal: {
        reason: "invalid_shipping_address",
        message:
          "We need a delivery address with a suburb and postcode to work out the delivery cost. Please continue on the checkout page.",
      },
    };
  }
  return { action: "price", destination };
}

const UNKNOWN_CART_MESSAGE =
  "We could not read your cart. Please reload the checkout page and try again.";


/**
 * How a re-priced attempt is refused.
 *
 * `formattedTotal` is the session's OWN formatted total after the re-sync —
 * `session.total.total.amount`, e.g. `"A$41.95"` — and it is read from Stripe
 * rather than formatted here for two reasons. It is the exact string the next
 * sheet will display, so the message cannot disagree with it; and this module
 * deliberately derives no money (the head of this file says so), which a
 * minor-unit divisor conversion in the browser would break.
 *
 * `null` means the re-sync did not land, so no figure may be quoted: the
 * session is still priced below the cart, which is precisely the state the
 * stage-1 floor refuses, and it will refuse the next tap too. The message
 * sends the buyer to the page rather than inviting a tap that cannot succeed.
 */
export function walletRepriceRefusal(
  formattedTotal: string | null,
): WalletConfirmRefusal {
  if (!formattedTotal) {
    return {
      reason: "fail",
      message:
        "We could not confirm the delivery cost for this order. Please close this and choose a delivery option on the checkout page.",
    };
  }
  return {
    reason: "fail",
    message: `Delivery has been added, so your total is now ${formattedTotal}. Tap to pay again to approve the new amount.`,
  };
}

/**
 * How an attempt is refused when WooCommerce returned no delivery rate for the
 * destination the sheet gave.
 *
 * Distinct from {@link walletRepriceRefusal}'s null arm on purpose: there the
 * store CAN deliver and the storefront failed to re-price, and the buyer can
 * do nothing about it from the sheet. Here the destination itself is the
 * problem, which is correctable in place — so the reason keeps the sheet open
 * and the message says what is wrong.
 */
export function walletUnserviceableRefusal(): WalletConfirmRefusal {
  return {
    reason: "address_unserviceable",
    message:
      "We cannot work out a delivery cost for that address. Please check it, or continue on the checkout page.",
  };
}

/* -------------------------------------------------------------------------- *
 * Mapping a wallet sheet's shipping-rate choice back onto the WooCommerce cart
 * -------------------------------------------------------------------------- */

/**
 * One row of the `shippingOptionMapping` `/api/checkout/sync-line-items`
 * returns: the WooCommerce rate id and the Stripe shipping-option id commerce
 * created for it on this sync.
 */
export interface WalletShippingOptionMappingItem {
  rateId: string;
  stripeShippingRateId: string;
}

/** The cart rate a wallet sheet's shipping-option choice names. */
export interface WalletSelectableRate {
  /** `selectShipping`'s first argument. */
  packageId: string;
  /** `selectShipping`'s second argument — WooCommerce's own rate id. */
  rateId: string;
}

/**
 * The cart rate a `shippingratechange` names, or `null` when it cannot be
 * resolved.
 *
 * ## Why a mapping is needed at all, and why it must be the LATEST one
 *
 * The sheet reports a STRIPE shipping-option id
 * (`shr_…`/`shipping_rate_…`), never a WooCommerce rate id, and **Stripe
 * recreates those ids on every line-item sync** — the same fact
 * `shipping-options-step.tsx` re-syncs inline for before calling
 * `updateShippingOption`. So the lookup table is whatever the MOST RECENT sync
 * returned; a stale table resolves to a rate id WooCommerce still accepts and
 * silently selects the wrong option.
 *
 * ## Two refusals
 *
 * - **No mapping row** for that Stripe id: the table is stale or the option is
 *   one commerce did not create. Selecting a guess here is a wrong-price
 *   order, so the caller rejects the change and the sheet does not advance.
 * - **No cart rate** with that rate id: the cart moved under the sheet.
 *
 * Delivery AND Local Pickup / `pickup_location` rates are both selectable —
 * platform #681 puts the full menu on the session, matching monolithic
 * WooCommerce Apple Pay / Google Pay.
 *
 * It deliberately does NOT require the rate to be priced: `isPricedRate` is
 * the caller's post-write check, because WooCommerce re-prices on selection
 * and the pre-write price is not what the session will carry.
 */
export function cartRateForStripeShippingOption(
  mapping: readonly WalletShippingOptionMappingItem[] | null | undefined,
  packages: readonly CartShippingPackageLike[] | null | undefined,
  stripeShippingRateId: string | null | undefined,
): WalletSelectableRate | null {
  if (!stripeShippingRateId) return null;
  const row = (mapping ?? []).find(
    (m) => m.stripeShippingRateId === stripeShippingRateId,
  );
  if (!row?.rateId) return null;
  for (const pkg of packages ?? []) {
    for (const rate of pkg.shippingRates ?? []) {
      if (rate.rateId === row.rateId) {
        return { packageId: pkg.packageId, rateId: rate.rateId };
      }
    }
  }
  return null;
}

/**
 * Whether the wallet's shipping events may write to this cart at all.
 *
 * An unknown cart cannot be priced. A known cart — including one with Local
 * Pickup already selected — may be written: the buyer can switch between
 * delivery and pickup inside the sheet the same way monolithic WooCommerce
 * Apple Pay / Google Pay does.
 */
export function walletMayWriteShipping(
  cart: WalletCartState | null | undefined,
): boolean {
  return cart?.needsShipping === true || cart?.needsShipping === false;
}

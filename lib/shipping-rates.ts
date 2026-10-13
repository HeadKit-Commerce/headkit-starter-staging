/**
 * Reading DELIVERY rates off a WooCommerce cart.
 *
 * WooCommerce reports Click & Collect as an ordinary shipping rate whose
 * `rateId` carries one of two method ids — core's zone-based `local_pickup`
 * (WC 2.6) or the Blocks-era options-based `pickup_location` — so every
 * surface that means "a rate the parcel is actually shipped on" has to
 * exclude both. That predicate was written out by hand in six places
 * (`CheckoutForm.tsx` three times, `shipping-options-step.tsx`,
 * `app/api/paypal/create-order/route.ts`, `app/checkout/success/[orderId]`)
 * before this module existed; the two forms people reach for are not even
 * equivalent — `includes()` matches `local_pickup:3`, `===` does not — so a
 * seventh hand-written copy is the way this diverges.
 *
 * This module is deliberately pure and shape-tolerant: the cart fragment
 * guarantees every field, but the wallet path and the checkout steps read the
 * same packages, and a structural type keeps a test from having to build a
 * whole `CartFieldsFragment`.
 */

/** WooCommerce's own pickup method ids, matched the way the checkout matches them. */
export function isPickupRate(rateId: string): boolean {
  return rateId.includes("local_pickup") || rateId.includes("pickup_location");
}

/** One rate as these helpers need it. */
export interface CartShippingRateLike {
  rateId: string;
  name: string;
  /** Major-unit decimal string, tax-EXCLUSIVE (Store API convention). */
  price: string;
  /** Major-unit decimal string — the sibling tax for `price`. */
  taxes: string;
  selected: boolean;
}

/** One shipping package as these helpers need it. */
export interface CartShippingPackageLike<
  R extends CartShippingRateLike = CartShippingRateLike,
> {
  packageId: string;
  shippingRates: R[];
}

/** A delivery rate, carrying the package it has to be selected against. */
export type DeliveryRate<
  R extends CartShippingRateLike = CartShippingRateLike,
> = R & { packageId: string };

/**
 * Every non-pickup rate across every package, flattened, in cart order.
 *
 * Cart order is preserved rather than sorted: `shipping-options-step.tsx`
 * renders this list and WooCommerce's own order is what the on-page step has
 * always shown.
 */
export function deliveryShippingRates<R extends CartShippingRateLike>(
  packages: readonly CartShippingPackageLike<R>[] | null | undefined,
): DeliveryRate<R>[] {
  const out: DeliveryRate<R>[] = [];
  for (const pkg of packages ?? []) {
    for (const rate of pkg.shippingRates ?? []) {
      if (!isPickupRate(rate.rateId)) {
        out.push({ ...rate, packageId: pkg.packageId });
      }
    }
  }
  return out;
}

/**
 * Whether WooCommerce has actually PRICED a rate, as opposed to merely
 * returning it.
 *
 * The Store API sends `price` and `taxes` as a tax-exclusive major-unit
 * decimal pair, and every surface that shows a rate's cost adds them
 * (`shipping-options-step.tsx:220`). "Priced" therefore means BOTH parse as a
 * finite number — `"0"` included, because a free rate is a priced rate and is
 * exactly the `advanced_free_shipping` row an over-threshold cart selects.
 *
 * `getFloatVal` cannot answer this question: it returns `0` for `null`, `""`
 * and `"abc"` alike, so it cannot tell a free rate from an unpriced one. That
 * is the whole reason this predicate exists rather than a `getFloatVal(...)
 * >= 0` check at the call site.
 *
 * Both fields are required rather than `price` alone: the shopper-facing cost
 * is the sum, so a rate carrying a price with no tax sibling is one whose
 * inclusive amount cannot be derived, and treating it as priced would put a
 * figure on the session that disagrees with what WooCommerce bills.
 */
export function isPricedRate(
  rate: Pick<CartShippingRateLike, "price" | "taxes">,
): boolean {
  return parsesAsAmount(rate.price) && parsesAsAmount(rate.taxes);
}

function parsesAsAmount(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Number(trimmed));
}

/**
 * The DELIVERY rate the cart has selected, or `null` when it has selected
 * none.
 *
 * **A pickup selection answers `null`.** Click & Collect arrives as an
 * ordinary shipping rate (see {@link isPickupRate}), so a cart on which the
 * shopper chose a store has a `selected` rate and no selected *delivery* rate.
 * Callers that mean "the parcel is priced to be shipped somewhere" want this
 * one; `deliveryShippingRates` is for callers that mean "what could be
 * chosen".
 *
 * **Why the first match wins rather than the only one.** Under the Store API
 * at most one rate per package carries `selected`, but a multi-package cart
 * carries one per package and nothing in the payload promises a single
 * selection overall. Returning the first keeps the function total; a caller
 * that needs every package's selection should walk
 * {@link deliveryShippingRates} itself.
 */
export function selectedDeliveryRate<R extends CartShippingRateLike>(
  packages: readonly CartShippingPackageLike<R>[] | null | undefined,
): DeliveryRate<R> | null {
  return deliveryShippingRates(packages).find((r) => r.selected) ?? null;
}

/**
 * Whether the cart has CHOSEN Click & Collect.
 *
 * The inverse of {@link selectedDeliveryRate} over the same list, and it is a
 * separate question rather than "not a delivery selection": a cart with
 * nothing selected at all has no delivery rate AND no pickup rate, and those
 * two states need different answers from the wallet mount gate — the first is
 * every cart's starting state and must mount, the second is a pickup order and
 * must not (`components/checkout/express-checkout-top.tsx` carries why).
 *
 * This store returns both `pickup_location` rows on EVERY cart, selected or
 * not (measured on the rehearsal Store API, research
 * `261010-bs-applepay-shipping-callbacks` finding 3a), so presence in the list
 * says nothing and `selected` is the whole of the signal.
 */
export function hasSelectedPickupRate(
  packages: readonly CartShippingPackageLike[] | null | undefined,
): boolean {
  for (const pkg of packages ?? []) {
    for (const rate of pkg.shippingRates ?? []) {
      if (rate.selected && isPickupRate(rate.rateId)) return true;
    }
  }
  return false;
}

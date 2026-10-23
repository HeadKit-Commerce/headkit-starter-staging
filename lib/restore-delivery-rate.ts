/**
 * Putting a DELIVERY rate back on a cart that still has Click & Collect
 * selected.
 *
 * ## The defect this closes
 *
 * Choosing Click & Collect selects a pickup rate on the WooCommerce cart
 * (`CheckoutForm.handleDeliveryNext` → `selectShippingAction`). Switching the
 * delivery method back to "Ship to home" writes the delivery ADDRESS and
 * nothing else — so WooCommerce keeps the pickup method as the chosen one,
 * because it is still a valid method for that address. The cart therefore goes
 * on reporting a selected pickup rate, and `shouldMountExpressCheckout`
 * (`components/checkout/express-checkout-mount.ts`) keeps Apple Pay / Google
 * Pay hidden for the rest of the checkout — a refresh reloads the same
 * server-side state, so the buttons never come back, and the cart stays priced
 * for pickup.
 *
 * WooCommerce keeps it ON PURPOSE: `wc_get_default_shipping_method_for_package`
 * (`includes/wc-cart-functions.php`, WooCommerce 10.9.4) keeps a chosen local
 * pickup method "if it's still in the package. We don't want to auto toggle
 * between shipping and pickup even if available shipping methods are
 * changed." Pickup is offered for every address, so it always is.
 *
 * The shipping-options step could not fix it: it only REFLECTS an
 * already-selected delivery rate (`deliveryShippingRates` filters pickup out)
 * and auto-selects nothing, so Express returned only once the buyer happened
 * to click a delivery option there.
 *
 * ## Two halves, and the split is what makes either testable
 *
 * {@link deliveryRateToRestore} is the whole DECISION and is pure: which rate
 * (if any) has to be selected, read off the cart WooCommerce returned for the
 * new address rather than off stale page state. Three properties are
 * load-bearing:
 *
 * - **A cart with a delivery rate already selected answers `null`**, so an
 *   ordinary Ship-to-home submit makes no extra round trip. That is the whole
 *   reason the gate is `hasSelectedPickupRate` and not "no delivery rate
 *   selected": a cart with nothing selected at all is every cart's starting
 *   state and must not be touched here either — the shipping-options step owns
 *   that choice.
 * - **The rate the buyer previously chose wins when the new address still
 *   offers it**, so switching away to pickup and back does not silently move
 *   them onto a different (possibly dearer) option. Matched on `rateId`
 *   against the FRESH list, never carried over blind.
 * - **An unserviceable address answers `null` rather than failing**, because
 *   WooCommerce then returns no delivery rate at all and reporting that is the
 *   shipping-options step's job, not this one's.
 *
 * {@link restoreDeliveryRateAfterPickup} performs it through injected deps so
 * the caller keeps ownership of the server action and of the cart state: the
 * component passes `selectShippingAction` (with `keepCheckoutSession: true` —
 * a checkout-mounted mutation, re-synced by the sync-line-items effect,
 * ENG-784) and `setCartData`, and the refreshed cart is handed back so the
 * same submit can go on deciding the next step from it.
 *
 * **A failed selection is swallowed, deliberately.** Before this existed the
 * step advanced fine with pickup still selected; making it throw would turn a
 * transient Store API failure into a dead checkout step for a buyer whose
 * address and rates are otherwise good. The cost is that Express stays hidden
 * until the buyer picks a delivery option on the shipping-options step — which
 * is exactly today's behaviour, so the degraded path is a no-op rather than a
 * regression.
 */

import {
  deliveryShippingRates,
  hasSelectedPickupRate,
  type CartShippingPackageLike,
  type CartShippingRateLike,
  type DeliveryRate,
} from "@/lib/shipping-rates";

/**
 * The delivery rate that must be selected to clear a pickup selection, or
 * `null` when nothing has to be selected.
 *
 * @param packages the cart's shipping packages, as WooCommerce returned them
 *   for the CURRENT address
 * @param preferredRateId the delivery rate the buyer had selected before, if
 *   any — restored when the fresh list still offers it
 */
export function deliveryRateToRestore<R extends CartShippingRateLike>(
  packages: readonly CartShippingPackageLike<R>[] | null | undefined,
  preferredRateId?: string | null,
): DeliveryRate<R> | null {
  if (!hasSelectedPickupRate(packages)) return null;
  const rates = deliveryShippingRates(packages);
  if (rates.length === 0) return null;
  const preferred = preferredRateId
    ? rates.find((rate) => rate.rateId === preferredRateId)
    : undefined;
  return preferred ?? rates[0] ?? null;
}

/** The cart mutation and the cart state this helper borrows from its caller. */
export interface RestoreDeliveryRateDeps<C> {
  selectShipping: (
    packageId: string,
    rateId: string,
  ) => Promise<{ success: true; cart: C } | { success: false; error: string }>;
  onCart: (cart: C) => void;
}

/**
 * Select a delivery rate when the cart still has Click & Collect chosen.
 *
 * Answers the refreshed cart when it selected one, and `null` when there was
 * nothing to do (no pickup selection, no delivery rate offered, no cart) or
 * when the selection failed.
 */
export async function restoreDeliveryRateAfterPickup<
  C extends { shippingRates: readonly CartShippingPackageLike[] },
>(
  cart: C | null | undefined,
  preferredRateId: string | null | undefined,
  deps: RestoreDeliveryRateDeps<C>,
): Promise<C | null> {
  const rate = deliveryRateToRestore(cart?.shippingRates, preferredRateId);
  if (!rate) return null;
  const result = await deps.selectShipping(rate.packageId, rate.rateId);
  if (!result.success) return null;
  deps.onCart(result.cart);
  return result.cart;
}

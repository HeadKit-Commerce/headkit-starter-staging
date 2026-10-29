/**
 * Helpers for Payment Intents Express Checkout Element shipping.
 *
 * Checkout Sessions Express cannot use shippingaddresschange; the PI Elements
 * Express path can. These helpers map WooCommerce cart rates ↔ Stripe sheet
 * shippingRates and sheet addresses ↔ cart UpdateCustomerInput.
 */

import { getFloatVal } from "@/lib/utils";
import {
  deliveryShippingRates,
  isPricedRate,
  type CartShippingPackageLike,
} from "@/lib/shipping-rates";

const RATE_ID_SEP = "::";

/** Stripe ECE shippingRate.id ↔ Woo package + rate. */
export function encodeExpressShippingRateId(
  packageId: string,
  rateId: string,
): string {
  return `${packageId}${RATE_ID_SEP}${rateId}`;
}

export function decodeExpressShippingRateId(
  encoded: string,
): { packageId: string; rateId: string } | null {
  const idx = encoded.indexOf(RATE_ID_SEP);
  if (idx <= 0 || idx >= encoded.length - RATE_ID_SEP.length) return null;
  return {
    packageId: encoded.slice(0, idx),
    rateId: encoded.slice(idx + RATE_ID_SEP.length),
  };
}

export interface ExpressPiShippingRate {
  id: string;
  displayName: string;
  amount: number;
}

/**
 * Delivery rates for the Apple Pay / Google Pay sheet from the current cart.
 * Amounts are tax-inclusive minor units (price + taxes), matching what Woo bills.
 */
export function expressShippingRatesFromCart(cart: {
  currency?: { minorUnit?: number | null } | null;
  shippingRates?: CartShippingPackageLike[] | null;
}): ExpressPiShippingRate[] {
  const minorUnit = cart.currency?.minorUnit ?? 2;
  const scale = 10 ** minorUnit;
  return deliveryShippingRates(cart.shippingRates)
    .filter(isPricedRate)
    .slice(0, 5) // Stripe ECE / PaymentRequest caps shipping options
    .map((rate) => {
      const major = getFloatVal(rate.price) + getFloatVal(rate.taxes);
      return {
        id: encodeExpressShippingRateId(rate.packageId, rate.rateId),
        displayName: rate.name,
        amount: Math.round(major * scale),
      };
    });
}

/**
 * Cart grand total in Stripe minor units.
 *
 * `totals.totalPrice` is a MAJOR-unit decimal string ("419.50"): the gateway
 * divides the provider minor amount by its own minor unit before it leaves
 * commerce (`graph/mapping.go` `minorToMajor`), which is why every other cart
 * surface reads it with `getFloatVal`. Scale it back up by the CART's minor
 * unit — the same scale `expressShippingRatesFromCart` uses — so the Elements
 * amount matches the server-priced PaymentIntent (`stripeutil.MinorAmount`)
 * exactly. Stripe requires the two to agree or the wallet sheet shows the
 * wrong total and `confirmPayment` fails.
 *
 * The cart minor unit is the PROVIDER's, which WooCommerce lets a merchant set
 * per store, while Stripe always charges in the ISO scale — so on a store that
 * reports a scale other than its currency's ISO one, this (like
 * `expressShippingRatesFromCart`) disagrees with the server by that factor.
 * Every store seen so far reports 2 for a 2-decimal currency; closing the gap
 * needs an ISO minor-unit table in the starter, which it does not have today.
 */
export function expressPiAmountFromCart(cart: {
  currency?: { minorUnit?: number | null } | null;
  totals?: { totalPrice?: string | null } | null;
}): number {
  const raw = cart.totals?.totalPrice?.trim() ?? "";
  if (!raw) return 0;
  const major = getFloatVal(raw);
  if (!Number.isFinite(major) || major <= 0) return 0;
  const minorUnit = cart.currency?.minorUnit ?? 2;
  return Math.round(major * 10 ** minorUnit);
}

export interface ExpressSheetShippingAddress {
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

export interface ExpressCartDestination {
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Sheet address → cart shipping write. Requires city + postcode + country
 * (Woo selects no delivery rate without city+postcode). Blanks clear merged
 * fields so two addresses cannot combine.
 */
export function expressSheetDestination(
  shippingAddress: ExpressSheetShippingAddress | null | undefined,
): ExpressCartDestination | null {
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

/**
 * The countries an express confirm will SEND to `processCheckoutAction`, for
 * the pre-charge country gate (`lib/allowed-countries.ts`).
 *
 * The billing country is the sheet's billing country and FALLS BACK to the
 * sheet destination, exactly as the order payload in `express-checkout-pi.tsx`
 * builds it — a wallet may report no billing address, and the destination is
 * then what WooCommerce validates as the billing country. Gating on the
 * billing field alone would let that fallback through to a post-charge
 * refusal. The shipping country is reported only for a cart that ships to the
 * sheet's address; Click & Collect has no destination to refuse.
 */
export function expressConfirmCountries(
  event: {
    billingDetails?: {
      address?: { country?: string | null } | null;
    } | null;
    shippingAddress?: ExpressSheetShippingAddress | null;
  },
  needsShipping: boolean,
): { billingCountry: string; shippingCountry: string } {
  const destination = expressSheetDestination(event.shippingAddress);
  return {
    billingCountry:
      event.billingDetails?.address?.country ?? destination?.country ?? "",
    // The raw sheet country rather than the destination's: the destination
    // also needs a city and postcode, and a refusal must not wait on those.
    shippingCountry: needsShipping
      ? trimmed(event.shippingAddress?.address?.country)
      : "",
  };
}

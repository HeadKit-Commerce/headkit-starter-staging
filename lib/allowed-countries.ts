import { countryCodeFrom, countryName, countryNameList } from "./country-names";

/**
 * The ONE owner of "may this billing / shipping country pay here", and of
 * every sentence a shopper reads when it may not.
 *
 * WHY IT EXISTS. WooCommerce validates the order's countries against the
 * merchant's "Selling location(s)" / "Shipping location(s)" when the order is
 * CREATED — which on every Stripe path is after the payment has succeeded. A
 * wallet whose card carries a billing address the store does not sell to was
 * therefore charged first and refused second
 * (`woocommerce_rest_invalid_address_country`, "we do not allow orders from the
 * provided country"), leaving a shopper with money taken and no order. The
 * post-payment dispositions (`lib/order-validation.ts`) make that aftermath
 * honest; this module stops the charge. Every gate that reads it runs before
 * the first write its caller can make and before anything is confirmed.
 *
 * THE RULE EVERY FUNCTION HERE OBEYS: **a gate that cannot decide ALLOWS.** No
 * policy, an unreadable policy, an absent country, a mode this module does not
 * know — each answers "allowed". The policy is read over the network
 * (`lib/country-policy.ts`), so "could not be read" is a routine state, and a
 * gate that refused a payable order because of it would be a worse defect than
 * the one it replaces. WooCommerce's own refusal still protects the merchant.
 *
 * ONE SOURCE: WooCommerce, through the gateway. `commerce.branding` carries
 * `allowedBillingCountries`, `allowedShippingCountries` and
 * `allowedBillingCountriesMode` (platform PR #693), resolved by the theme from
 * `WC()->countries->get_allowed_countries()` / `get_shipping_countries()`.
 * Nothing here re-implements WooCommerce's "same as selling" fallback, and the
 * literal `["AU", "NZ"]` the checkout page hands Stripe as its shipping-address
 * list is NOT a source — that is an address-collection setting, this is
 * whether a payment may be taken at all.
 *
 * THE BILLING MODES ARE WOOCOMMERCE'S OWN (`woocommerce_allowed_countries`):
 *
 * - `all` — sell everywhere; the list is ignored and nothing is refused.
 * - `all_except` — the list is an EXCLUSION; an empty one allows everything.
 * - `specific` — the list is the ALLOW list; an empty one cannot mean "sell
 *   nowhere", so it reads as unconfigured and allows everything.
 *
 * SHIPPING HAS NO MODE FIELD, deliberately: the theme resolves it to a plain
 * list, empty meaning unrestricted, and it is an independent axis — it may be
 * narrower than billing, or restricted while billing is not — so neither list
 * is ever derived from the other.
 */

/** WooCommerce's `woocommerce_allowed_countries` values. */
export type AllowedCountriesMode = "all" | "all_except" | "specific";

/** One axis of the policy. `countries` is upper-case ISO-2, de-duplicated. */
export interface CountryPolicy {
  countries: readonly string[];
  mode: AllowedCountriesMode;
}

/** The resolved policy for both axes — what every checkout gate reads. */
export interface AllowedCountries {
  billing: CountryPolicy;
  shipping: CountryPolicy;
}

/**
 * The three `commerce.branding` fields as they may actually ARRIVE.
 *
 * Optional although the schema declares them non-null: a gateway older than
 * platform PR #693 does not carry them, and the SDK transport strips unknown
 * fields and retries, so the read succeeds with the keys simply absent.
 */
export interface GatewayAllowedCountries {
  allowedBillingCountries?: readonly string[] | null | undefined;
  allowedShippingCountries?: readonly string[] | null | undefined;
  allowedBillingCountriesMode?: string | null | undefined;
}

/** A policy that refuses nothing — the value every failure path answers. */
export const NO_COUNTRY_RESTRICTION: AllowedCountries = {
  billing: { countries: [], mode: "all" },
  shipping: { countries: [], mode: "all" },
};

/** Stable prefix of the refusal line, so one grep finds every refusal. */
export const COUNTRY_GATE_LOG_PREFIX = "[country-gate]";

/**
 * Upper-case ISO-2 codes, de-duplicated. A value that is not a code (or an
 * English country name `countryCodeFrom` can map back to one) is dropped
 * rather than failing the list: it is merchant-entered data, and one junk entry
 * must not take the rest with it.
 */
export function normalizeCountryList(
  values: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!Array.isArray(values)) return [];
  const codes = values
    .map((value) => countryCodeFrom(value))
    .filter((code) => code.length === 2);
  return [...new Set(codes)];
}

/**
 * Coerce a mode string. An UNRECOGNISED value reads as `specific`, so the list
 * beside it is honoured — and an empty list under `specific` still allows
 * everything, so the default can never block a store that configured nothing.
 */
export function normalizeCountriesMode(
  value: string | null | undefined,
): AllowedCountriesMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "all") return "all";
  if (raw === "all_except") return "all_except";
  return "specific";
}

/**
 * Resolve the policy from the gateway's fields. `null` / `undefined` answers
 * {@link NO_COUNTRY_RESTRICTION}. Shipping is always `specific` over its own
 * list, since an empty shipping list means no restriction.
 */
export function resolveAllowedCountries(
  gateway: GatewayAllowedCountries | null | undefined,
): AllowedCountries {
  if (!gateway) return NO_COUNTRY_RESTRICTION;
  return {
    billing: {
      countries: normalizeCountryList(gateway.allowedBillingCountries),
      mode: normalizeCountriesMode(gateway.allowedBillingCountriesMode),
    },
    shipping: {
      countries: normalizeCountryList(gateway.allowedShippingCountries),
      mode: "specific",
    },
  };
}

/**
 * Is this country allowed under this policy? `true` whenever nothing can be
 * decided: no policy, mode `all`, an empty list, or a country that is not a
 * readable code.
 */
export function isCountryAllowed(
  country: string | null | undefined,
  policy: CountryPolicy | null | undefined,
): boolean {
  if (!policy || policy.mode === "all") return true;
  if (policy.countries.length === 0) return true;
  const code = countryCodeFrom(country);
  if (!code) return true;
  const listed = policy.countries.includes(code);
  return policy.mode === "all_except" ? !listed : listed;
}

/**
 * The sentence for a refused BILLING country at payment time, or `null` when
 * it is allowed. `all_except` has no allow list to name, so it names only the
 * refused country — listing the exclusions as though they were the
 * alternatives would send the shopper towards the one thing that cannot work.
 */
export function billingCountryRefusalMessage(
  country: string | null | undefined,
  policy: CountryPolicy | null | undefined,
): string | null {
  if (isCountryAllowed(country, policy)) return null;
  const refused = countryName(countryCodeFrom(country));
  if (policy?.mode === "all_except") {
    return (
      `We can't accept payments with a billing address in ${refused}.` +
      ` Please use a card or billing address in another country.`
    );
  }
  return (
    `We can only accept payments with a billing address in ${countryNameList(policy?.countries ?? [])}.` +
    ` This payment's billing address is in ${refused}.` +
    ` Please use a card or billing address in one of those countries.`
  );
}

/** The sentence for a refused DESTINATION, or `null` when it is allowed. */
export function shippingCountryRefusalMessage(
  country: string | null | undefined,
  policy: CountryPolicy | null | undefined,
): string | null {
  if (isCountryAllowed(country, policy)) return null;
  const refused = countryName(countryCodeFrom(country));
  if (policy?.mode === "all_except") {
    return `We don't deliver to ${refused}.`;
  }
  return `We don't deliver to ${refused}. We deliver to ${countryNameList(policy?.countries ?? [], "and")}.`;
}

/**
 * The inline message under the billing step's country, or `null` when the
 * value is acceptable. Shorter than {@link billingCountryRefusalMessage}: it
 * sits beside the control the shopper is about to change.
 */
export function billingCountryFieldMessage(
  country: string | null | undefined,
  policy: CountryPolicy | null | undefined,
): string | null {
  if (isCountryAllowed(country, policy)) return null;
  if (policy?.mode === "all_except") {
    return `We can't accept billing addresses in ${countryName(countryCodeFrom(country))}.`;
  }
  return `We can only accept billing addresses in ${countryNameList(policy?.countries ?? [])}.`;
}

/** Which axis refused, the code for the log, and the sentence to show. */
export interface CountryRefusal {
  axis: "billing" | "shipping";
  /** Upper-case ISO-2, or "" when the value was not a readable code. */
  country: string;
  message: string;
}

/**
 * The refusal a payment must end in, or `null` to let it through — ONE object,
 * so a caller cannot log one axis while showing the other's sentence.
 *
 * BILLING first: it is the card, the thing the shopper has to change. Pass the
 * billing country the payment will actually SEND (on a wallet, the sheet's
 * billing country or the destination it falls back to), and the shipping
 * country only on a flow that ships — a Click & Collect order has no
 * destination to refuse.
 */
export function countryRefusal(input: {
  billingCountry?: string | null | undefined;
  shippingCountry?: string | null | undefined;
  policy?: AllowedCountries | null | undefined;
}): CountryRefusal | null {
  const policy = input.policy ?? NO_COUNTRY_RESTRICTION;
  const billing = billingCountryRefusalMessage(
    input.billingCountry,
    policy.billing,
  );
  if (billing) {
    return {
      axis: "billing",
      country: countryCodeFrom(input.billingCountry),
      message: billing,
    };
  }
  const shipping = shippingCountryRefusalMessage(
    input.shippingCountry,
    policy.shipping,
  );
  if (shipping) {
    return {
      axis: "shipping",
      country: countryCodeFrom(input.shippingCountry),
      message: shipping,
    };
  }
  return null;
}

/**
 * One line per refusal, no personal data: the axis, where it fired, the
 * country CODE and the policy. A country code is not personal data and is what
 * makes a refusal attributable; no name, street, postcode or email reaches it.
 * The gates run in the BROWSER, so this is `console` (like
 * `logCheckoutFailure`) — `lib/logger.ts` writes to the server's stdout.
 */
export function logCountryRefusal(
  refusal: Pick<CountryRefusal, "axis" | "country">,
  policy: AllowedCountries | null | undefined,
  context: string,
): void {
  const axis = (policy ?? NO_COUNTRY_RESTRICTION)[refusal.axis];
  console.warn(
    `${COUNTRY_GATE_LOG_PREFIX} refused before charge`,
    JSON.stringify({
      axis: refusal.axis,
      context,
      country: refusal.country || "unknown",
      mode: axis.mode,
      allowed: axis.countries,
    }),
  );
}

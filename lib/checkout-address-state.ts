/**
 * The `state` half of a checkout address, and the one rule that keeps it
 * coherent with the country beside it.
 *
 * WHY THIS EXISTS (production, 2026-10-16, www.bikesociety.com.au)
 * A New Zealand shopper could not get past the Delivery step: a red
 * "Could not continue / The store rejected this cart operation" toast, no money
 * taken. WooCommerce had refused `update-customer` with
 * `invalid_state` — "The provided state (VIC) is not valid. Must be one of:
 * NTL, AUK, … OTA, STL" — i.e. an AUSTRALIAN state submitted with country NZ.
 *
 * The stale value was ours, not Stripe's. The `ShippingAddressElement` clears
 * its own `state` when the country changes; the bridge into react-hook-form
 * copied the element's value only on `event.complete === true`, so an
 * incomplete transition (country switched, address not yet re-entered) left the
 * previous country's state sitting in the form — and the step then PUSHED that
 * form value back out through `actions.updateShippingAddress` and
 * `updateCustomerAddressAction`, overwriting the element's correct empty state
 * with the stale one. Stripe's value is the one to trust; these helpers are the
 * belt that makes a cross-country state unrepresentable in what we push.
 *
 * SCOPE OF THE TABLES BELOW
 * `apps/starter` ships to stores that sell to `getCheckoutAllowedCountries()`
 * (AU and NZ by default — `components/checkout/utils.ts`), so the state codes
 * are enumerated for exactly those two. Every other country is handled by rule
 * rather than by table, and the rules are written so that a country we have no
 * table for behaves exactly as it does today.
 */

/**
 * WooCommerce's own state codes, per country
 * (`woocommerce/i18n/states.php`) — the list the failing production response
 * quoted back at us. Only the countries the starter's checkout sells to are
 * enumerated; add a country here when a store starts selling to it, copying the
 * codes from that file rather than inventing them.
 *
 * `TAS` deliberately appears under both (AU Tasmania, NZ Tasman): the lookup is
 * always per country, so a shared code is not ambiguous.
 */
const STATE_CODES_BY_COUNTRY: Readonly<Record<string, readonly string[]>> = {
  AU: ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  NZ: [
    "NTL",
    "AUK",
    "WKO",
    "BOP",
    "GIS",
    "HKB",
    "TKI",
    "MWT",
    "WGN",
    "TAS",
    "NSN",
    "MBH",
    "WTC",
    "CAN",
    "OTA",
    "STL",
  ],
};

/**
 * Whether WooCommerce requires a state for a country.
 *
 * Mirrors `WC_Countries::get_country_locale()`, whose shape is "required by
 * default, with per-country exceptions": NZ is one of those exceptions
 * (`state => { required: false, label: 'Region' }`), which is why NZ with an
 * EMPTY state is accepted while NZ with `VIC` is not. AU carries no override
 * and so keeps the core default.
 *
 * A country absent from this table is treated as NOT requiring one, and that
 * default is deliberate in this direction:
 *
 *   - requiring a state the element never collects strands the shopper with a
 *     "State is required" error and no field to type it into — exactly the dead
 *     end this file exists to remove, and the failure we would reintroduce by
 *     guessing at the ~200 rows of that locale table from memory;
 *   - under-requiring costs at most the pre-existing upstream refusal, with
 *     WooCommerce still the authority on its own required fields. The
 *     commerce-side guard for that refusal is a separate task
 *     (`261016-platform-nz-state-guard`).
 *
 * The table is additive: US and CA are listed because they genuinely require
 * one and are the likeliest countries a store adds next.
 */
const STATE_REQUIRED_BY_COUNTRY: Readonly<Record<string, boolean>> = {
  AU: true,
  CA: true,
  NZ: false,
  US: true,
};

/** Upper-cased, trimmed ISO-3166-1 alpha-2 code, or "" when there is none. */
function normalizeCountry(country?: string | null): string {
  return (country ?? "").trim().toUpperCase();
}

/** Does `code` name a state of `country`, per WooCommerce's own list? */
function isStateOfCountry(country: string, code: string): boolean {
  return (STATE_CODES_BY_COUNTRY[country] ?? []).includes(code);
}

/** Does `code` name a state of some country we DO have a table for? */
function isStateOfAnyKnownCountry(code: string): boolean {
  return Object.keys(STATE_CODES_BY_COUNTRY).some((country) =>
    isStateOfCountry(country, code),
  );
}

/**
 * Whether the checkout form must collect a state for this country.
 *
 * Used by the delivery and billing steps' zod refinements in place of an
 * unconditional "State is required", which blocked every NZ shopper: the Stripe
 * address element renders no State field for NZ, so nothing could ever satisfy
 * it.
 */
export function countryRequiresState(country?: string | null): boolean {
  const normalized = normalizeCountry(country);
  if (!normalized) return false;
  return STATE_REQUIRED_BY_COUNTRY[normalized] ?? false;
}

/**
 * The state that may be sent WITH `country` — "" when the one we hold belongs
 * to a different country.
 *
 * Applied where the storefront pushes an address outward (the Stripe session
 * via `updateShippingAddress` / `updateBillingAddress`, and WooCommerce via
 * `updateCustomerAddressAction`), so a stale value can never reach either even
 * if the element's own value never lands in the form.
 *
 * A value is dropped only on POSITIVE evidence of a mismatch — it is a state of
 * some country we have a table for, and not of this one. That is what keeps a
 * hand-typed value on the no-Stripe fallback path (a free-text State input,
 * where a shopper may type `Victoria` rather than `VIC`) from being silently
 * discarded, and what makes a country with no table behave exactly as before.
 */
export function resolveStateForCountry(
  country?: string | null,
  state?: string | null,
): string {
  const code = (state ?? "").trim();
  if (!code) return "";
  const normalizedCountry = normalizeCountry(country);
  // No country selected: nothing can own this state, and WooCommerce validates
  // the pair, so sending it is only ever a refusal.
  if (!normalizedCountry) return "";
  const normalizedCode = code.toUpperCase();
  if (isStateOfCountry(normalizedCountry, normalizedCode)) return code;
  return isStateOfAnyKnownCountry(normalizedCode) ? "" : code;
}

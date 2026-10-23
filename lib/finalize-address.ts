import type { AddressInput } from "@headkit/sdk";
import { countryCodeFrom } from "@/lib/country-names";

/**
 * The ONE place the two Stripe return pages build the address pair they hand
 * to a finalize, and the only place its country / state / postcode is decided.
 *
 * # Why: an EMPTY country is a 400 after the money has moved
 *
 * Both pages assembled their inputs with `source?.country ?? ""`, so a source
 * that carried no country sent `country: ""` to WooCommerce. Commerce passes
 * the client string through unchanged, and WooCommerce then refuses the whole
 * order — `woocommerce_rest_invalid_address_country`, "we do not allow orders
 * from the provided country ()" — on a shopper who has already paid. A
 * country NAME fails identically: `allowed_countries` is a code list, so
 * "Australia" is rejected exactly like "".
 *
 * # The rule: fall back across every source, then OMIT — never `""`
 *
 * `country`, `state` and `postcode` are each resolved INDEPENDENTLY down a
 * chain of sources, and the field is left off the input entirely when no
 * source carries it. An omitted field is one WooCommerce fills from the
 * customer record or reports as required; an EMPTY one is a value it actively
 * rejects. Every field of `AddressInput` is optional, so omitting is
 * type-valid and needs no commerce change.
 *
 * A country is normalised to an upper-case ISO-2 code (`lib/country-names.ts`
 * maps an English display name back to its code). Anything else is unusable
 * and the chain CONTINUES past it: a later source's real code is strictly
 * better than nothing, and when there is none the field is omitted.
 *
 * Every other field is built exactly as the two pages built it before, so a
 * checkout whose sources carry a full address produces the same input. The
 * one deliberate deviation is `phone` on the order page's no-source branch,
 * which used to send `phone: ""` and is now omitted with the rest.
 *
 * Commerce still accepts an empty country from any other client; dropping
 * empty address fields server-side remains a worthwhile platform follow-up.
 */

/** Stable log prefix — grep the storefront logs for this one string. */
export const FINALIZE_ADDRESS_LOG_PREFIX = "[finalize-address]";

/** The address shape every source offers, any field absent. */
export interface FinalizeAddressSourceLike {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  address1?: string | null | undefined;
  address2?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  postcode?: string | null | undefined;
  country?: string | null | undefined;
  phone?: string | null | undefined;
}

/** The four address sources the return pages can offer, any of them absent. */
export interface FinalizeAddressSources {
  /** `hk-billing-address`, written by the Billing step (ENG-801). */
  billingCookie?: FinalizeAddressSourceLike | null | undefined;
  /** The Stripe session's billing address (`customer_details`). */
  sessionBilling?: FinalizeAddressSourceLike | null | undefined;
  /** `hk-checkout-data`'s shipping address. */
  shippingCookie?: FinalizeAddressSourceLike | null | undefined;
  /** The Stripe session's shipping address (`shipping_details`). */
  sessionShipping?: FinalizeAddressSourceLike | null | undefined;
}

/**
 * How an empty phone is expressed. The two pages differ and each keeps its
 * own behaviour: the cart path has always sent `phone: ""`, the order path
 * has always omitted an empty one.
 */
export type FinalizePhonePolicy = "emit-empty" | "omit-empty";

export interface FinalizeAddressOptions {
  /** Billing email — always emitted, as both pages always emitted it. */
  billingEmail?: string | null | undefined;
  /** Phone to inherit when the billing source carries none. */
  billingPhoneFallback?: string | null | undefined;
  phonePolicy?: FinalizePhonePolicy;
  /** Named in the warning so a log line says which page produced it. */
  context?: string;
}

export interface FinalizeAddresses {
  billingAddress: AddressInput;
  shippingAddress: AddressInput;
  /** Fields left off because no source carried them (`[]` when none were). */
  omittedFields: string[];
}

type GeoField = "country" | "state" | "postcode";
type Side = "billing" | "shipping";

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstPresent(
  ...candidates: Array<FinalizeAddressSourceLike | null | undefined>
): FinalizeAddressSourceLike | null {
  return (
    candidates.find(
      (candidate): candidate is FinalizeAddressSourceLike => !!candidate,
    ) ?? null
  );
}

/**
 * The geo chain for one side: that side's own sources first, then the other
 * side's. A distinct billing address was entered deliberately; the other side
 * is only a floor against sending nothing.
 */
function geoChain(
  sources: FinalizeAddressSources,
  side: Side,
): Array<FinalizeAddressSourceLike | null | undefined> {
  return side === "billing"
    ? [
        sources.billingCookie,
        sources.sessionBilling,
        sources.shippingCookie,
        sources.sessionShipping,
      ]
    : [
        sources.shippingCookie,
        sources.sessionShipping,
        sources.billingCookie,
        sources.sessionBilling,
      ];
}

function resolveGeoField(
  chain: Array<FinalizeAddressSourceLike | null | undefined>,
  field: GeoField,
): string {
  for (const candidate of chain) {
    if (!candidate) continue;
    const value =
      field === "country"
        ? countryCodeFrom(candidate.country)
        : text(candidate[field]);
    if (value) return value;
  }
  return "";
}

/**
 * Build the billing and shipping inputs a finalize needs.
 *
 * Whole-address precedence is what the two pages already used: billing takes
 * the first source that EXISTS in billing cookie → session billing → shipping
 * cookie → session shipping; shipping in shipping cookie → session shipping →
 * session billing. Only the three geo fields fall back field by field, because
 * they are the ones a source can carry a hole in.
 */
export function buildFinalizeAddresses(
  sources: FinalizeAddressSources,
  options: FinalizeAddressOptions = {},
): FinalizeAddresses {
  const billingSource = firstPresent(
    sources.billingCookie,
    sources.sessionBilling,
    sources.shippingCookie,
    sources.sessionShipping,
  );
  const shippingSource = firstPresent(
    sources.shippingCookie,
    sources.sessionShipping,
    sources.sessionBilling,
  );

  const phonePolicy: FinalizePhonePolicy = options.phonePolicy ?? "omit-empty";
  const omittedFields: string[] = [];

  const geoFor = (side: Side): Pick<AddressInput, GeoField> => {
    const chain = geoChain(sources, side);
    const out: Pick<AddressInput, GeoField> = {};
    for (const field of ["country", "state", "postcode"] as const) {
      const value = resolveGeoField(chain, field);
      if (value) {
        out[field] = value;
      } else {
        omittedFields.push(`${side}.${field}`);
      }
    }
    return out;
  };

  const billingPhone =
    text(billingSource?.phone) || text(options.billingPhoneFallback);
  const shippingPhone = text(shippingSource?.phone);

  const billingAddress: AddressInput = {
    firstName: text(billingSource?.firstName),
    lastName: text(billingSource?.lastName),
    address1: text(billingSource?.address1),
    ...(text(billingSource?.address2)
      ? { address2: text(billingSource?.address2) }
      : {}),
    city: text(billingSource?.city),
    ...geoFor("billing"),
    email: text(options.billingEmail),
    ...(billingPhone || phonePolicy === "emit-empty"
      ? { phone: billingPhone }
      : {}),
  };

  const shippingAddress: AddressInput = {
    firstName: text(shippingSource?.firstName),
    lastName: text(shippingSource?.lastName),
    address1: text(shippingSource?.address1),
    ...(text(shippingSource?.address2)
      ? { address2: text(shippingSource?.address2) }
      : {}),
    city: text(shippingSource?.city),
    ...geoFor("shipping"),
    ...(shippingPhone || phonePolicy === "emit-empty"
      ? { phone: shippingPhone }
      : {}),
  };

  if (omittedFields.length > 0) {
    // ONE line, no personal data: field names plus which sources were present
    // and whether each carried a usable value. That is what makes the next
    // incident attributable to a source rather than to "the client sent ''".
    console.warn(
      `${FINALIZE_ADDRESS_LOG_PREFIX} omitted empty address fields rather than sending ""`,
      JSON.stringify({
        context: options.context ?? "unknown",
        omitted: omittedFields,
        sources: {
          billingCookie: describeSource(sources.billingCookie),
          sessionBilling: describeSource(sources.sessionBilling),
          shippingCookie: describeSource(sources.shippingCookie),
          sessionShipping: describeSource(sources.sessionShipping),
        },
      }),
    );
  }

  return { billingAddress, shippingAddress, omittedFields };
}

/** Presence only — never a value, so no address ever reaches a log. */
function describeSource(
  source: FinalizeAddressSourceLike | null | undefined,
): "absent" | Record<GeoField, boolean> {
  if (!source) return "absent";
  return {
    country: !!countryCodeFrom(source.country),
    state: !!text(source.state),
    postcode: !!text(source.postcode),
  };
}

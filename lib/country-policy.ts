import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { executeRequest, GetBrandingDocument } from "@headkit/sdk";
import { TAG } from "@/lib/cache-tags";
import { headkitTransportOpts } from "@/lib/headkit-transport";
import { errorFields, logger } from "@/lib/logger";
import {
  NO_COUNTRY_RESTRICTION,
  resolveAllowedCountries,
  type AllowedCountries,
} from "@/lib/allowed-countries";

/**
 * The ONE read of the merchant's allowed billing / shipping countries, and the
 * only source the checkout's pre-charge country gate may use.
 * `lib/allowed-countries.ts` owns what the policy MEANS; this owns where it
 * comes from. `app/checkout/checkout-session-gate.tsx` is the only caller.
 *
 * IT IS A READ OF ITS OWN, NEVER PART OF `getBranding()`. The fork this was
 * ported from first read the policy inside its branding bundle, which returns
 * a default bundle — "no restriction" included — whenever the dashboard-api
 * URL or token is unset, BELOW which the commerce read sat. Its rehearsal
 * project defined the URL without the token, so the gate shipped armed with
 * "allow everything" while the gateway answered a two-country list, and a
 * disallowed wallet was charged with the fix deployed. So: a payment-safety
 * policy may not depend on a branding/SEO transport. This reads nothing from
 * the dashboard-api env and imports no part of `lib/branding.ts`; a missing,
 * revoked or unreachable dashboard-api has no effect on it.
 *
 * A FAILED READ IS NEVER CACHED, which is why the inner scope THROWS. A value
 * returned from a `"use cache"` scope is a successful fill and is stored for
 * the entry's life, so degrading inside it would pin "no gate" until the entry
 * expired (or, with per-deployment keys, until a redeploy).
 * {@link readCountryPolicy} therefore throws out of the cached scope, nothing
 * is stored, and {@link getCountryPolicy} falls back for that ONE request; the
 * next request reads the gateway again.
 *
 * DO NOT CALL THIS FROM A ROUTE THAT PRERENDERS. A throw inside a
 * `"use cache"` scope during `next build` fails that page's prerender even
 * when the caller catches it (`lib/branding-cache-policy.ts`). It is safe on
 * `/checkout` for one reason: `await connection()` is the first statement of
 * that page, and the session gate that calls this renders below it, so no
 * prerender — build, or a client prefetch's runtime one — ever reaches it.
 *
 * THE LIFETIME IS THE REFRESH PATH. `cacheLife("minutes")` rather than the
 * longer lifetimes the storefront uses elsewhere, and finite in both cache
 * profiles (`lib/cache-profile-call-sites.test.ts`): these are WooCommerce
 * settings a merchant changes in wp-admin, and no webhook fires on "Selling
 * location(s)". `TAG.branding` is carried so a branding purge also marks it,
 * but it is not what bounds staleness. Cost: one gateway read per revalidate
 * window, on the one route that calls it.
 */
async function readCountryPolicy(): Promise<AllowedCountries> {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag(TAG.branding);

  const data = await executeRequest(
    headkitTransportOpts(),
    GetBrandingDocument,
    undefined,
  );
  const branding = data.commerce.branding;
  // A gateway older than platform PR #693 does not carry the fields, and the
  // SDK transport strips an unknown field and retries rather than failing, so
  // the read SUCCEEDS with the keys absent. That is "could not read the
  // policy", not "no restriction": throw, so it is logged and never stored.
  if (typeof branding.allowedBillingCountriesMode !== "string") {
    throw new Error(
      "commerce.branding carries no allowedBillingCountriesMode (gateway predates the field)",
    );
  }
  return resolveAllowedCountries(branding);
}

/**
 * The merchant's allowed billing / shipping countries, or NO GATE.
 *
 * Never throws. A failure answers {@link NO_COUNTRY_RESTRICTION} for this
 * request only and logs ONE `country_gate.policy_unavailable` line, because a
 * gate that is silently off is indistinguishable from one that is working —
 * the fork this came from ran a day with its gate off and nothing in the logs.
 * The line carries the error's name, code, status and message
 * ({@link errorFields}), never a request header or shopper data. Failing OPEN
 * is deliberate: WooCommerce's own refusal and the
 * post-payment dispositions remain the safety net, and refusing payments
 * outright when the policy is unknown is a merchant decision nobody has taken.
 */
export async function getCountryPolicy(): Promise<AllowedCountries> {
  try {
    return await readCountryPolicy();
  } catch (error) {
    logger.error("country_gate.policy_unavailable", errorFields(error));
    return NO_COUNTRY_RESTRICTION;
  }
}

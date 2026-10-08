/**
 * Host-aware indexing predicate (MIG-03, T-15.1-08-01/03).
 *
 * A migration rehearsal serves the store's REAL catalogue from a temporary
 * host. If that host is crawlable it competes with the customer's live site in
 * search, and the damage outlives the rehearsal. Both existing gates default
 * OPEN when branding env is unset (`lib/branding.ts` DEFAULT_BUNDLE ships
 * `allowIndexing` / `enableSitemap` true). A thrown dashboard read is
 * fail-closed in `app/robots.ts`. The host predicate is what closes a
 * rehearsal host either way, so the closed state does not depend on branding.
 *
 * This module is deliberately pure and dependency-free: no env read, no
 * network, no framework import. The caller supplies both inputs, so every
 * branch is unit-testable and the predicate cannot acquire a failure mode of
 * its own.
 *
 * Deliberately NOT keyed on `VERCEL_ENV`: a *production* Vercel deployment
 * served at a temporary host has `VERCEL_ENV === "production"`, which is
 * precisely the case this predicate exists to close.
 */

/**
 * Splits a host into comparable labels, or null when it is unusable.
 *
 * Normalisation: lowercase, port removed, one trailing root dot removed, and a
 * leading `www` label dropped so apex and www of the configured domain compare
 * equal. Returns labels rather than a string so the caller compares LABEL-WISE
 * — `endsWith` on a raw string would accept `evildishee.com.au` for
 * `dishee.com.au` (T-15.1-08-03).
 */
function toComparableLabels(rawHost: string): string[] | null {
  const trimmed = rawHost.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  let hostname: string;
  try {
    // Parsing through URL strips the port and applies IDNA/case normalisation
    // for us; a bare host is not a valid URL on its own, hence the scheme.
    hostname = new URL(`https://${trimmed}`).hostname;
  } catch {
    return null;
  }

  // A fully-qualified name may carry one trailing root dot.
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (hostname.length === 0) return null;

  const labels = hostname.split(".");
  if (labels.some((label) => label.length === 0)) return null;

  return labels[0] === "www" && labels.length > 1 ? labels.slice(1) : labels;
}

/** Extracts comparable labels from a configured absolute http(s) url. */
function configuredHostLabels(configuredUrl: string): string[] | null {
  const trimmed = configuredUrl.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  return toComparableLabels(parsed.host);
}

/**
 * True only when `currentHost` IS the store's declared production host.
 *
 * Fails CLOSED for every uncertainty — no configured url, an unparseable
 * configured url, a missing Host header, a subdomain, or a lookalike name.
 * An unknown host is treated as a temporary host.
 *
 * @param configuredUrl the store's declared frontend url (absolute, http(s))
 * @param currentHost the request's Host header, port optional
 */
export function isIndexableHost(
  configuredUrl: string | null | undefined,
  currentHost: string | null | undefined,
): boolean {
  if (!configuredUrl || !currentHost) return false;

  const expected = configuredHostLabels(configuredUrl);
  const actual = toComparableLabels(currentHost);
  if (expected === null || actual === null) return false;
  if (expected.length !== actual.length) return false;

  return expected.every((label, index) => label === actual[index]);
}

/** Where the storefront's reset-password form actually lives. */
export const RESET_PASSWORD_PATH = "/account/reset-password";

/** The two query keys WordPress puts in a reset link; both are credentials. */
const CREDENTIAL_KEYS = ["key", "login"] as const;

/**
 * The URL an emailed `/reset-password?key=…&login=…` link must land on.
 *
 * Theme versions before 0.4.99 email `{frontend}/reset-password?…`, a path no
 * storefront serves, so it fell into the `/[...slug]` catch-all and answered
 * 404 with the key unused. The query is carried over byte for byte: the key is
 * opaque and `URLSearchParams` would re-encode it.
 */
export function resetPasswordRedirectUrl(requestUrl: string): URL {
  const source = new URL(requestUrl);
  const target = new URL(RESET_PASSWORD_PATH, source);
  target.search = source.search;
  return target;
}

/**
 * `href` with `key` and `login` removed, or `null` when it carries neither.
 *
 * The page reads them once into memory, then calls this so later `page_view`
 * and history-change hits in GTM / GA4, which send the full location to Google,
 * do not carry a live reset key. Other params (`utm_*`) and the hash stay.
 */
export function withoutResetCredentials(href: string): string | null {
  const url = new URL(href);
  if (!CREDENTIAL_KEYS.some((name) => url.searchParams.has(name))) return null;
  for (const name of CREDENTIAL_KEYS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

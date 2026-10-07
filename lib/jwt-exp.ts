/**
 * Minimal JWT `exp`-claim decode for silent token refresh (FE-05).
 *
 * This reads ONLY the `exp` claim from the payload segment so the auth context
 * can schedule a refresh shortly before the JWT expires. It deliberately does
 * NOT verify the signature and does NOT pull in a full JWT-decoding library —
 * signature verification is the backend's job on every request; the client
 * only needs the expiry timestamp for scheduling.
 *
 * Threat note (T-03-R4): the decoded `exp` is used for read-only scheduling.
 * The JWT is still validated server-side on every request, so a tampered `exp`
 * cannot extend a session — at worst it changes when the client attempts a
 * refresh, and an invalid token is rejected by the backend regardless.
 *
 * All functions degrade safely (return `null`) on malformed input so the timer
 * in the provider never throws.
 */

/** Number of base64url characters → decode the middle (payload) JWT segment. */
function base64UrlDecode(segment: string): string | null {
  try {
    let b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    // Re-pad to a multiple of 4 so atob can decode it.
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad === 1) return null; // never a valid base64 length

    // `atob` is global in browsers and in Node 18+. A Buffer fallback here
    // pulls Next's Buffer polyfill into the shared auth chunk.
    return atob(b64);
  } catch {
    return null;
  }
}

/**
 * Decode the `exp` claim of a JWT and return it as epoch **milliseconds**.
 * Returns `null` for any malformed token, a missing `exp`, or a non-numeric
 * `exp` (never throws).
 */
export function decodeJwtExp(token: string | null | undefined): number | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadJson = base64UrlDecode(parts[1] ?? "");
  if (payloadJson === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null || !("exp" in payload)) {
    return null;
  }

  const exp = (payload as { exp: unknown }).exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;

  // JWT `exp` is in seconds; normalize to milliseconds.
  return exp * 1000;
}

/** Schedule the silent refresh this many ms before the token actually expires. */
export const REFRESH_SAFETY_MARGIN_MS = 30_000;

/**
 * Compute the `setTimeout` delay (ms) for the silent refresh: the token's
 * expiry minus a 30s safety margin, clamped to `0` so an already-expired (or
 * about-to-expire) token refreshes immediately rather than scheduling a
 * negative delay.
 *
 * Returns `null` when the token has no usable `exp` — the caller should then
 * NOT schedule a refresh (the timer degrades to a no-op).
 *
 * @param now epoch ms; injectable for deterministic tests (defaults to Date.now()).
 */
export function refreshDelayMs(
  token: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const expMs = decodeJwtExp(token);
  if (expMs === null) return null;
  return Math.max(0, expMs - now - REFRESH_SAFETY_MARGIN_MS);
}

import { cookies } from "next/headers";

const CART_TOKEN_COOKIE = "hk-cart-token";

/**
 * Cookie lifetime when the token carries no readable `exp` — a Shopify cart
 * GID, or a malformed value. WooCommerce's own default session length.
 */
export const CART_TOKEN_FALLBACK_MAX_AGE = 60 * 60 * 48;

export async function getCartToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(CART_TOKEN_COOKIE)?.value;
}

/**
 * Seconds until a WooCommerce Cart-Token's `exp`, or `null` when the token is
 * not a JWT with a numeric, future `exp`.
 */
export function cartTokenSecondsLeft(
  token: string,
  nowMs: number = Date.now(),
): number | null {
  try {
    // JWT segments are base64url; atob only reads the standard alphabet.
    const segment = (token.split(".")[1] ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(segment));
    if (typeof payload !== "object" || payload === null) return null;
    const exp: unknown = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    const left = Math.floor(exp - nowMs / 1000);
    return left > 0 ? left : null;
  } catch {
    return null;
  }
}

/**
 * Cookie options for `hk-cart-token`. Pass the token being written: the
 * cookie then lives exactly as long as the token does. The Store API
 * re-mints the token with a fresh `exp` on every response (the session
 * length is WooCommerce's `wc_session_expiration`: 30 days from theme
 * 0.4.89, `inc/headkit-cart-session.php`),
 * so writing each new token slides the cart forward from the shopper's last
 * change. Without a token (a delete) or with one that has no `exp`, the
 * WooCommerce-default 48h applies.
 */
export function cartTokenCookieOptions(token?: string): {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    name: CART_TOKEN_COOKIE,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge:
      (token ? cartTokenSecondsLeft(token) : null) ??
      CART_TOKEN_FALLBACK_MAX_AGE,
  };
}

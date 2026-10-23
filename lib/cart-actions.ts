"use server";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type {
  AddToCartInput,
  AddToCartMultiInput,
  CartAttributeInput,
  CartFieldsFragment,
  UpdateCustomerInput,
  GetCartQuery,
} from "@headkit/sdk";
import { GraphQLError } from "@headkit/sdk";
import type { ServerSDK } from "@headkit/sdk/server";
import type { AddonServerError } from "@/lib/addons";
import { createServerHeadkit } from "@/lib/sdk.server";
import {
  getCartToken,
  cartTokenCookieOptions,
  cartTokenSecondsLeft,
} from "@/lib/cart";
import { getAuthToken } from "@/lib/auth-cookie";
import { CHECKOUT_SESSION_COOKIE } from "@/lib/checkout-session-cookie";

export type FullCart = NonNullable<GetCartQuery["commerce"]["cart"]>;

export type AddToCartResult =
  | { success: true; cart: CartFieldsFragment }
  | { success: false; error: string; addonError?: AddonServerError };

export type CartActionResult =
  | { success: true; cart: CartFieldsFragment }
  | { success: false; error: string };

/**
 * Options threaded through every cart mutation action (ENG-784 mechanism 1).
 * Checkout-mounted mutations (coupon box, contact/delivery/shipping steps,
 * /checkout SSR cart validation) pass `keepCheckoutSession: true` — the live
 * Stripe session is re-synced by the checkout sync effect instead of expired.
 * Everything else (PDP add-to-cart, cart-drawer edits) uses the default:
 * expire the active session BEFORE mutating so a stale in-flight payment can
 * never capture a drifted amount.
 */
export type CartMutationOptions = {
  keepCheckoutSession?: boolean;
};

/**
 * Execute a cart mutation with automatic retry on expired/invalid tokens.
 * First attempt uses the existing cookie token. On failure, clears the
 * stale cookie and retries without a token so the backend mints a fresh session.
 */
const decodeTokenUserId = (token: string): string | null => {
  try {
    // JWT segments are base64url; atob only reads the standard alphabet.
    const segment = (token.split(".")[1] ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return JSON.parse(atob(segment)).user_id ?? null;
  } catch {
    return null;
  }
};

/**
 * How much fresher a token returned by a cart READ must be before
 * `getCartAction` writes it: one day, the same throttle the theme applies to
 * the session row (`inc/headkit-cart-read-extend.php`) and WooCommerce to its
 * classic sessions. The Store API re-mints the token on every response, so
 * without it every page view would set the cookie.
 */
const READ_TOKEN_RENEW_AFTER_SECONDS = 24 * 60 * 60;

/**
 * Whether a cart read should replace the stored token with the one it
 * returned. Always when commerce handed back a different cart: a token with
 * no readable `exp` (a Shopify cart GID, rotated when ORDERS_PAID consumes the
 * cart), a stored token already past its `exp`, or another session's
 * `user_id`. Otherwise only when the new token lives more than a day longer.
 */
function shouldPersistReadToken(stored: string, returned: string): boolean {
  if (returned === stored) return false;
  const returnedLeft = cartTokenSecondsLeft(returned);
  const storedLeft = cartTokenSecondsLeft(stored);
  if (returnedLeft === null || storedLeft === null) return true;
  if (decodeTokenUserId(returned) !== decodeTokenUserId(stored)) return true;
  return returnedLeft - storedLeft > READ_TOKEN_RENEW_AFTER_SECONDS;
}

function getKlaviyoId(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): string | undefined {
  return cookieStore.get("__kla_id")?.value ?? undefined;
}

// getAuthToken (reads the `hk-auth-token` cookie, forwarded as
// `Authorization: Bearer`) is shared from `@/lib/auth-cookie` so the cart and
// checkout server actions use a single cookie-name literal (no divergence).

async function withCartRetry(
  operation: (sdk: ServerSDK) => Promise<CartFieldsFragment>,
  opts?: CartMutationOptions,
): Promise<CartFieldsFragment> {
  const cartToken = await getCartToken();
  const { name: cookieName } = cartTokenCookieOptions();
  const cookieStore = await cookies();
  const klaviyoId = getKlaviyoId(cookieStore);
  const authToken = getAuthToken(cookieStore);

  // ENG-784 mechanism 1 — expire-before-mutate. withCartRetry is the single
  // choke point every cart mutation flows through: if an active checkout
  // session exists and the caller did not opt out, expire it (CART_CHANGED)
  // BEFORE the mutation so an in-flight redirect payment (BNPL/wallet) can
  // never confirm against the pre-mutation amount. The mutation proceeds
  // regardless of the expire outcome — losing the race (conflict / ownership
  // guard / network) is benign because mechanism 2 (amount verification at
  // manual capture) backstops.
  if (!opts?.keepCheckoutSession) {
    const activeSessionId = cookieStore.get(CHECKOUT_SESSION_COOKIE)?.value;
    if (activeSessionId) {
      try {
        await createServerHeadkit(
          cartToken,
          klaviyoId,
          authToken,
        ).payments.expireCheckoutSession(activeSessionId, "CART_CHANGED");
      } catch {
        // Swallowed by design — never block the cart mutation on expiry.
      }
      cookieStore.delete(CHECKOUT_SESSION_COOKIE);
    }
  }

  // Write the token every change returns, with the cookie living exactly as
  // long as that token. The Store API re-mints it with a fresh `exp` on every
  // response, so this is what slides the cart forward from the shopper's last
  // change. Writing only when the old token had under an hour left pinned the
  // cookie to the FIRST add-to-cart: the cart died 48h later however actively
  // it was used (Bike Society, 2026-10-22).
  const persistToken = (newToken: string) => {
    if (!newToken) return;
    const { name, ...opts } = cartTokenCookieOptions(newToken);
    cookieStore.set({ name, value: newToken, ...opts });
  };

  const isSessionError = (err: unknown): boolean =>
    err instanceof GraphQLError &&
    (err.hasCode("CART_SESSION_EXPIRED") || err.hasCode("CART_NOT_FOUND"));

  try {
    const result = await operation(
      createServerHeadkit(cartToken, klaviyoId, authToken),
    );
    persistToken(result.token);
    return result;
  } catch (err) {
    // Only retry on session errors. For any other error (stock, validation,
    // network) propagate immediately so the caller surfaces a real message.
    if (!isSessionError(err)) throw err;

    // Clear the stale cookie (if any) and retry with a fresh session.
    cookieStore.delete(cookieName);
    const result = await operation(
      createServerHeadkit(undefined, klaviyoId, authToken),
    );
    persistToken(result.token);
    return result;
  }
}

export async function getCartAction(): Promise<CartFieldsFragment | null> {
  try {
    const cartToken = await getCartToken();
    if (!cartToken) return null;
    const cookieStore = await cookies();
    const authToken = getAuthToken(cookieStore);
    const cart = (await createServerHeadkit(
      cartToken,
      undefined,
      authToken,
    ).cart.get()) as unknown as CartFieldsFragment;
    // A read extends the cart, not just a change: CartCountSync calls this on
    // every page load, so keeping the fresher token here is what makes the
    // cart live 30 days from the shopper's last VISIT. The session row on the
    // server is extended by the same read (theme 0.4.90,
    // inc/headkit-cart-read-extend.php); without that half the cookie would
    // outlive a cart WooCommerce had already deleted.
    if (cart?.token && shouldPersistReadToken(cartToken, cart.token)) {
      const { name: cookieName, ...cookieOpts } = cartTokenCookieOptions(
        cart.token,
      );
      cookieStore.set({ name: cookieName, value: cart.token, ...cookieOpts });
    }
    return cart;
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/**
 * Read the full cart for the cookie-bound WooCommerce session.
 *
 * `null` means "there is no cart to show" — no cookie, or a cart the provider
 * genuinely refused — and both server-rendered callers render it as a
 * terminal state (`app/checkout/page.tsx` redirects to the empty-cart page,
 * `app/quote/page.tsx` renders `<QuoteEmpty />`). A `null` returned for any
 * reason that is NOT the provider's answer is therefore a wrong page.
 *
 * That is why `unstable_rethrow(err)` is the first statement of the catch.
 * Under Cache Components a client prefetch runs a RUNTIME prerender, which
 * resolves `cookies()` rather than hanging them, so the cart token is read and
 * `cart.get()` fires — and when the prefetch completes Next rejects the
 * still-pending `fetch()` with its `HANGING_PROMISE_REJECTION` error. The SDK
 * transport wraps that in a `ConnectionError` carrying it as `cause`;
 * `unstable_rethrow` recurses into `cause`, so the interruption propagates to
 * React (which is what abandoning a prefetch should look like) instead of
 * being logged as a provider failure and turned into a null cart.
 *
 * This is the backstop: both callers `await connection()` before the read, so
 * a prefetch stops at that boundary and never starts the fetch. Every other
 * cart action's catch carries the same first line for the same reason.
 * Genuine provider errors still log and still return null.
 */
export async function getFullCartAction(): Promise<FullCart | null> {
  const cartToken = await getCartToken();
  if (!cartToken) {
    console.error("[getFullCartAction] no cart token cookie → no cart");
    return null;
  }
  try {
    const cookieStore = await cookies();
    const authToken = getAuthToken(cookieStore);
    return await createServerHeadkit(
      cartToken,
      undefined,
      authToken,
    ).cart.get();
  } catch (err) {
    // Must precede every other statement — see the docblock above.
    unstable_rethrow(err);
    const code = err instanceof GraphQLError ? err.message : String(err);
    console.error("[getFullCartAction] cart.get() failed → no cart", {
      tokenUserId: decodeTokenUserId(cartToken),
      error: code,
    });
    return null;
  }
}

/** Strip HTML / critical-error boilerplate from provider GraphQL messages. */
function sanitizeCartErrorMessage(raw: string, fallback: string): string {
  const stripped = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return fallback;
  // WordPress critical-error HTML is useless to shoppers — show a short message.
  if (
    /critical error on this website/i.test(stripped) ||
    /internal_server_error/i.test(stripped)
  ) {
    return "Unable to update cart right now. Please try again shortly.";
  }
  // Cap length so flight payloads stay small if the provider dumps a stack.
  return stripped.length > 280 ? `${stripped.slice(0, 277)}…` : stripped;
}

/**
 * Lift the structured rejection out of a GraphQL error before the message is
 * flattened.
 *
 * `sanitizeCartErrorMessage` strips tags and caps length — it exists because a
 * provider can dump a WordPress fatal into a flight payload — and whatever
 * structure the error carried is gone once it has run. So the code, the group
 * name and the add-on id are read here, off the SDK's own `errors[].extensions`
 * (14.1-04's contract; `packages/sdk/src/errors.ts` already carries them, so
 * nothing needed re-plumbing for transport).
 *
 * `field` and `addonId` are **absent keys** when there is nothing to put in
 * them, never empty strings — so this tests presence, not emptiness.
 */
function extractAddonError(err: unknown): AddonServerError | undefined {
  if (!(err instanceof GraphQLError)) return undefined;

  for (const entry of err.errors) {
    const code = entry.extensions?.["code"];
    if (typeof code !== "string") continue;
    const field = entry.extensions?.["field"];
    const addonId = entry.extensions?.["addonId"];
    return {
      code,
      // Verbatim, entity-encoding and all. The storefront decodes it at the
      // point of render; commerce deliberately does not rewrite it.
      message: entry.message,
      ...(typeof field === "string" && field ? { field } : {}),
      ...(typeof addonId === "string" && addonId ? { addonId } : {}),
    };
  }

  return undefined;
}

export async function addToCartAction(
  input: AddToCartInput,
  opts?: CartMutationOptions,
): Promise<AddToCartResult> {
  try {
    const cart = await withCartRetry((sdk) => sdk.cart.addItem(input), opts);
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to add to cart",
    );
    // Additive: `error` keeps the exact shape and content every existing caller
    // already depends on, and the structured channel sits beside it.
    const addonError = extractAddonError(err);
    return {
      success: false,
      error: message,
      ...(addonError ? { addonError } : {}),
    };
  }
}

export async function addToCartMultiAction(
  input: AddToCartMultiInput,
  opts?: CartMutationOptions,
): Promise<AddToCartResult> {
  try {
    const cart = await withCartRetry((sdk) => sdk.cart.addItems(input), opts);
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to add to cart",
    );
    return {
      success: false,
      error: message,
    };
  }
}

export async function removeCartItemAction(
  key: string,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry((sdk) => sdk.cart.removeItem(key), opts);
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to remove cart item",
    );
    return { success: false, error: message };
  }
}

export async function updateCartItemAction(
  key: string,
  quantity: number,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.updateItem({ key, quantity }),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to update cart item",
    );
    return { success: false, error: message };
  }
}

export async function applyCouponAction(
  code: string,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry((sdk) => sdk.cart.applyCoupon(code), opts);
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to apply coupon",
    );
    return { success: false, error: message };
  }
}

export async function applyGiftCardAction(
  code: string,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.applyGiftCard(code),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    // The gift-cards plugin surfaces invalid-code / non-19-char failures as a
    // UserError; propagate its message verbatim. Never log the code (T-09-03).
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to apply gift card",
    );
    return { success: false, error: message };
  }
}

export async function updateCartAttributesAction(
  attributes: CartAttributeInput[],
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.updateAttributes(attributes),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to update cart",
    );
    return { success: false, error: message };
  }
}

export async function removeCouponAction(
  code: string,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.removeCoupon(code),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to remove coupon",
    );
    return { success: false, error: message };
  }
}

export async function selectShippingAction(
  packageId: string,
  rateId: string,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.selectShipping(packageId, rateId),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to select shipping",
    );
    return { success: false, error: message };
  }
}

export async function updateCustomerAddressAction(
  input: UpdateCustomerInput,
  opts?: CartMutationOptions,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry(
      (sdk) => sdk.cart.updateCustomer(input),
      opts,
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to update customer",
    );
    return { success: false, error: message };
  }
}

/**
 * Refill the cart from a Klaviyo abandoned-checkout link (checkout plan v3
 * §4.5). `rebuildKey` is the link's `wck_rebuild_cart` value; the store
 * rebuilds the cart this cookie names (or a new one) and the cookie is pointed
 * at the result by withCartRetry. It is a cart mutation like any other, so an
 * open checkout session for the old contents is expired first (ENG-784).
 */
export async function rebuildCartFromKlaviyoAction(
  rebuildKey: string,
): Promise<CartActionResult> {
  try {
    const cart = await withCartRetry((sdk) =>
      sdk.cart.rebuildFromKlaviyo(rebuildKey),
    );
    return { success: true, cart };
  } catch (err) {
    unstable_rethrow(err);
    const message = sanitizeCartErrorMessage(
      err instanceof Error ? err.message : "",
      "Failed to rebuild cart",
    );
    return { success: false, error: message };
  }
}

/**
 * Delete the httpOnly `hk-cart-token` cookie. Called from signOut
 * (auth-context.tsx): the WP theme resolves the WP user from the Cart-Token
 * itself (session identity unification — see
 * .planning/debug/stripe-shipping-desync-logged-in.md), so a cart token left
 * behind after logout would keep every wc/store request acting as the
 * logged-out user. A fresh guest cart token is minted automatically by the
 * backend on the next cart operation.
 */
export async function clearCartTokenAction(): Promise<void> {
  const { name: cookieName } = cartTokenCookieOptions();
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

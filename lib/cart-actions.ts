"use server";

import { cookies } from "next/headers";
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
import { getCartToken, cartTokenCookieOptions } from "@/lib/cart";
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
    return JSON.parse(atob(token.split(".")[1] ?? "")).user_id ?? null;
  } catch {
    return null;
  }
};

const isTokenExpiringSoon = (
  token: string,
  thresholdSeconds = 3600,
): boolean => {
  try {
    const { exp } = JSON.parse(atob(token.split(".")[1] ?? ""));
    return exp - Date.now() / 1000 < thresholdSeconds;
  } catch {
    return true;
  }
};

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
  const { name: cookieName, ...cookieOpts } = cartTokenCookieOptions();
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

  const persistToken = (newToken: string) => {
    if (!newToken) return;
    // Skip write if same user identity AND current token is not expiring soon
    const sameUser =
      decodeTokenUserId(newToken) === decodeTokenUserId(cartToken ?? "");
    const needsRefresh = !cartToken || isTokenExpiringSoon(cartToken);
    if (!sameUser || needsRefresh) {
      cookieStore.set({ name: cookieName, value: newToken, ...cookieOpts });
    }
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
    // Shopify GIDs are not JWTs — persist whenever commerce rotated the token
    // (ORDERS_PAID consume → fresh empty cart).
    if (cart?.token && cart.token !== cartToken) {
      const { name: cookieName, ...cookieOpts } = cartTokenCookieOptions();
      cookieStore.set({ name: cookieName, value: cart.token, ...cookieOpts });
    }
    return cart;
  } catch {
    return null;
  }
}

export async function getFullCartAction(): Promise<FullCart | null> {
  const cartToken = await getCartToken();
  if (!cartToken) {
    console.error("[getFullCartAction] no cart token cookie → session_expired");
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
    const code = err instanceof GraphQLError ? err.message : String(err);
    console.error("[getFullCartAction] cart.get() failed → session_expired", {
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

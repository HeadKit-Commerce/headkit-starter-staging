"use server";

import type { CartFieldsFragment } from "@headkit/sdk";
import { getFullCartAction } from "@/lib/cart-actions";
import {
  autoCorrectCart,
  validateCartStock,
} from "@/lib/cart-validation";

/**
 * Confirm-time stock gate (Express + Payment Element).
 *
 * `/checkout` SSR already validates + auto-corrects once on page load. That is
 * not enough for a wallet tap or Pay click minutes later: WooCommerce can go
 * out of stock under a still-open Stripe session. Without this check Stripe
 * charges, `processCheckout` fails, and `/checkout/success` falls through to
 * the async "payment is processing" screen — a dead end for a stock refusal.
 *
 * On failure we auto-correct the cart and deliberately expire the Checkout
 * Session (ENG-784 mechanism 1) so the next attempt cannot capture a drifted
 * amount against the corrected basket.
 */
export type EnsureCheckoutStockResult =
  | {
      ok: true;
      cart: CartFieldsFragment;
    }
  | {
      ok: false;
      message: string;
      cartEmpty: boolean;
      cart: CartFieldsFragment | null;
      /** True when auto-correct expired the live session (caller should remount). */
      sessionExpired: boolean;
    };

const STOCK_REFUSAL_MESSAGE =
  "An item in your cart is no longer available in the quantity you requested. Your cart has been updated — please review it before paying again.";

const EMPTY_AFTER_STOCK_MESSAGE =
  "An item in your cart went out of stock and your cart is now empty.";

const NO_CART_MESSAGE =
  "We could not read your cart. Please reload the checkout page and try again.";

export async function ensureCheckoutStockAction(): Promise<EnsureCheckoutStockResult> {
  let cart = await getFullCartAction();
  if (!cart) {
    return {
      ok: false,
      message: NO_CART_MESSAGE,
      cartEmpty: true,
      cart: null,
      sessionExpired: false,
    };
  }

  const validation = validateCartStock(cart.items);
  if (validation.isValid) {
    return { ok: true, cart };
  }

  // Expire the live session: cart totals are about to change under an open
  // payment. SSR page-load correction keeps the session because it runs before
  // mint; confirm-time must not.
  await autoCorrectCart(validation.issues, { keepCheckoutSession: false });

  cart = await getFullCartAction();
  const cartEmpty = !cart || cart.itemsCount === 0;

  return {
    ok: false,
    message: cartEmpty ? EMPTY_AFTER_STOCK_MESSAGE : STOCK_REFUSAL_MESSAGE,
    cartEmpty,
    cart,
    sessionExpired: true,
  };
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCheckoutMode } from "@/components/checkout/checkout-mode-provider";
import {
  addToCartAction,
  getCartAction,
  removeCartItemAction,
  updateCartItemAction,
} from "@/lib/cart-actions";
import { isQuoteMode } from "@/lib/checkout-mode";
import { hostedCheckoutUrl } from "@/lib/hosted-checkout";
import { searchProducts } from "@/lib/search-actions";
import { getWebMcpProduct } from "@/lib/webmcp-actions";
import { markShopperRemovedLine } from "@/lib/shopper-cart-edit";
import {
  registerWebMcpTools,
  resolveCheckoutPlan,
  resolveModelContext,
  type WebMcpCartSource,
  type WebMcpDeps,
} from "@/lib/webmcp";

/**
 * Registers storefront tools on `document.modelContext` when the browser
 * exposes the API. Renders nothing.
 *
 * Mounted from the root layout as a sibling of the page, inside
 * CheckoutModeProvider, and only when the store's WebMCP setting is on. The
 * parent owns that gate; this component does not read an env flag. It reads
 * no cookies, headers, or search params, and it adds no Suspense boundary.
 */
export function WebMcpRegistrar({
  hostedCheckout,
}: {
  /** This storefront leaves for hosted checkout. The server layout decides. */
  hostedCheckout: boolean;
}): null {
  const mode = useCheckoutMode();
  const router = useRouter();
  const hidePrices = isQuoteMode(mode);

  useEffect(() => {
    const ctx = resolveModelContext({
      document: typeof document === "undefined" ? null : document,
      navigator: typeof navigator === "undefined" ? null : navigator,
    });
    if (!ctx) return;

    const navigate = (path: string): void => {
      router.push(path);
    };
    const assignExternal = (url: string): void => {
      window.location.assign(url);
    };

    const deps: WebMcpDeps = {
      hidePrices,
      searchProducts: async (query, limit) => searchProducts(query, limit),
      getProduct: (slug, colourSlug) =>
        getWebMcpProduct(slug, {
          hidePrices,
          ...(colourSlug ? { colourSlug } : {}),
        }),
      getCart: async () => (await getCartAction()) as WebMcpCartSource | null,
      applyUpdate: async (update) => {
        if (update.action === "add") {
          const result = await addToCartAction({
            id: update.productId,
            quantity: update.quantity,
            ...(update.variation.length > 0
              ? { variation: update.variation }
              : {}),
          });
          if (!result.success) {
            return {
              ok: false,
              error: result.error ?? "Failed to add to cart",
            };
          }
          return { ok: true, cart: result.cart as WebMcpCartSource };
        }
        if (update.action === "set_quantity" && update.quantity === 0) {
          markShopperRemovedLine(update.key);
          const result = await removeCartItemAction(update.key);
          if (!result.success) {
            return {
              ok: false,
              error: result.error ?? "Failed to remove cart item",
            };
          }
          return { ok: true, cart: result.cart as WebMcpCartSource };
        }
        if (update.action === "set_quantity") {
          const result = await updateCartItemAction(
            update.key,
            update.quantity,
          );
          if (!result.success) {
            return {
              ok: false,
              error: result.error ?? "Failed to update cart item",
            };
          }
          return { ok: true, cart: result.cart as WebMcpCartSource };
        }
        markShopperRemovedLine(update.key);
        const result = await removeCartItemAction(update.key);
        if (!result.success) {
          return {
            ok: false,
            error: result.error ?? "Failed to remove cart item",
          };
        }
        return { ok: true, cart: result.cart as WebMcpCartSource };
      },
      removeLine: async (key) => {
        markShopperRemovedLine(key);
        const result = await removeCartItemAction(key);
        if (!result.success) {
          return {
            ok: false,
            error: result.error ?? "Failed to remove cart item",
          };
        }
        return { ok: true, cart: result.cart as WebMcpCartSource };
      },
      navigate,
      assignExternal,
      hostedCheckout,
      checkoutPlan: async () => {
        if (hidePrices) {
          return resolveCheckoutPlan({ quote: true, hostedUrl: null });
        }
        const cart = await getCartAction();
        return resolveCheckoutPlan({
          quote: false,
          hostedUrl: hostedCheckoutUrl(cart),
        });
      },
    };

    const controller = new AbortController();
    const unregister = registerWebMcpTools(ctx, deps, controller.signal);
    return () => {
      controller.abort();
      unregister();
    };
  }, [hidePrices, hostedCheckout, router]);

  return null;
}

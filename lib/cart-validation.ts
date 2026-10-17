import type { CartItem } from "@headkit/sdk";
import { removeCartItemAction, updateCartItemAction } from "./cart-actions";
import { decodeHtmlEntities } from "./utils";
import { stripTitleMarkers } from "./title-emphasis";

/** Backorder stock status constant matching WooCommerce/provider values. */
const STOCK_STATUS_BACKORDER = "onbackorder";
const STOCK_STATUS_OUT_OF_STOCK = "outofstock";

export interface ValidationIssue {
  itemKey: string;
  itemName: string;
  currentQuantity: number;
  availableStock: number | null;
  action: "remove" | "reduce";
}

export interface CartValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  message: string | null;
}

export interface AutoCorrectResult {
  success: boolean;
  message: string;
}

/**
 * Returns the available stock for a cart item.
 * Returns null when stock is unlimited (backorder or untracked).
 * Returns 0 when explicitly out of stock.
 */
function getAvailableStock(item: CartItem): number | null {
  const status = item.stockStatus?.toLowerCase();

  if (status === STOCK_STATUS_BACKORDER) {
    return null;
  }

  if (status === STOCK_STATUS_OUT_OF_STOCK) {
    return 0;
  }

  if (item.stockQuantity === null || item.stockQuantity === undefined) {
    return null;
  }

  return item.stockQuantity;
}

/**
 * Validates all cart items against current stock levels.
 * Returns a result describing any issues found and a user-friendly message.
 */
export function validateCartStock(items: CartItem[]): CartValidationResult {
  if (!items || items.length === 0) {
    return { isValid: true, issues: [], message: null };
  }

  const issues: ValidationIssue[] = [];

  for (const item of items) {
    const available = getAvailableStock(item);
    const current = item.quantity ?? 0;

    if (available !== null && current > available) {
      issues.push({
        itemKey: item.key,
        itemName: stripTitleMarkers(decodeHtmlEntities(item.name)),
        currentQuantity: current,
        availableStock: available,
        action: available === 0 ? "remove" : "reduce",
      });
    }
  }

  if (issues.length === 0) {
    return { isValid: true, issues: [], message: null };
  }

  const only = issues[0]!;
  const message =
    issues.length === 1
      ? only.action === "remove"
        ? `"${only.itemName}" is no longer available and has been removed from your cart.`
        : `"${only.itemName}" is no longer available in the requested quantity. Your cart has been updated.`
      : `${issues.length} items in your cart are no longer available in the requested quantities. Your cart has been updated.`;

  return { isValid: false, issues, message };
}

/**
 * Auto-corrects a cart by removing out-of-stock items and reducing quantities
 * for items with insufficient stock. Runs server-side only.
 *
 * `keepCheckoutSession` defaults to `true` for `/checkout` SSR (runs before
 * the session is minted — expiring would race the create). Confirm-time
 * callers pass `false` so ENG-784 expires the live session under a drifted
 * basket (see {@link ensureCheckoutStockAction}).
 */
export async function autoCorrectCart(
  issues: ValidationIssue[],
  opts?: { keepCheckoutSession?: boolean },
): Promise<AutoCorrectResult> {
  if (issues.length === 0) {
    return { success: true, message: "Cart is valid" };
  }

  const keepCheckoutSession = opts?.keepCheckoutSession !== false;

  try {
    const toReduce = issues.filter((i) => i.action === "reduce");
    const toRemove = issues.filter((i) => i.action === "remove");

    for (const issue of toReduce) {
      await updateCartItemAction(issue.itemKey, issue.availableStock!, {
        keepCheckoutSession,
      });
    }

    for (const issue of toRemove) {
      await removeCartItemAction(issue.itemKey, { keepCheckoutSession });
    }

    return {
      success: true,
      message:
        "Some items in your cart are unavailable. Your cart has been updated.",
    };
  } catch {
    return {
      success: false,
      message: "Failed to update cart. Please try again.",
    };
  }
}

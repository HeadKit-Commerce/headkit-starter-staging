import type { CartItem } from "@headkit/sdk";
import { removeCartItemAction, updateCartItemAction } from "./cart-actions";
import { decodeHtmlEntities } from "./utils";
import { stripTitleMarkers } from "./title-emphasis";
import { lineDisplayName, type StockAlert } from "./stock-hold";

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
 */
export async function autoCorrectCart(
  issues: ValidationIssue[],
): Promise<AutoCorrectResult> {
  if (issues.length === 0) {
    return { success: true, message: "Cart is valid" };
  }

  try {
    const toReduce = issues.filter((i) => i.action === "reduce");
    const toRemove = issues.filter((i) => i.action === "remove");

    // keepCheckoutSession: this runs during /checkout SSR BEFORE the session
    // is created/registered — expiring here would race the mint. The freshly
    // created session snapshots the already-corrected cart (ENG-784).
    for (const issue of toReduce) {
      await updateCartItemAction(issue.itemKey, issue.availableStock!, {
        keepCheckoutSession: true,
      });
    }

    for (const issue of toRemove) {
      await removeCartItemAction(issue.itemKey, { keepCheckoutSession: true });
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

/**
 * One alert per line the entry auto-correct removed or reduced (checkout plan
 * v3 §2, checkpoint C1), naming the line with its variation as the alert
 * sentence wants it ("Product – Value, Value").
 */
export function stockAlertsFromValidation(
  issues: ReadonlyArray<ValidationIssue>,
  items: ReadonlyArray<CartItem>,
): StockAlert[] {
  return issues.map((issue) => {
    const line = items.find((i) => i.key === issue.itemKey);
    const name = line
      ? lineDisplayName({
          ...line,
          name: stripTitleMarkers(decodeHtmlEntities(line.name)),
        })
      : issue.itemName;
    return issue.action === "remove"
      ? { kind: "removed", name }
      : { kind: "reduced", name, quantity: issue.availableStock ?? 0 };
  });
}

/**
 * Cart lines the store already says it will not sell.
 *
 * WooCommerce checks a cart's stock only when the order is placed, which is
 * AFTER the card is charged; a line that went out of stock while it sat in the
 * cart used to be charged, refused and refunded (Bike Society, 2026-10-17).
 * Commerce now reads WooCommerce's own cart validation on every cart read and
 * reports it as `cart.issues`, refuses to create or sync a payment for such a
 * cart (GraphQL error `CART_ITEM_UNAVAILABLE`), and also marks a sold-out line
 * `stockStatus: "outofstock"` / `stockQuantity: 0`.
 *
 * This module is the storefront's one reader of that signal. It reads
 * `issues` STRUCTURALLY rather than through the SDK type: the starter is also
 * type-checked against the PUBLISHED @headkit/sdk (CI "Starter vs PUBLISHED
 * SDK"), which may predate the field, and a cart from an older gateway simply
 * has no `issues` — both must read as "no issues", never as a type error.
 */

/** Why a cart line cannot be bought as it stands (commerce `CartIssueCode`). */
export type CartIssueCode =
  | "OUT_OF_STOCK"
  | "INSUFFICIENT_STOCK"
  | "NOT_PURCHASABLE"
  | "QUANTITY_LIMIT";

/** One blocking cart issue, as commerce reports it. */
export interface CartIssueLike {
  code: string;
  message?: string | null;
  itemKey?: string | null;
  productName?: string | null;
  /**
   * How many units of the line the store can sell now — what the line is
   * reduced to (0: removed). Absent from an older gateway or SDK.
   */
  available?: number | null;
}

/**
 * Anything that may carry `issues` — a cart from any SDK version. The index
 * signature is load-bearing: without it this is a "weak" type (every property
 * optional), and TypeScript refuses a cart type that lacks `issues` entirely —
 * which is exactly what a CartFieldsFragment from the published SDK is.
 */
interface MaybeIssues {
  issues?: ReadonlyArray<CartIssueLike> | null;
  [key: string]: unknown;
}

/** The GraphQL extensions code commerce refuses a payment with. */
export const CART_ITEM_UNAVAILABLE = "CART_ITEM_UNAVAILABLE";

/** Shopper-facing sentence for an unavailable line. */
export const UNAVAILABLE_ITEM_MESSAGE =
  "This item is no longer available — remove it to continue.";

/** The blocking issues on a cart; `[]` when there are none or the field is absent. */
export function cartIssues(
  cart: MaybeIssues | null | undefined,
): ReadonlyArray<CartIssueLike> {
  return cart?.issues ?? [];
}

/** True when the store reports anything that stops this cart checking out. */
export function hasBlockingCartIssues(
  cart: MaybeIssues | null | undefined,
): boolean {
  return cartIssues(cart).length > 0;
}

interface LineLike {
  key: string;
  stockStatus?: string | null;
}

/**
 * The issue for one cart line, if any. Matches commerce's attribution by line
 * key first; falls back to the line's own stock status, which commerce sets to
 * `outofstock` for a sold-out line (and which also covers a cart read through a
 * gateway that predates `issues`).
 */
export function issueForLine(
  cart: MaybeIssues | null | undefined,
  line: LineLike,
): CartIssueLike | null {
  const byKey = cartIssues(cart).find((i) => i.itemKey === line.key);
  if (byKey) return byKey;
  if (line.stockStatus?.toLowerCase() === "outofstock") {
    return { code: "OUT_OF_STOCK", itemKey: line.key };
  }
  return null;
}

/** Whether an issue means the line must be removed (vs. reduced). */
export function issueRequiresRemoval(issue: CartIssueLike): boolean {
  return issue.code === "OUT_OF_STOCK" || issue.code === "NOT_PURCHASABLE";
}

/** The shopper-facing sentence for one line's issue. */
export function lineIssueMessage(issue: CartIssueLike): string {
  return issueRequiresRemoval(issue)
    ? UNAVAILABLE_ITEM_MESSAGE
    : "Not enough of this item is available — reduce the quantity to continue.";
}

/** Narrow an unknown thrown value to "commerce refused: an item is unavailable". */
export function isCartItemUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const hasCode = (err as { hasCode?: unknown }).hasCode;
  if (typeof hasCode === "function") {
    return (hasCode as (code: string) => boolean).call(
      err,
      CART_ITEM_UNAVAILABLE,
    );
  }
  const errors = (err as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    errors.some(
      (e) =>
        !!e &&
        typeof e === "object" &&
        (e as { extensions?: { code?: unknown } }).extensions?.code ===
          CART_ITEM_UNAVAILABLE,
    )
  );
}

/**
 * True when a cart read says the shopper must change the cart before paying:
 * a reported issue, or a line commerce marked sold out. Used where an error
 * code is not available — a Server Action error reaches the browser without
 * its GraphQL extensions in a production build — so the client re-reads the
 * cart instead of trusting a code it cannot see.
 */
export function cartNeedsAttention(
  cart:
    | (MaybeIssues & { items?: ReadonlyArray<LineLike> | null })
    | null
    | undefined,
): boolean {
  if (!cart) return false;
  if (hasBlockingCartIssues(cart)) return true;
  return (cart.items ?? []).some((line) => issueForLine(cart, line) !== null);
}

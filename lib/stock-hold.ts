/**
 * Checkout stock hold and checkpoints — the storefront's rules (checkout plan
 * v3, sections 1 and 2). Pure: no server imports, so the checkout steps, the
 * server actions and the cart drawer all share one definition.
 *
 * WHAT HAPPENS WHERE.
 *
 *  - C1, checkout entry (app/checkout/page.tsx): lines the store will not sell
 *    are removed or reduced before any payment is set up.
 *  - C2, a cart change / entering Payment (the sync-line-items effect): a
 *    refused sync is corrected in place instead of reloading the page.
 *  - C3, the Pay click: `holdCheckoutStock` reserves the cart in WooCommerce
 *    BEFORE any confirm. Nothing is confirmed unless it answers held or
 *    not-required. Express places the same hold inside `createPaymentIntent`.
 *
 * On any refusal the shopper stays on checkout: an unavailable line is
 * removed, a short line is reduced to what is available, the session is
 * re-synced, and one alert is shown per item. Checkout is left only when the
 * cart is then EMPTY — to the bag (the cart drawer) with the same alerts. No
 * refusal ends on an error screen.
 *
 * RELEASE. After a failed confirm the storefront asks commerce to release the
 * hold; commerce reads the live PaymentIntent and releases only if the attempt
 * really ended (a 3D Secure challenge in progress is not a failure). The
 * storefront never decides that itself.
 *
 * Fields are read STRUCTURALLY for the same reason as lib/cart-issues.ts: the
 * starter is also type-checked against the PUBLISHED @headkit/sdk, which may
 * predate `available` and the hold operations.
 */

import {
  CART_ITEM_UNAVAILABLE,
  issueRequiresRemoval,
  type CartIssueLike,
} from "./cart-issues";

/** The extensions code of a hold that could not be placed at all. */
export const STOCK_HOLD_UNAVAILABLE = "CHECKOUT_STOCK_HOLD_UNAVAILABLE";

/** The shopper sentence for a hold that could not be placed (plan v2 §2.3). */
export const HOLD_FAILED_MESSAGE =
  "We couldn't reserve your items just now. Please try again — you have not been charged.";

/** What the Pay click learned from the hold. */
export type HoldOutcome =
  | { status: "held" | "not_required" }
  | { status: "refused"; issues: CartIssueLike[] }
  | { status: "unavailable" };

/** One alert box: an item removed, an item reduced, or the generic sentences. */
export type StockAlert =
  | { kind: "removed"; name: string }
  | { kind: "reduced"; name: string; quantity: number }
  | { kind: "unnamed" }
  | { kind: "hold_failed" };

/** One change to make to a cart line. */
export interface CartCorrection {
  itemKey: string;
  action: "remove" | "reduce";
  /** The quantity to reduce to; 0 for a removal. */
  quantity: number;
}

interface LineLike {
  key: string;
  name?: string | null;
  quantity?: number | null;
  variation?: ReadonlyArray<{ value?: string | null }> | null;
}

/** "Product – Value, Value", the way the alert names a line. */
export function lineDisplayName(line: LineLike): string {
  const values = (line.variation ?? [])
    .map((v) => (v?.value ?? "").trim())
    .filter(Boolean);
  const name = (line.name ?? "").trim();
  return values.length > 0 ? `${name} – ${values.join(", ")}` : name;
}

/** The available count an issue carries, when it carries one. */
function issueAvailable(issue: CartIssueLike): number | null {
  const available = issue.available;
  return typeof available === "number" && Number.isFinite(available)
    ? Math.max(0, Math.floor(available))
    : null;
}

/**
 * Turns refused issues into the corrections to make and the alerts to show.
 *
 * A line is removed when its issue says so (out of stock, not purchasable) or
 * when it can have none; it is reduced when a smaller quantity is available. An
 * issue that names no line of this cart cannot be corrected, and becomes the
 * generic sentence — once, however many there are.
 */
export function planStockCorrections(
  issues: ReadonlyArray<CartIssueLike>,
  lines: ReadonlyArray<LineLike>,
): { corrections: CartCorrection[]; alerts: StockAlert[] } {
  const corrections: CartCorrection[] = [];
  const alerts: StockAlert[] = [];
  let unnamed = false;
  const seen = new Set<string>();

  for (const issue of issues) {
    const line = issue.itemKey
      ? lines.find((l) => l.key === issue.itemKey)
      : undefined;
    if (!line || seen.has(line.key)) {
      if (!line) unnamed = true;
      continue;
    }
    seen.add(line.key);
    const name = lineDisplayName(line) || (issue.productName ?? "").trim();
    const current = line.quantity ?? 0;
    const available = issueAvailable(issue);

    if (issueRequiresRemoval(issue) || available === 0) {
      corrections.push({ itemKey: line.key, action: "remove", quantity: 0 });
      alerts.push({ kind: "removed", name });
    } else if (available !== null && available < current) {
      corrections.push({
        itemKey: line.key,
        action: "reduce",
        quantity: available,
      });
      alerts.push({ kind: "reduced", name, quantity: available });
    } else {
      // The store says the line is short but not by how much: it cannot be
      // reduced to a safe number, so it is removed rather than guessed at.
      corrections.push({ itemKey: line.key, action: "remove", quantity: 0 });
      alerts.push({ kind: "removed", name });
    }
  }
  if (unnamed) alerts.push({ kind: "unnamed" });
  return { corrections, alerts };
}

/** The alert sentence (plan v2 §2.3, in the starter's "cart" wording). */
export function stockAlertText(alert: StockAlert): string {
  switch (alert.kind) {
    case "removed":
      return `Unfortunately ${alert.name} is now unavailable and has been removed from your cart. You have not been charged.`;
    case "reduced":
      return `Unfortunately only ${alert.quantity} × ${alert.name} ${alert.quantity === 1 ? "is" : "are"} available. Your cart has been updated. You have not been charged.`;
    case "unnamed":
      return "Unfortunately items in your cart are now unavailable. Your cart has been updated.";
    case "hold_failed":
      return HOLD_FAILED_MESSAGE;
  }
}

/** The search parameter that carries alerts to the bag. */
export const BAG_ALERTS_PARAM = "bag_alerts";

/** Where checkout sends the shopper when a correction empties the cart. */
export function bagUrl(alerts: ReadonlyArray<StockAlert>): string {
  const params = new URLSearchParams({
    [BAG_ALERTS_PARAM]: JSON.stringify(alerts),
  });
  return `/?${params.toString()}`;
}

/**
 * Leaves checkout for the bag with these alerts, from the browser: a full
 * navigation to {@link bagUrl}, which the root layout's cart provider opens
 * the bag from — the same arrival the server's entry redirect produces, and a
 * fresh cart read rather than the emptied one checkout was holding.
 */
export function goToBag(alerts: ReadonlyArray<StockAlert>): void {
  window.location.assign(bagUrl(alerts));
}

/** Reads alerts back from a query string; anything malformed is dropped. */
export function bagAlertsFromSearch(search: string): StockAlert[] {
  const raw = new URLSearchParams(search).get(BAG_ALERTS_PARAM);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StockAlert[] = [];
  for (const a of parsed.slice(0, 20)) {
    if (!a || typeof a !== "object") continue;
    const kind = (a as { kind?: unknown }).kind;
    const name = (a as { name?: unknown }).name;
    const quantity = (a as { quantity?: unknown }).quantity;
    if (kind === "removed" && typeof name === "string") {
      out.push({ kind, name: name.slice(0, 200) });
    } else if (
      kind === "reduced" &&
      typeof name === "string" &&
      typeof quantity === "number"
    ) {
      out.push({ kind, name: name.slice(0, 200), quantity });
    } else if (kind === "unnamed" || kind === "hold_failed") {
      out.push({ kind });
    }
  }
  return out;
}

/** A PaymentIntent's id from its client secret (`pi_…_secret_…`). */
export function paymentIntentIdFromClientSecret(secret: string): string | null {
  const idx = secret.indexOf("_secret_");
  return idx > 0 && secret.startsWith("pi_") ? secret.slice(0, idx) : null;
}

type ErrorEntry = { extensions?: Record<string, unknown> | null };

function errorEntries(err: unknown): ErrorEntry[] {
  if (!err || typeof err !== "object") return [];
  const errors = (err as { errors?: unknown }).errors;
  return Array.isArray(errors)
    ? errors.filter((e): e is ErrorEntry => !!e && typeof e === "object")
    : [];
}

/**
 * The hold refusal a thrown error carries, or null when it is not one. Read
 * server-side, where the SDK error still has its GraphQL extensions (a Server
 * Action error reaches the browser without them in production).
 */
export function holdRefusalFromError(err: unknown): HoldOutcome | null {
  for (const entry of errorEntries(err)) {
    const code = entry.extensions?.["code"];
    if (code === CART_ITEM_UNAVAILABLE) {
      const issues = entry.extensions?.["issues"];
      return {
        status: "refused",
        issues: Array.isArray(issues) ? (issues as CartIssueLike[]) : [],
      };
    }
    if (code === STOCK_HOLD_UNAVAILABLE) return { status: "unavailable" };
  }
  return null;
}

/**
 * What a thrown hold error means: its refusal, or — for ANY other failure —
 * "unavailable". The hold fails closed: no answer is never a yes.
 */
export function holdOutcomeFromError(err: unknown): HoldOutcome {
  return holdRefusalFromError(err) ?? { status: "unavailable" };
}

/** Structural view of the SDK payments domain's hold operations. */
export interface StockHoldPayments {
  holdCheckoutStock?: (
    checkoutSessionId?: string,
  ) => Promise<{ status: string }>;
  releaseCheckoutStock?: (input: {
    checkoutSessionId?: string;
    paymentIntentId?: string;
  }) => Promise<unknown>;
}

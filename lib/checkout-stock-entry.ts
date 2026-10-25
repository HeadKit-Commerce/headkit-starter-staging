import { redirect } from "next/navigation";
import {
  autoCorrectCart,
  stockAlertsFromValidation,
  validateCartStock,
} from "./cart-validation";
import { getFullCartAction } from "./cart-actions";
import { bagUrl, type StockAlert } from "./stock-hold";
import type { ReleasedByProvider } from "./order-refusal";

/** A cart as the checkout page reads it. */
export type EntryCart = NonNullable<
  Awaited<ReturnType<typeof getFullCartAction>>
>;

/**
 * Checkpoint C1 (checkout plan v3 §2): removes or reduces every line the store
 * will not sell as it stands, before any payment is set up, and records one
 * alert per line in `alerts`. When that empties the cart the shopper goes to
 * the bag with the alerts — never to an error screen.
 *
 * Server-only (it runs in app/checkout/page.tsx). Commerce marks a line
 * WooCommerce reports as sold out, no longer purchasable or held out by other
 * shoppers with stock 0, so it lands here (lib/cart-issues.ts).
 *
 * `releasedBy` names the provider when the shopper arrives from a sold-out
 * Afterpay or Klarna payment (`?released_by=`, lib/order-refusal.ts), so the
 * alerts say that provider returns any money taken instead of "you have not
 * been charged".
 */
export async function correctCartAtEntry(
  cart: EntryCart,
  alerts: StockAlert[],
  releasedBy: ReleasedByProvider | null = null,
): Promise<EntryCart> {
  const validation = validateCartStock(cart.items);
  if (validation.isValid) return cart;
  const correction = await autoCorrectCart(validation.issues);
  const found: StockAlert[] = correction.success
    ? stockAlertsFromValidation(validation.issues, cart.items)
    : [{ kind: "unnamed" as const }];
  alerts.push(
    ...found.map((alert) =>
      releasedBy && (alert.kind === "removed" || alert.kind === "reduced")
        ? { ...alert, releasedBy }
        : alert,
    ),
  );
  const next = await getFullCartAction();
  if (!next || next.itemsCount === 0) {
    redirect(bagUrl(alerts));
  }
  return next;
}

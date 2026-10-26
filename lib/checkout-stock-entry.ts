import { redirect } from "next/navigation";
import {
  autoCorrectCart,
  stockAlertsFromValidation,
  validateCartStock,
} from "./cart-validation";
import { getFullCartAction } from "./cart-actions";
import { bagUrl, type StockAlert } from "./stock-hold";

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
 */
export async function correctCartAtEntry(
  cart: EntryCart,
  alerts: StockAlert[],
): Promise<EntryCart> {
  const validation = validateCartStock(cart.items);
  if (validation.isValid) return cart;
  const correction = await autoCorrectCart(validation.issues);
  alerts.push(
    ...(correction.success
      ? stockAlertsFromValidation(validation.issues, cart.items)
      : [{ kind: "unnamed" as const }]),
  );
  const next = await getFullCartAction();
  if (!next || next.itemsCount === 0) {
    redirect(bagUrl(alerts));
  }
  return next;
}

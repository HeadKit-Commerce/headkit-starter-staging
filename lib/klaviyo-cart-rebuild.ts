/**
 * Where a Klaviyo abandoned-checkout link lands (checkout plan v3 §4.5).
 *
 * Klaviyo's WooCommerce flows link to `<site>/cart/?wck_rebuild_cart=<key>`,
 * the URL the Klaviyo for WooCommerce plugin answers on a classic store. On a
 * headless store that host is this storefront, which has no cart page, so
 * `app/cart/route.ts` answers it: the key goes to commerce, which has the
 * HeadKit theme rebuild the cart in the plugin's own format (theme >= 0.4.82),
 * and the shopper is sent on.
 *
 * Kept free of `next/*` so the decision is unit-testable on its own.
 */

/** The query parameter the plugin and Klaviyo's templates use. */
export const WCK_REBUILD_PARAM = "wck_rebuild_cart";

/** What a rebuild answered: enough to decide where the shopper goes. */
export type CartRebuildOutcome =
  | { success: true; cart: { items: readonly unknown[] } }
  | { success: false; error: string };

/**
 * The path to send the shopper to after a rebuild link, query string kept.
 *
 * - A cart with at least one line → `/checkout`, where the abandoned checkout
 *   resumes (and checkout's own entry check reports anything that changed).
 * - No key, a key that does not rebuild, or nothing left to sell → `/`. The
 *   storefront has no cart page to show an empty cart on.
 *
 * Every other query parameter is carried over, so Klaviyo's `_kx` (which its
 * onsite script reads to identify the shopper) and `utm_*` attribution survive
 * the redirect; the rebuild key itself is dropped from the destination.
 */
export async function cartRebuildDestination(
  search: URLSearchParams,
  rebuild: (rebuildKey: string) => Promise<CartRebuildOutcome>,
): Promise<string> {
  const key = search.get(WCK_REBUILD_PARAM)?.trim() ?? "";
  const carried = new URLSearchParams(search);
  carried.delete(WCK_REBUILD_PARAM);
  const query = carried.size > 0 ? `?${carried.toString()}` : "";

  if (!key) return `/${query}`;
  const outcome = await rebuild(key).catch(
    (): CartRebuildOutcome => ({ success: false, error: "rebuild failed" }),
  );
  const hasLines = outcome.success && outcome.cart.items.length > 0;
  return `${hasLines ? "/checkout" : "/"}${query}`;
}

/**
 * What the Google Tag Manager container expects from this storefront.
 *
 * ---------------------------------------------------------------------------
 * Provenance
 * ---------------------------------------------------------------------------
 * Measured 2026-09-22 against Bike Society's live container, fetched from its
 * public endpoint `https://www.googletagmanager.com/gtm.js?id=GTM-TFBM7QP`
 * (165 KB). GA4 property `G-Q55ZJLNXWW`, Google Ads `AW-11387752908`. The
 * container holds 18 GA4 event tags (`__gaawe`), 12 Google Ads conversion tags
 * (`__awct`, 12 distinct labels) and 1 Conversion Linker. Event-name references
 * counted inside it:
 *
 *   purchase 12 · view_item 8 · begin_checkout 5 · add_to_cart 5 ·
 *   view_cart 3 · add_to_wishlist 3
 *
 * The same container is loaded by the classic WooCommerce site, whose PDP
 * `dataLayer` after load reads
 * `["gtm.js", "ecommerce", "view_item", "gtm.dom", "gtm.load", "ecommerce",
 * "view_item"]` — so the names below are not aspirational, they are what the
 * live tags already trigger on.
 *
 * ---------------------------------------------------------------------------
 * Why this file is a fixture and not a set of inline expectations
 * ---------------------------------------------------------------------------
 * The other half of this contract lives in a GTM container that is edited in a
 * web UI by someone who will never see this repository, and it cannot be
 * type-checked, imported or version-controlled here. A refactor that renames
 * `item_id` to `itemId`, or `purchase` to `order_complete`, compiles, passes
 * every other test, ships — and silently stops twelve Google Ads conversion
 * labels from firing. Nothing else in the codebase would notice.
 *
 * So the strings are duplicated here ON PURPOSE. This file is the tripwire: it
 * must be edited deliberately, with the container edited to match, and a diff
 * that touches it is the signal to a reviewer that an external contract moved.
 */

/** Event names, in the container's own spelling. */
export const CONTAINER_EVENT_NAMES = [
  "view_item",
  "view_item_list",
  "select_item",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "purchase",
  "add_to_wishlist",
] as const;

/**
 * Keys that must be present on `ecommerce` for each event.
 *
 * `purchase` is the strictest row and the reason the whole file exists: the 12
 * Google Ads conversion tags read `transaction_id` (their deduplication key),
 * `value` and `currency`. Losing any one of the three loses the conversion.
 */
export const CONTAINER_REQUIRED_ECOMMERCE_KEYS: Record<
  string,
  readonly string[]
> = {
  view_item: ["currency", "value", "items"],
  view_item_list: ["item_list_name", "items"],
  select_item: ["item_list_name", "items"],
  add_to_cart: ["currency", "value", "items"],
  remove_from_cart: ["currency", "value", "items"],
  view_cart: ["currency", "value", "items"],
  begin_checkout: ["currency", "value", "items"],
  purchase: ["transaction_id", "currency", "value", "tax", "shipping", "items"],
  add_to_wishlist: ["currency", "value", "items"],
};

/** Keys every `items[]` entry must carry, on every event. */
export const CONTAINER_REQUIRED_ITEM_KEYS = [
  "item_id",
  "item_name",
  "price",
  "quantity",
] as const;

/**
 * Keys an `items[]` entry may carry. A key outside this set is a typo or a
 * private field leaking into a payload a third party parses — GA4 silently
 * drops unknown item keys, so nothing would fail at runtime.
 */
export const CONTAINER_ALLOWED_ITEM_KEYS = [
  ...CONTAINER_REQUIRED_ITEM_KEYS,
  "item_brand",
  "item_variant",
  "item_category",
  "index",
  "item_list_name",
] as const;

/**
 * Keys an `ecommerce` object may carry. Same reasoning as the item allowlist:
 * a stray key here is how store-internal data (a cart token, an email) would
 * reach Google without anything failing.
 */
export const CONTAINER_ALLOWED_ECOMMERCE_KEYS = [
  "currency",
  "value",
  "transaction_id",
  "tax",
  "shipping",
  "coupon",
  "item_list_name",
  "items",
] as const;

/**
 * WHEN `purchase` fires for an order whose items sold out during payment.
 *
 * Event and field names do not change for these orders — only whether the
 * event fires and with what numbers, and that is also something the 12 Google
 * Ads conversion tags rely on: a `purchase` for money that went straight back
 * books a conversion that never happened.
 *
 * - `fully_refunded`: no `purchase` at all. The tags never see the order.
 * - `partly_refunded`: one `purchase` for the KEPT units only. `value` is the
 *   order total less `refundTotal`, `tax` is the order tax scaled to that kept
 *   share, `shipping` is the shipping charged less `shippingRefund`, and
 *   `items[].quantity` is the kept quantity (a fully short line is omitted).
 * - `no_shortfall`: the event exactly as it was before this case existed.
 *
 * `lib/ga4-purchase-shortfall.test.ts` asserts each row against
 * `buildPurchaseFromOrder`. Changing a row means the container's conversion
 * tags need the matching edit.
 */
export const CONTAINER_PURCHASE_SHORTFALL_RULES = {
  fully_refunded: { fires: false },
  partly_refunded: { fires: true, valueIs: "total - refundTotal" },
  no_shortfall: { fires: true, valueIs: "total" },
} as const;

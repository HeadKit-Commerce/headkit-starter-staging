/**
 * The storefront's GA4 ecommerce data layer — the ONE definition of what this
 * app pushes into `window.dataLayer`.
 *
 * ---------------------------------------------------------------------------
 * Why this module exists at all
 * ---------------------------------------------------------------------------
 * Stores built from this starter load a Google Tag Manager container that was
 * written against the GA4 recommended ecommerce events. Bike Society's
 * container (`GTM-TFBM7QP`, audited 2026-09-22) holds 18 GA4 event tags and 12
 * Google Ads conversion labels, every one of them triggered by an event NAME
 * and reading an `ecommerce` object by FIELD name. Until this module existed
 * the storefront pushed nothing but GTM's own `gtm.js` bootstrap, so all 30 of
 * those tags were dead: no GA4 ecommerce, and no Google Ads conversion.
 *
 * The contract is therefore shared with a system that lives outside this
 * repository and cannot be type-checked against it. A rename on either side
 * silently kills a conversion — which is why every event name and payload key
 * is fixed here, in one module, and asserted against an explicit fixture in
 * `ga4-ecommerce.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * How the pushes reach GTM
 * ---------------------------------------------------------------------------
 * `components/headkit-ui/deferred-third-party-scripts.tsx` loads gtm.js on
 * idle (a `requestIdleCallback` with a 4 s cap, plus a first-gesture
 * fallback) — a deliberate Core Web Vitals decision. Pushes made BEFORE
 * gtm.js arrives are not lost: `dataLayer` is a plain array until GTM replaces
 * `push`, and GTM replays everything already queued when it loads. So nothing
 * here may reorder or eagerly load GTM, and nothing here may assume GTM is
 * present.
 *
 * ---------------------------------------------------------------------------
 * Money
 * ---------------------------------------------------------------------------
 * Every figure emitted is the TAX-INCLUSIVE, shopper-facing number, derived
 * through `lib/cart-prices.ts` — the same helpers the visible price rows use.
 * A WooCommerce Store API total is tax-exclusive with the tax in a sibling
 * field (see that module's header), so reading a total raw here would report
 * revenue ~9 % under what was charged on a 10 %-GST store. `item.price` is
 * PER UNIT, as GA4 defines it, so a line's inclusive total is divided by its
 * own quantity rather than re-derived from the unit price.
 */

import { lineDisplayTotal, type DisplayTotalsSource } from "@/lib/cart-prices";
import { getFloatVal } from "@/lib/utils";

declare global {
  interface Window {
    // Same type `@next/third-parties` declares (`Object[]` in
    // dist/types/google.d.ts). A second declaration has to match exactly or
    // tsc rejects the merge (TS2717), so this cannot be the primitive
    // `object` the lint rule wants.
    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types -- must match @next/third-parties Window.dataLayer
    dataLayer?: Object[];
  }
}

/**
 * The event names the GTM container triggers on. These strings are the
 * contract: they are GA4's recommended-event names and are matched verbatim by
 * tag triggers in a container this repository does not control.
 */
export const GA4_ECOMMERCE_EVENTS = {
  VIEW_ITEM: "view_item",
  VIEW_ITEM_LIST: "view_item_list",
  SELECT_ITEM: "select_item",
  ADD_TO_CART: "add_to_cart",
  REMOVE_FROM_CART: "remove_from_cart",
  VIEW_CART: "view_cart",
  BEGIN_CHECKOUT: "begin_checkout",
  PURCHASE: "purchase",
  ADD_TO_WISHLIST: "add_to_wishlist",
} as const;

export type Ga4EcommerceEventName =
  (typeof GA4_ECOMMERCE_EVENTS)[keyof typeof GA4_ECOMMERCE_EVENTS];

/**
 * One entry of the `ecommerce.items` array, in GA4's recommended shape.
 *
 * `item_id` / `item_name` / `price` / `quantity` are emitted on every surface.
 * The rest are emitted only where the surface genuinely has them: a PLP card
 * payload carries no SKU, brand or category (see `ProductSummaryFields` in the
 * SDK), and a wc/v3 ORDER line carries neither brand nor category. Omitting a
 * field the surface does not know is correct; inventing one is not.
 */
export interface Ga4Item {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  item_brand?: string;
  item_variant?: string;
  item_category?: string;
  index?: number;
  item_list_name?: string;
}

/** The `ecommerce` object GTM's variables read. */
export interface Ga4Ecommerce {
  currency?: string;
  value?: number;
  transaction_id?: string;
  tax?: number;
  shipping?: number;
  coupon?: string;
  item_list_name?: string;
  items: Ga4Item[];
}

/** One `dataLayer` entry: the event name plus its `ecommerce` payload. */
export interface Ga4EcommerceEvent {
  event: Ga4EcommerceEventName;
  ecommerce: Ga4Ecommerce;
}

/** Round to cents. Guards against float noise like `59.949999999999996`. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Push one ecommerce event.
 *
 * The `{ ecommerce: null }` reset immediately before it is Google's own
 * guidance: `dataLayer` entries merge, so without it the `items` of a previous
 * event bleed into the next one whenever the later event omits a key the
 * earlier one set.
 *
 * SSR-safe by construction — a server render returns before touching `window`.
 */
export function pushGa4Ecommerce(event: Ga4EcommerceEvent): void {
  if (typeof window === "undefined") return;
  const dataLayer = (window.dataLayer = window.dataLayer ?? []);
  dataLayer.push({ ecommerce: null });
  dataLayer.push(event);
}

const DEDUPE_PREFIX = "hk_ga4_";

/**
 * Push an event at most once per browser tab session, keyed by `dedupeKey`.
 *
 * `purchase` needs this: the confirmation route renders more than once for a
 * single order (the session-processing pass redirects to a clean URL, and the
 * shopper can reload or come back to a bookmarked confirmation), and each of
 * those is a separate mount of the same React tree. A second `purchase` with
 * the same `transaction_id` is a duplicated Google Ads conversion.
 *
 * `sessionStorage` is the right store: it survives the redirect and a reload,
 * and it does NOT survive into a new session, so a genuinely new order is
 * never suppressed. Access is wrapped because a browser with site data blocked
 * throws on the accessor itself — in that case the event still fires, which is
 * the safe failure direction (a missing conversion is worse than a duplicate).
 *
 * @returns whether the event was pushed.
 */
export function pushGa4EcommerceOnce(
  dedupeKey: string,
  event: Ga4EcommerceEvent,
): boolean {
  if (typeof window === "undefined") return false;
  const storageKey = `${DEDUPE_PREFIX}${dedupeKey}`;
  try {
    if (window.sessionStorage.getItem(storageKey) !== null) return false;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    /* storage unavailable — fall through and emit */
  }
  pushGa4Ecommerce(event);
  return true;
}

// ---------------------------------------------------------------------------
// Mapping — SDK shapes to `Ga4Item`
// ---------------------------------------------------------------------------

/**
 * A catalog product, as these mappers need it.
 *
 * Deliberately structural and all-optional beyond id/name: the PDP passes a
 * `ProductFieldsFragment` (brands, categories, sku, variations), a PLP card
 * passes a `ProductSummaryFieldsFragment` (none of those), and both must map
 * through one function.
 */
export interface Ga4ProductLike {
  id: string;
  name: string;
  sku?: string | null;
  price?: string | null;
  brands?: ReadonlyArray<{ name: string }> | null;
  categories?: ReadonlyArray<{ name: string }> | null;
}

/** Optional per-surface detail for {@link productToGa4Item}. */
export interface Ga4ProductItemOptions {
  /** Unit price, tax-inclusive. Defaults to the product's own `price`. */
  price?: number;
  quantity?: number;
  /** Human-readable variant, e.g. `"Carbon Black / 54"`. */
  variant?: string | null;
  /** Zero-based position, for list surfaces. */
  index?: number;
  itemListName?: string;
  /** Overrides `sku ?? id` — use when a VARIATION is the thing being reported. */
  itemId?: string;
}

/**
 * `item_id` prefers the SKU: it is the identifier a merchant recognises and the
 * one a Google Merchant Center feed is keyed on, so a Shopping/Performance Max
 * conversion can be attributed to the right product. The numeric id is the
 * fallback for a product with no SKU.
 */
export function productToGa4Item(
  product: Ga4ProductLike,
  options: Ga4ProductItemOptions = {},
): Ga4Item {
  const brand = product.brands?.[0]?.name;
  const category = product.categories?.[0]?.name;
  const variant = options.variant ?? undefined;
  const item: Ga4Item = {
    item_id: options.itemId ?? (product.sku?.trim() || String(product.id)),
    item_name: product.name,
    price: money(options.price ?? getFloatVal(product.price)),
    quantity: options.quantity ?? 1,
  };
  if (brand) item.item_brand = brand;
  if (variant) item.item_variant = variant;
  if (category) item.item_category = category;
  if (options.index !== undefined) item.index = options.index;
  if (options.itemListName) item.item_list_name = options.itemListName;
  return item;
}

/**
 * A cart or order line, as these mappers need it. The cart and order GraphQL
 * selections agree on every field read here, so one mapper serves both.
 */
export interface Ga4LineLike {
  id: string;
  name: string;
  quantity: number;
  sku?: string | null;
  prices?: { price?: string | null } | null;
  totals?: {
    lineSubtotal?: string | null;
    lineSubtotalTax?: string | null;
    lineTotal?: string | null;
    lineTotalTax?: string | null;
  } | null;
  variation?: ReadonlyArray<{ attribute: string; value: string }> | null;
}

/** `"Carbon Black / 54"` from a line's variation pairs; `undefined` when none. */
export function ga4LineVariant(
  variation:
    ReadonlyArray<{ attribute: string; value: string }> | null | undefined,
): string | undefined {
  const parts = (variation ?? [])
    .map((pair) => pair.value)
    .filter((value) => value.trim().length > 0);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

/**
 * Map one cart/order line.
 *
 * `price` is the line's tax-INCLUSIVE total divided by its own quantity, not
 * the line's advertised unit price: the two differ on a discounted line, and
 * `price × quantity` summed across items is what has to reconcile with the
 * event's `value`. `source` is the cart or order the line belongs to and is
 * required for the same reason `lineDisplayTotal` requires it — it selects the
 * tax convention, and guessing it double-counts on a hosted-checkout cart.
 */
export function lineToGa4Item(
  line: Ga4LineLike,
  source: DisplayTotalsSource | null,
  index?: number,
): Ga4Item {
  const quantity = line.quantity > 0 ? line.quantity : 1;
  const inclusiveLineTotal = lineDisplayTotal(
    line.totals,
    line.prices?.price,
    source,
  );
  const variant = ga4LineVariant(line.variation);
  const item: Ga4Item = {
    item_id: line.sku?.trim() || String(line.id),
    item_name: line.name,
    price: money(inclusiveLineTotal / quantity),
    quantity: line.quantity,
  };
  if (variant) item.item_variant = variant;
  if (index !== undefined) item.index = index;
  return item;
}

/** Sum of `price × quantity` across items — the `value` of a multi-item event. */
export function ga4ItemsValue(items: readonly Ga4Item[]): number {
  return money(
    items.reduce((total, item) => total + item.price * item.quantity, 0),
  );
}

// ---------------------------------------------------------------------------
// Event builders — pure, so the payload shape is testable without a DOM
// ---------------------------------------------------------------------------

export function buildViewItem(
  currency: string,
  item: Ga4Item,
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.VIEW_ITEM,
    ecommerce: {
      currency,
      value: money(item.price * item.quantity),
      items: [item],
    },
  };
}

export function buildAddToCart(
  currency: string,
  items: Ga4Item[],
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.ADD_TO_CART,
    ecommerce: { currency, value: ga4ItemsValue(items), items },
  };
}

export function buildRemoveFromCart(
  currency: string,
  items: Ga4Item[],
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.REMOVE_FROM_CART,
    ecommerce: { currency, value: ga4ItemsValue(items), items },
  };
}

export function buildAddToWishlist(
  currency: string,
  item: Ga4Item,
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.ADD_TO_WISHLIST,
    ecommerce: {
      currency,
      value: money(item.price * item.quantity),
      items: [item],
    },
  };
}

export function buildViewItemList(
  itemListName: string,
  items: Ga4Item[],
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.VIEW_ITEM_LIST,
    ecommerce: { item_list_name: itemListName, items },
  };
}

export function buildSelectItem(
  itemListName: string,
  item: Ga4Item,
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.SELECT_ITEM,
    ecommerce: { item_list_name: itemListName, items: [item] },
  };
}

export function buildViewCart(
  currency: string,
  items: Ga4Item[],
  value: number,
): Ga4EcommerceEvent {
  return {
    event: GA4_ECOMMERCE_EVENTS.VIEW_CART,
    ecommerce: { currency, value: money(value), items },
  };
}

export function buildBeginCheckout(
  currency: string,
  items: Ga4Item[],
  value: number,
  coupon?: string | undefined,
): Ga4EcommerceEvent {
  const ecommerce: Ga4Ecommerce = { currency, value: money(value), items };
  if (coupon) ecommerce.coupon = coupon;
  return { event: GA4_ECOMMERCE_EVENTS.BEGIN_CHECKOUT, ecommerce };
}

/** The fields a `purchase` carries. `transaction_id` is what Google Ads dedupes on. */
export interface Ga4PurchaseInput {
  transactionId: string;
  currency: string;
  value: number;
  tax: number;
  shipping: number;
  items: Ga4Item[];
  coupon?: string | undefined;
}

export function buildPurchase(input: Ga4PurchaseInput): Ga4EcommerceEvent {
  const ecommerce: Ga4Ecommerce = {
    transaction_id: input.transactionId,
    currency: input.currency,
    value: money(input.value),
    tax: money(input.tax),
    shipping: money(input.shipping),
    items: input.items,
  };
  if (input.coupon) ecommerce.coupon = input.coupon;
  return { event: GA4_ECOMMERCE_EVENTS.PURCHASE, ecommerce };
}

// ---------------------------------------------------------------------------
// Domain builders — one cart / one order in, one finished event out
// ---------------------------------------------------------------------------

/** A cart or order, as the two domain builders below read it. */
export interface Ga4CartLike extends DisplayTotalsSource {
  currency?: { code?: string | null } | null;
  items?: readonly Ga4LineLike[] | null;
  coupons?: ReadonlyArray<{ code?: string | null }> | null;
}

/** A placed order. `orderNumber` is what the shopper and the merchant both see. */
export interface Ga4OrderLike extends Ga4CartLike {
  orderNumber?: string | null;
  databaseId?: string | null;
  totals?:
    | (DisplayTotalsSource["totals"] & {
        totalPrice?: string | null;
        totalTax?: string | null;
      })
    | null;
}

function cartCurrency(source: Ga4CartLike, fallback: string): string {
  return source.currency?.code?.trim() || fallback;
}

/**
 * `begin_checkout` for a cart.
 *
 * `value` is the items subtotal, tax-inclusive — deliberately NOT the cart's
 * `totalPrice`. At the moment checkout opens no shipping rate has been chosen
 * (`totalPrice` excludes shipping until one is), so the subtotal is the only
 * figure that is both stable and equal to the bag total the shopper was just
 * looking at in the drawer. Shipping is reported once, on `purchase`.
 */
export function buildBeginCheckoutFromCart(
  cart: Ga4CartLike,
  fallbackCurrency: string,
): Ga4EcommerceEvent | null {
  const lines = cart.items ?? [];
  if (lines.length === 0) return null;
  const items = lines.map((line, index) => lineToGa4Item(line, cart, index));
  const coupon = cart.coupons?.[0]?.code?.trim();
  return buildBeginCheckout(
    cartCurrency(cart, fallbackCurrency),
    items,
    ga4ItemsValue(items),
    coupon || undefined,
  );
}

/** `view_cart` for a cart. Same items and value basis as `begin_checkout`. */
export function buildViewCartFromCart(
  cart: Ga4CartLike,
  fallbackCurrency: string,
): Ga4EcommerceEvent | null {
  const lines = cart.items ?? [];
  if (lines.length === 0) return null;
  const items = lines.map((line, index) => lineToGa4Item(line, cart, index));
  return buildViewCart(
    cartCurrency(cart, fallbackCurrency),
    items,
    ga4ItemsValue(items),
  );
}

/**
 * `purchase` for a placed order — the event that restores the Google Ads
 * conversion labels.
 *
 * `value` is the order's `totalPrice`: the tax-inclusive grand total, the same
 * figure the confirmation page prints on its Total row and the same one the
 * webhook amount guard reconciles against Stripe. `tax` and `shipping` are
 * reported alongside it, per GA4, so the `items` sum (a tax-inclusive
 * PRE-discount subtotal, matching the page's Subtotal row) does not have to
 * equal `value` — Subtotal − Discount + Shipping does, and that is the
 * arithmetic the page already shows.
 *
 * Returns `null` when the order carries no id to deduplicate on: a `purchase`
 * without `transaction_id` is worse than none, because Google Ads cannot
 * collapse repeats of it.
 */
export function buildPurchaseFromOrder(
  order: Ga4OrderLike,
  shippingTotal: number,
  fallbackCurrency: string,
): Ga4EcommerceEvent | null {
  const transactionId =
    order.orderNumber?.trim() ||
    (order.databaseId ? String(order.databaseId) : "");
  if (!transactionId) return null;
  const items = (order.items ?? []).map((line, index) =>
    lineToGa4Item(line, order, index),
  );
  const coupon = order.coupons?.[0]?.code?.trim();
  return buildPurchase({
    transactionId,
    currency: cartCurrency(order, fallbackCurrency),
    value: getFloatVal(order.totals?.totalPrice),
    tax: getFloatVal(order.totals?.totalTax),
    shipping: shippingTotal,
    items,
    ...(coupon ? { coupon } : {}),
  });
}

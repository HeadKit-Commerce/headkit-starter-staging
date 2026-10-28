/**
 * What the success page tells a shopper whose paid order lost items to stock
 * (checkout plan v3 §3, PR F).
 *
 * When a signed, captured finalize finds part of the bag gone, the WordPress
 * theme still creates the order, refunds only the short lines (cash to the
 * card, the rest to the gift card), and sends ONE customer email after the
 * refund exists. `Order.stockShortfall` is the record of that, and this module
 * turns it into the alert above the confirmation. It is null on every order
 * without a shortfall and on a store whose theme predates the fail-over, and
 * the page must then render exactly what it renders today.
 *
 * Pure: the page passes the record and the order currency; the copy comes back.
 */

import { decodeHtmlEntities, formatPrice, getFloatVal } from "@/lib/utils";

/** The `Order.stockShortfall` selection the starter reads. */
export interface StockShortfall {
  refundStatus: "PENDING" | "REFUNDED" | "FAILED";
  fullyRefunded: boolean;
  refundTotal: string;
  /** Shipping included in `refundTotal` (0 unless `fullyRefunded`). */
  shippingRefund?: string | null;
  paymentRefund: string;
  giftCardRefund: string;
  lines: {
    name: string;
    quantity: number;
    /** WooCommerce product or VARIATION id — see {@link splitOrderLines}. */
    productId?: string | null;
    /** Refund for the short units, tax inclusive. */
    refundAmount?: string | null;
  }[];
}

/** The alert's copy. */
export interface StockShortfallNotice {
  /** Every line was short: the order is refunded in full, nothing ships. */
  fullyRefunded: boolean;
  title: string;
  body: string;
}

/** "A, B and C" */
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** "the refund of A$17.27" phrased by where the refund is. */
function refundPhrase(
  status: StockShortfall["refundStatus"],
  amount: string,
  fully: boolean,
): string {
  const full = fully ? "the full " : "";
  switch (status) {
    case "REFUNDED":
      return `We've refunded ${full}${amount}`;
    case "FAILED":
      return `Our team will refund ${full}${amount}`;
    case "PENDING":
      return `We're refunding ${full}${amount}`;
  }
}

/**
 * The alert for an order's shortfall, or null when there is none — the
 * branch every order without a shortfall takes.
 */
export function stockShortfallNotice(
  shortfall: StockShortfall | null | undefined,
  currency: string,
): StockShortfallNotice | null {
  if (!shortfall || shortfall.lines.length === 0) {
    return null;
  }
  const money = (value: string): string =>
    formatPrice(getFloatVal(value), currency);
  const giftCard = getFloatVal(shortfall.giftCardRefund);
  const destination =
    giftCard > 0 && getFloatVal(shortfall.paymentRefund) > 0
      ? ` — ${money(shortfall.paymentRefund)} to your original payment method and ${money(shortfall.giftCardRefund)} to your gift card`
      : giftCard > 0
        ? " to your gift card"
        : " to your original payment method";
  const refund = `${refundPhrase(shortfall.refundStatus, money(shortfall.refundTotal), shortfall.fullyRefunded)}${shortfall.fullyRefunded ? ", including shipping," : ""}${destination}.`;

  if (shortfall.fullyRefunded) {
    return {
      fullyRefunded: true,
      title: "Sorry — your items sold out",
      body: `The items in this order sold out while your payment was processing. ${refund}`,
    };
  }
  const names = joinNames(
    shortfall.lines.map((l) =>
      l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name,
    ),
  );
  return {
    fullyRefunded: false,
    title: "Sorry — part of your order sold out",
    body: `${names} sold out while your payment was processing. ${refund} The rest of your order is confirmed below.`,
  };
}

/** One order line as {@link splitOrderLines} reads it. */
export interface ShortfallOrderLine {
  id: string;
  name: string;
  quantity: number;
  /** The line's shopper-facing total, tax inclusive (`lineDisplayTotal`). */
  lineTotal: number;
}

/** How much of one order line was kept and how much was refunded. */
export interface ShortfallLineSplit {
  keptQuantity: number;
  shortQuantity: number;
  keptTotal: number;
  refundedTotal: number;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function sameName(a: string, b: string): boolean {
  return (
    decodeHtmlEntities(a).trim().toLowerCase() ===
    decodeHtmlEntities(b).trim().toLowerCase()
  );
}

/**
 * The kept/refunded split of every order line, index-aligned with `lines`.
 *
 * MATCHING A SHORTFALL LINE TO AN ORDER LINE IS BY NAME. The record's
 * `productId` is `$item->get_product()->get_id()` — the VARIATION id for a
 * variable product — while an order line's `id` is wc/v3's `product_id`, the
 * PARENT. Both names, by contrast, are WooCommerce's own `$item->get_name()`,
 * so name is the key and the id is only a fallback for a simple product.
 *
 * With no shortfall every line is kept whole. A fully refunded order marks
 * every line short whatever matching finds, because that is what
 * `fullyRefunded` means. Otherwise each shortfall line claims the first
 * unclaimed order line with the same name (then the same id); a line short
 * by fewer units than ordered splits into a kept part and a refunded part.
 * The refunded amount is the record's own `refundAmount` (what the theme
 * actually refunded), falling back to the line's per-unit share.
 */
export function splitOrderLines(
  lines: readonly ShortfallOrderLine[],
  shortfall: StockShortfall | null | undefined,
): ShortfallLineSplit[] {
  const whole = (line: ShortfallOrderLine): ShortfallLineSplit => ({
    keptQuantity: line.quantity,
    shortQuantity: 0,
    keptTotal: cents(line.lineTotal),
    refundedTotal: 0,
  });
  const splits = lines.map(whole);
  if (!shortfall || shortfall.lines.length === 0) return splits;

  if (shortfall.fullyRefunded) {
    return lines.map((line) => ({
      keptQuantity: 0,
      shortQuantity: line.quantity,
      keptTotal: 0,
      refundedTotal: cents(line.lineTotal),
    }));
  }

  const claimed = new Set<number>();
  for (const short of shortfall.lines) {
    let index = lines.findIndex(
      (line, i) => !claimed.has(i) && sameName(line.name, short.name),
    );
    if (index === -1 && short.productId) {
      index = lines.findIndex(
        (line, i) => !claimed.has(i) && line.id === String(short.productId),
      );
    }
    if (index === -1) continue;
    claimed.add(index);
    const line = lines[index]!;
    const ordered = line.quantity > 0 ? line.quantity : 1;
    const shortQuantity = Math.min(Math.max(short.quantity, 0), line.quantity);
    const recorded = getFloatVal(short.refundAmount);
    const refundedTotal = cents(
      Math.min(
        recorded > 0 ? recorded : (line.lineTotal / ordered) * shortQuantity,
        line.lineTotal,
      ),
    );
    splits[index] = {
      keptQuantity: line.quantity - shortQuantity,
      shortQuantity,
      keptTotal: cents(line.lineTotal - refundedTotal),
      refundedTotal,
    };
  }
  return splits;
}

/**
 * The tax inside what the shopper was finally charged on a shortfall order.
 *
 * `order.totals.totalTax` is the tax on the ORIGINAL total — WooCommerce
 * records the refund's tax on the refund, beside the order, the same way it
 * keeps the original grand total. Neither the order nor the shortfall record
 * exposes the refund's own tax, so it is scaled by the share of the total
 * that was kept: A$4.71 × 31.95 / 51.85 = A$2.90, which is WooCommerce's own
 * figure (A$4.71 less the refund's A$1.81 tax). Tax is a fixed share of every
 * line and of shipping, so the scaling is exact there.
 *
 * The GA4 `purchase` reports this number. A fully refunded order answers 0;
 * an order without a shortfall answers its own tax unchanged.
 */
export function shortfallNetTax(
  shortfall: StockShortfall | null | undefined,
  orderTotal: number,
  orderTax: number,
): number {
  if (!shortfall || shortfall.lines.length === 0) return orderTax;
  if (orderTotal <= 0) return 0;
  const refunded = Math.min(getFloatVal(shortfall.refundTotal), orderTotal);
  const charged = Math.max(orderTotal - refunded, 0);
  return cents((orderTax * charged) / orderTotal);
}

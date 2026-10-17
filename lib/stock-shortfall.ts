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

import { formatPrice, getFloatVal } from "@/lib/utils";

/** The `Order.stockShortfall` selection the starter reads. */
export interface StockShortfall {
  refundStatus: "PENDING" | "REFUNDED" | "FAILED";
  fullyRefunded: boolean;
  refundTotal: string;
  paymentRefund: string;
  giftCardRefund: string;
  lines: { name: string; quantity: number }[];
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

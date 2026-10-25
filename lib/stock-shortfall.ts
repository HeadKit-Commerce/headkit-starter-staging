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
 * A HELD payment (hold-first) never reaches that refund: when only some lines
 * are short at finalize, the theme drops them before capture and commerce
 * captures the reduced total, so the record arrives as `NOT_CHARGED` — those
 * items were never charged, and there is nothing to refund. For Afterpay the
 * first instalment was taken at authorization on the full amount, so the copy
 * says the instalments follow the reduced total instead of claiming nothing
 * was ever taken.
 *
 * Pure: the page passes the record and the order currency; the copy comes back.
 */

import { formatPrice, getFloatVal } from "@/lib/utils";

/** The `Order.stockShortfall` selection the starter reads. */
export interface StockShortfall {
  refundStatus: "PENDING" | "REFUNDED" | "FAILED" | "NOT_CHARGED";
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
  status: Exclude<StockShortfall["refundStatus"], "NOT_CHARGED">,
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
  paymentMethodType?: string | null,
): StockShortfallNotice | null {
  if (!shortfall || shortfall.lines.length === 0) {
    return null;
  }
  if (shortfall.refundStatus === "NOT_CHARGED") {
    return notChargedNotice(shortfall, paymentMethodType);
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
  const names = lineNames(shortfall);
  return {
    fullyRefunded: false,
    title: "Sorry — part of your order sold out",
    body: `${names} sold out while your payment was processing. ${refund} The rest of your order is confirmed below.`,
  };
}

/** "2 × Gloves and Helmet" */
function lineNames(shortfall: StockShortfall): string {
  return joinNames(
    shortfall.lines.map((l) =>
      l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name,
    ),
  );
}

/**
 * Lines dropped from a held payment before capture: only the in-stock items
 * were charged. Afterpay and Klarna get a sentence about their plan, because
 * Afterpay took the first instalment at authorization on the full amount.
 */
function notChargedNotice(
  shortfall: StockShortfall,
  paymentMethodType: string | null | undefined,
): StockShortfallNotice {
  const units = shortfall.lines.reduce((n, l) => n + l.quantity, 0);
  const them = units === 1 ? "it" : "them";
  const plan =
    paymentMethodType === "afterpay_clearpay"
      ? " Your Afterpay instalments are for the reduced total; Afterpay returns anything it already took for the sold-out items."
      : paymentMethodType === "klarna"
        ? " Your Klarna payments are for the reduced total."
        : "";
  return {
    fullyRefunded: false,
    title: "Sorry — part of your order sold out",
    body: `${lineNames(shortfall)} sold out before your payment was taken, so you were not charged for ${them}.${plan} The rest of your order is confirmed below.`,
  };
}

"use client";

import {
  VisaIcon,
  MastercardIcon,
  AmexIcon,
  DiscoverIcon,
  ApplePayIcon,
  GooglePayIcon,
  LinkPayIcon,
  PayPalIcon,
  CreditCardIcon,
  AfterpayIcon,
  KlarnaIcon,
  ZipIcon,
} from "@/components/icon";
import type { IconType } from "react-icons";

interface PaymentMethodDisplayProps {
  /** Card brand from Stripe (visa, mastercard, amex, discover, etc.) — preferred when available */
  cardBrand?: string | null | undefined;
  /** Last 4 digits of card */
  cardLast4?: string | null | undefined;
  /** Payment method type from Stripe (card, paypal, etc.) */
  paymentMethod?: string | null | undefined;
  /** Express wallet from Stripe: apple_pay, google_pay, or link (ENG-788) */
  walletType?: string | null | undefined;
  /** Formatted label from WooCommerce, e.g. "Mastercard ending 4444", "PayPal" */
  paymentMethodTitle?: string | null | undefined;
  /** Fallback when no payment info available, e.g. order.status */
  fallback?: string;
}

const CARD_BRAND_ICON_MAP: Record<string, IconType> = {
  visa: VisaIcon,
  mastercard: MastercardIcon,
  amex: AmexIcon,
  american_express: AmexIcon,
  discover: DiscoverIcon,
  diners: CreditCardIcon,
  diners_club: CreditCardIcon,
  jcb: CreditCardIcon,
  unionpay: CreditCardIcon,
};

/** Display labels for the allowlisted express wallets (ENG-788). */
const WALLET_LABELS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  link: "Link",
};

/**
 * Friendly labels for Stripe's raw BNPL `payment_method_types` values, which
 * reach this component either as the session's `paymentMethod` or verbatim as
 * WooCommerce's `paymentMethodTitle` (e.g. "Afterpay_clearpay").
 */
const BNPL_LABELS: Record<string, string> = {
  afterpay_clearpay: "Afterpay",
  klarna: "Klarna",
  zip: "Zip",
};

const BNPL_ICONS: Record<string, IconType> = {
  afterpay_clearpay: AfterpayIcon,
  klarna: KlarnaIcon,
  zip: ZipIcon,
};

/** The BNPL key a raw method id or title names, or `undefined` for anything else. */
function bnplKeyOf(raw: string | null | undefined): string | undefined {
  const key = raw
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return key && BNPL_LABELS[key] ? key : undefined;
}

/** Human display name for a Stripe card brand code, e.g. "visa" → "Visa". */
const CARD_BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  american_express: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  diners_club: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function formatCardBrand(brand: string): string {
  const key = brand.toLowerCase();
  return CARD_BRAND_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Detect a card brand at the start of a (lowercased) title fragment. */
function detectCardBrand(lower: string): string | null {
  if (lower.startsWith("visa")) return "visa";
  if (lower.startsWith("mastercard")) return "mastercard";
  if (lower.startsWith("amex") || lower.startsWith("american express"))
    return "amex";
  if (lower.startsWith("discover")) return "discover";
  return null;
}

/**
 * Wallet title prefixes, matched case-insensitively at the start of a
 * WooCommerce paymentMethodTitle. Covers both the legacy format
 * ("Apple Pay - Visa ending 1234") and the ENG-788 theme format
 * ("Google Pay — Visa •••• 4242 (Stripe)" / degraded "Google Pay (Stripe)").
 */
const WALLET_TITLE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["apple pay", "apple_pay"],
  ["google pay", "google_pay"],
  ["link", "link"],
];

/** Extract wallet, brand and last4 from WooCommerce paymentMethodTitle format */
function parsePaymentMethodTitle(title: string): {
  brand: string;
  last4: string;
  walletType?: string;
} | null {
  const t = title.trim();
  if (!t) return null;

  // "PayPal" — no card details
  if (t.toLowerCase() === "paypal") return null;

  // last4 from either the legacy "ending 1234" or the "•••• 4242" format
  const endingMatch = t.match(/ending\s+(\d{4})\b/i);
  const dotsMatch = t.match(/••••\s*(\d{4})\b/);
  const last4: string = endingMatch?.[1] ?? dotsMatch?.[1] ?? "";

  let lower = t.toLowerCase();

  // Wallet prefix (ENG-788): strip it and keep parsing the card remainder.
  let walletType: string | undefined;
  for (const [prefix, type] of WALLET_TITLE_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix} `)) {
      walletType = type;
      lower = lower.slice(prefix.length).replace(/^[\s—-]+/, "");
      break;
    }
  }

  const cardBrand = detectCardBrand(lower);

  if (walletType) {
    // brand falls back to the wallet type itself when no card brand is present
    // (degraded "Google Pay (Stripe)" titles).
    return { brand: cardBrand ?? walletType, last4, walletType };
  }
  if (cardBrand) return { brand: cardBrand, last4 };

  return last4 ? { brand: "unknown", last4 } : null;
}

function getPaymentIcon(brand: string): IconType {
  if (brand === "apple_pay") return ApplePayIcon;
  if (brand === "google_pay") return GooglePayIcon;
  if (brand === "link") return LinkPayIcon;
  const icon = CARD_BRAND_ICON_MAP[brand];
  return icon ?? CreditCardIcon;
}

export function PaymentMethodDisplay({
  cardBrand,
  cardLast4,
  paymentMethod,
  walletType,
  paymentMethodTitle,
  fallback = "Paid",
}: PaymentMethodDisplayProps) {
  // Allowlisted express wallet (ENG-788); anything else is treated as absent.
  const walletKey =
    walletType && WALLET_LABELS[walletType.toLowerCase()]
      ? walletType.toLowerCase()
      : undefined;

  // Prefer structured session data (cardBrand + cardLast4)
  if (cardBrand && cardLast4 && paymentMethod !== "paypal") {
    const Icon = getPaymentIcon(walletKey ?? cardBrand.toLowerCase());
    return (
      <span className="inline-flex items-center gap-2">
        <Icon aria-hidden className="h-5 w-5 shrink-0" />
        <span>
          {walletKey
            ? `${WALLET_LABELS[walletKey]} — ${formatCardBrand(cardBrand)} •••• ${cardLast4}`
            : `End with ${cardLast4}`}
        </span>
      </span>
    );
  }

  // PayPal from session
  if (paymentMethod === "paypal") {
    return (
      <span className="inline-flex items-center gap-2">
        <PayPalIcon aria-hidden className="h-5 w-5 shrink-0" />
        <span>PayPal</span>
      </span>
    );
  }

  // BNPL (Afterpay / Klarna / Zip) from the session's method id, or from a
  // title WooCommerce stored as that same raw id.
  const bnplKey = bnplKeyOf(paymentMethod) ?? bnplKeyOf(paymentMethodTitle);
  if (bnplKey) {
    const Icon = BNPL_ICONS[bnplKey] ?? CreditCardIcon;
    return (
      <span className="inline-flex items-center gap-2">
        <Icon aria-hidden className="h-5 w-5 shrink-0" />
        <span>{BNPL_LABELS[bnplKey]}</span>
      </span>
    );
  }

  // Degraded wallet payment (ENG-788): walletType present without card details.
  if (walletKey) {
    const Icon = getPaymentIcon(walletKey);
    return (
      <span className="inline-flex items-center gap-2">
        <Icon aria-hidden className="h-5 w-5 shrink-0" />
        <span>{WALLET_LABELS[walletKey]}</span>
      </span>
    );
  }

  // Parse paymentMethodTitle from WooCommerce
  if (paymentMethodTitle) {
    const parsed = parsePaymentMethodTitle(paymentMethodTitle);
    if (parsed) {
      if (parsed.walletType) {
        const Icon = getPaymentIcon(parsed.walletType);
        const walletLabel =
          WALLET_LABELS[parsed.walletType] ?? parsed.walletType;
        const hasCardBrand = parsed.brand !== parsed.walletType;
        return (
          <span className="inline-flex items-center gap-2">
            <Icon aria-hidden className="h-5 w-5 shrink-0" />
            <span>
              {hasCardBrand && parsed.last4
                ? `${walletLabel} — ${formatCardBrand(parsed.brand)} •••• ${parsed.last4}`
                : parsed.last4
                  ? `${walletLabel} •••• ${parsed.last4}`
                  : walletLabel}
            </span>
          </span>
        );
      }
      if (parsed.brand === "unknown") {
        return (
          <span className="inline-flex items-center gap-2">
            <CreditCardIcon aria-hidden className="h-5 w-5 shrink-0" />
            <span>End with {parsed.last4}</span>
          </span>
        );
      }
      const Icon = getPaymentIcon(parsed.brand);
      return (
        <span className="inline-flex items-center gap-2">
          <Icon aria-hidden className="h-5 w-5 shrink-0" />
          <span>End with {parsed.last4}</span>
        </span>
      );
    }
    // PayPal from title
    if (paymentMethodTitle.trim().toLowerCase() === "paypal") {
      return (
        <span className="inline-flex items-center gap-2">
          <PayPalIcon aria-hidden className="h-5 w-5 shrink-0" />
          <span>PayPal</span>
        </span>
      );
    }
    // Unparseable — show raw title
    return <span className="capitalize">{paymentMethodTitle}</span>;
  }

  return <span className="capitalize">{fallback}</span>;
}

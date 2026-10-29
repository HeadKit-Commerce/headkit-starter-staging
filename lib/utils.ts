import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { rewriteShopifyFileVideos } from "@/lib/shopify-file-video";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Decode HTML entities in provider/CMS-sourced titles and labels.
 * WooCommerce and Yoast often return `&amp;`, `&#8211;`, etc. that must not
 * appear literally in the UI or in `<title>` / OG tags.
 */
export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201c",
    rdquo: "\u201d",
  };

  return text
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const decoded = named[name.toLowerCase()];
      return decoded !== undefined ? decoded : match;
    })
    .replace(/&#0*(\d+);/g, (match, digits: string) => {
      const code = Number(digits);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-fA-F]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(code);
    });
}

/** Block-level islands that must stay intact (lists, tables, headings, …). */
const WOO_BLOCK_ISLAND_PATTERN =
  /<(ul|ol|table|blockquote|pre|div|section|article|figure|h[1-6])\b[\s\S]*?<\/\1\s*>|<(hr)\b[^>]*\/?>/gi;

const WOO_BLOCK_PLACEHOLDER = /%%HK_BLOCK_(\d+)%%/;

/**
 * Wrap plain (or inline-HTML) text runs as paragraphs, converting single
 * newlines to `<br />`. Block placeholders are left bare for later restore.
 */
function wrapWooPlainParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      if (WOO_BLOCK_PLACEHOLDER.test(paragraph)) {
        return paragraph;
      }
      return `<p>${paragraph.replace(/\n/g, "<br />")}</p>`;
    })
    .join("");
}

/**
 * Formats WooCommerce product description HTML for storefront rendering.
 *
 * Paragraph-structured HTML (`<p>…</p>`) from the WordPress editor is returned
 * as-is. Plain text and inline markup (`<strong>`, `<em>`, `<a>`, …) preserve
 * blank-line paragraph breaks and single newlines as `<br />`. Mixed content
 * (e.g. intro text + a list, or bold + line breaks without `<p>` wrappers)
 * formats plain segments while leaving block islands intact — so adding bold
 * or a list no longer collapses surrounding line breaks.
 */
export function formatWooRichText(html: string | null | undefined): string {
  if (html == null) {
    return "";
  }

  const trimmed = html.trim();
  if (trimmed === "") {
    return "";
  }

  const normalized = rewriteShopifyFileVideos(
    trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
  );

  // Already paragraph-structured — trust the editor HTML.
  if (/<p\b/i.test(normalized)) {
    return normalized;
  }

  const blocks: string[] = [];
  const withoutBlocks = normalized.replace(
    WOO_BLOCK_ISLAND_PATTERN,
    (match) => {
      const index = blocks.length;
      blocks.push(match);
      return `\n\n%%HK_BLOCK_${index}%%\n\n`;
    },
  );

  const formatted = wrapWooPlainParagraphs(
    withoutBlocks.replace(/<br\s*\/?>/gi, "\n"),
  );

  if (blocks.length === 0) {
    return formatted;
  }

  return formatted.replace(/%%HK_BLOCK_(\d+)%%/g, (_, index: string) => {
    return blocks[Number(index)] ?? "";
  });
}

export function addAlphaToHex(hex: string, alpha: number): string {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Strip any non-numeric/decimal characters and return as float. */
export function getFloatVal(str: string | null | undefined): number {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.]/g, "");
  return parseFloat(cleaned) || 0;
}

/**
 * Store display currency for surfaces with NO cart/order context (F6).
 *
 * The commerce graph only exposes `Currency` on Cart and Order — products and
 * store settings carry no currency — so catalog components (ProductPrice etc.)
 * have no runtime source and must fall back to a deploy-level constant.
 * Configured per store via `NEXT_PUBLIC_STORE_CURRENCY` (ISO 4217); defaults
 * to AUD, matching the platform's other defaults (product-json-ld,
 * checkout-page-content) — the old "USD" default silently mislabelled catalog
 * prices for every non-USD store while the cart showed the real currency.
 *
 * NOTE: read via `process.env` directly (not `lib/env.ts`) because this module
 * is imported by nearly every component AND by node-env unit tests, where the
 * zod env parse would throw. `NEXT_PUBLIC_*` is statically inlined client-side.
 */
export function getStoreCurrency(): string {
  return process.env.NEXT_PUBLIC_STORE_CURRENCY || "AUD";
}

/**
 * The locale a currency is printed in when the caller names none, so a store
 * sees its own symbol rather than `en-US`'s disambiguated one: under `en-US`
 * AUD prints `A$750.00`, NZD `NZ$750.00`, CAD `CA$750.00` and SGD `SGD 750.00`,
 * while a shopper in those countries expects a plain `$750.00`. GBP is listed
 * for completeness — `en-GB` and `en-US` agree on `£`. Anything not listed
 * keeps `en-US`, which is also what USD uses, so those outputs do not move.
 */
const PRICE_LOCALE_BY_CURRENCY: Readonly<Record<string, string>> = {
  AUD: "en-AU",
  CAD: "en-CA",
  GBP: "en-GB",
  NZD: "en-NZ",
  SGD: "en-SG",
  USD: "en-US",
};

/** The locale {@link formatPrice} uses for `currency` when given none. */
export function defaultPriceLocale(currency: string): string {
  return PRICE_LOCALE_BY_CURRENCY[currency.toUpperCase()] ?? "en-US";
}

/**
 * Format a numeric price with currency symbol using Intl.NumberFormat.
 * Pass the cart/order `currency.code` when one exists; omitting `currency`
 * falls back to the store display currency ({@link getStoreCurrency}).
 * Omitting `locale` takes {@link defaultPriceLocale}; an explicit one wins.
 */
export function formatPrice(
  value: number,
  currency?: string,
  locale?: string,
): string {
  const code = currency || getStoreCurrency();
  return new Intl.NumberFormat(locale ?? defaultPriceLocale(code), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

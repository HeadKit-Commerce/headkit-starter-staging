import { getFloatVal } from "@/lib/utils";

/**
 * Pure display logic for catalog/PDP price rendering (F3).
 *
 * The strikethrough "regular" price must only render when there is a REAL
 * discount — i.e. a known regular price strictly greater than the current
 * price. Variable products often surface only a sale-derived price with
 * `regularPrice: ""` while `onSale` is true; naively falling back to the
 * current price produced fake "~~$24.00~~ $24.00" displays.
 */

export interface PriceDisplayInput {
  /** Current price; may be a range like "25 - 36". */
  price: string;
  /** Regular (pre-discount) price, if known. Empty/undefined = unknown. */
  regularPrice?: string | undefined;
  /** Provider on-sale flag. Necessary but NOT sufficient for a strikethrough. */
  onSale: boolean;
}

export interface PriceDisplay {
  /** Current price lower bound (or the single price). */
  min: number;
  /** Current price upper bound when a range, else null. */
  max: number | null;
  /**
   * Regular price to render struck-through, or null when no real discount
   * should be shown (unknown regular, regular <= current, ranges, not on sale).
   */
  struck: number | null;
}

/**
 * First non-empty price candidate, else "".
 *
 * The gateway serialises an absent sale price as an EMPTY STRING, not null —
 * so `a ?? b` chains keep `""` and downstream parsing renders A$0.00 (the
 * exact PDP regression E2E P1-14 catches on simple non-sale products). Use
 * this wherever a price is picked from fallbacks.
 */
export function pickFirstPrice(
  ...candidates: Array<string | null | undefined>
): string {
  for (const c of candidates) {
    if (c !== null && c !== undefined && c.trim() !== "") return c;
  }
  return "";
}

/** Resolve what the price row should display, and whether a strikethrough regular price is warranted. */
export function getPriceDisplay({
  price,
  regularPrice,
  onSale,
}: PriceDisplayInput): PriceDisplay {
  const [minRaw, maxRaw] = (price ?? "").split("-");
  const min = getFloatVal(minRaw?.trim() ?? "");
  const hasRange = maxRaw !== undefined && maxRaw.trim() !== "";
  const max = hasRange ? getFloatVal(maxRaw.trim()) : null;

  const regular = getFloatVal(regularPrice ?? "");

  // Strikethrough only for a genuine discount on a single price point:
  // on sale, regular price known, and strictly greater than the current price.
  const struck = onSale && !hasRange && regular > min ? regular : null;

  return { min, max, struck };
}

/**
 * Card price for variable products: min–max across variation prices.
 * Includes $0 (free) variations — filtering `p > 0` dropped them and hid
 * ranges like "$0.00 – $2.00".
 *
 * It also resolves the card's REGULAR price, and that half is load-bearing.
 * A variable product's PARENT carries `regularPrice: ""` on the WooCommerce
 * provider even while it is on sale (measured on every one of the 24 products
 * on Bike Society's `/sale` page 1, 2026-10-12) — the regular lives on the
 * VARIATIONS. This function returned `""` for every variable product, so
 * `getPriceDisplay` computed `regular = 0` and no card could ever strike a
 * was-price, while the PDP buy box and the cart line (which read their own
 * paths) were correct.
 *
 * The card claims the regular belonging to the MIN-priced variation: the card
 * prices itself from that variation, so its regular is the honest counterpart.
 * Several variations tied at the min take the LARGEST of their regulars — the
 * discounted one rather than an undiscounted sibling. When no variation at the
 * min carries a regular the regular stays unknown and no strike renders.
 *
 * That subsumes "the common regular when every variation shares one", which is
 * why there is no second rule: a min-priced variation always exists, so a
 * regular shared by every variation is by definition on one of them.
 *
 * A RANGE collapses to its min-price pair when — and only when — the parent is
 * on sale and that regular is a genuine discount. `getPriceDisplay` refuses a
 * strike alongside a range (`!hasRange`), and a card shows one pair rather
 * than a range-to-range strike. Without a real discount the range is left
 * intact.
 *
 * This never invents a regular: the `regular > current` guard in
 * `getPriceDisplay` still owns whether a strike renders, so a product whose
 * regular equals its price cannot produce a fake "~~$24.00~~ $24.00" row.
 */
export function getVariationCardPrice(input: {
  variations: Array<{
    price?: string | null | undefined;
    regularPrice?: string | null | undefined;
  }>;
  fallbackPrice?: string | null | undefined;
  fallbackRegularPrice?: string | null | undefined;
  /**
   * Parent on-sale flag. Only an on-sale card may collapse a price range to
   * its min-price pair; without it a non-sale range would lose its upper
   * bound for a strike `getPriceDisplay` would refuse anyway.
   */
  onSale?: boolean;
}): { price: string; regularPrice: string } {
  const { variations, fallbackPrice, fallbackRegularPrice, onSale } = input;
  if (variations.length === 0) {
    return {
      price: pickFirstPrice(fallbackPrice) || "0",
      regularPrice: pickFirstPrice(fallbackRegularPrice) || "0",
    };
  }

  const entries = variations
    .map((v) => ({
      price: parseVariationPrice(v.price),
      regular: parseVariationPrice(v.regularPrice),
    }))
    .filter(
      (e): e is { price: number; regular: number | null } => e.price !== null,
    );

  if (entries.length === 0) {
    return {
      price: pickFirstPrice(fallbackPrice) || "0",
      regularPrice: pickFirstPrice(fallbackRegularPrice) || "0",
    };
  }

  const minPrice = Math.min(...entries.map((e) => e.price));
  const maxPrice = Math.max(...entries.map((e) => e.price));
  const regular = cardRegularPrice(entries, minPrice);
  const regularOut = regular === null ? "" : String(regular);

  if (minPrice === maxPrice) {
    return { price: String(minPrice), regularPrice: regularOut };
  }

  const discounted = onSale === true && regular !== null && regular > minPrice;
  if (discounted) {
    return { price: String(minPrice), regularPrice: String(regular) };
  }
  return { price: `${minPrice} - ${maxPrice}`, regularPrice: "" };
}

/** A variation price as a non-negative finite number, else null. */
function parseVariationPrice(raw: string | null | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** See `getVariationCardPrice`'s docblock. */
function cardRegularPrice(
  entries: Array<{ price: number; regular: number | null }>,
  minPrice: number,
): number | null {
  const atMin = entries
    .filter((e) => e.price === minPrice)
    .map((e) => e.regular)
    .filter((r): r is number => r !== null);
  return atMin.length > 0 ? Math.max(...atMin) : null;
}

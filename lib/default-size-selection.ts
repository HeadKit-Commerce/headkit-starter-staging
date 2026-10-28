/**
 * Which size the PDP lands on.
 *
 * The PDP used to pick the FIRST variation for the colour and then overlay the
 * size remembered in `localStorage`, so a product whose smallest size is sold
 * out landed the shopper on an out-of-stock size. This module is the rule that
 * replaced it — the first IN-STOCK option, falling back to any existing one —
 * as one pure function the PDP calls on load and on every colour change:
 *
 * 1. a PREFERRED size (the remembered one, or the size selected before the
 *    colour changed) wins when its variation for the colour is in stock;
 * 2. otherwise the first size, in option order, whose variation is in stock;
 * 3. otherwise, when nothing is in stock, the preferred size if it exists for
 *    the colour (a sold-out colour behaves as it did before this rule: the
 *    remembered size stays selected);
 * 4. otherwise the first size that exists for the colour at all.
 *
 * Attributes other than colour and size cascade from the chosen variation.
 */

import { isVariationOutOfStock } from "@/lib/variation-stock";

export interface SelectableVariation {
  attributes: ReadonlyArray<{ key: string; value: string }>;
  stockStatus?: string | null | undefined;
  stockQuantity?: number | null | undefined;
}

export interface DefaultSizeInput {
  variations: ReadonlyArray<SelectableVariation>;
  /** Attribute slug of the colour swatch, if the product has one. */
  colorKey?: string | undefined;
  /** Selected colour slug, if any. */
  colour?: string | undefined;
  /** Attribute slug of the size attribute, if the product has one. */
  sizeKey?: string | undefined;
  /** Size option slugs in display order (the attribute's `fullOptions`). */
  sizeOptions: ReadonlyArray<string>;
  /** Remembered / previously selected size, if any. */
  preferredSize?: string | undefined;
}

function attr(v: SelectableVariation, key: string): string | undefined {
  return v.attributes.find((a) => a.key === key)?.value;
}

function forColour(
  variations: ReadonlyArray<SelectableVariation>,
  colorKey: string | undefined,
  colour: string | undefined,
): SelectableVariation[] {
  if (!colorKey || !colour) return [...variations];
  return variations.filter((v) => attr(v, colorKey) === colour);
}

/**
 * The variation the PDP should select for a colour, or `null` when no
 * variation exists for it.
 */
export function pickDefaultVariation({
  variations,
  colorKey,
  colour,
  sizeKey,
  sizeOptions,
  preferredSize,
}: DefaultSizeInput): SelectableVariation | null {
  const candidates = forColour(variations, colorKey, colour);
  if (candidates.length === 0) return null;

  // No size axis: first in-stock candidate, else the first candidate.
  if (!sizeKey) {
    return candidates.find((v) => !isVariationOutOfStock(v)) ?? candidates[0]!;
  }

  const bySize = (size: string): SelectableVariation | undefined =>
    candidates.find((v) => attr(v, sizeKey) === size);
  const inStockBySize = (size: string): SelectableVariation | undefined => {
    const v = bySize(size);
    return v && !isVariationOutOfStock(v) ? v : undefined;
  };

  // Sizes in display order; any size the variations carry that the option
  // list does not is appended so a stale option list cannot hide stock.
  const order = [...sizeOptions];
  for (const v of candidates) {
    const s = attr(v, sizeKey);
    if (s && !order.includes(s)) order.push(s);
  }

  if (preferredSize) {
    const preferred = inStockBySize(preferredSize);
    if (preferred) return preferred;
  }
  for (const size of order) {
    const v = inStockBySize(size);
    if (v) return v;
  }
  if (preferredSize) {
    const v = bySize(preferredSize);
    if (v) return v;
  }
  for (const size of order) {
    const v = bySize(size);
    if (v) return v;
  }
  return candidates[0]!;
}

/**
 * Selected-attribute map for the PDP: the colour plus every attribute of the
 * variation `pickDefaultVariation` chose. When no variation exists for the
 * colour the map carries only the colour, which is what the platform did.
 */
export function defaultAttributesForColour(
  input: DefaultSizeInput,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (input.colorKey && input.colour) attrs[input.colorKey] = input.colour;
  const chosen = pickDefaultVariation(input);
  if (chosen) {
    for (const a of chosen.attributes) {
      if (!attrs[a.key]) attrs[a.key] = a.value;
    }
  }
  return attrs;
}

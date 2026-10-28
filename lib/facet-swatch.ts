/**
 * Does ONE facet option carry a colour? The rule the filter's swatch dot reads.
 *
 * WHY THIS IS A MODULE AND NOT A FALSY CHECK AT THE CALL SITE. The gateway's
 * `ProductFilterOption.swatchColor` / `swatchColor2` are non-null `String!`, so
 * "no swatch" arrives as the EMPTY STRING and never as `null` or an absent key.
 * Three different things answer the empty string, and all three must read as
 * "draw no dot":
 *
 *  - a store whose HeadKit theme predates the change that populates the fields
 *    (theme < 0.4.73) — which is "no colour", not an edge case, for every store
 *    that has not pushed the theme;
 *  - a non-swatch attribute (size, material) on a store that does populate
 *    them, because a size has no colour to report;
 *  - the brand facet, which the same type covers and which never has one.
 *
 * So the empty string is the COMMON case, and a dot drawn for it is an empty
 * grey circle on every option of every facet. Making this a named rule with its
 * own test is what keeps it from being re-introduced by someone "tidying" a
 * `?? undefined` into the component.
 *
 * WHAT IT DOES NOT DO: validate that the string is a colour. Nothing in this
 * repo does — `SwatchDot` and the PDP's `VariantSwatch` both drop the value
 * straight into an inline `style`, and they read the SAME theme-authored field.
 * Gating harder here than the card gates would mean a store whose theme sends a
 * form this module rejects shows a dot on its product cards and no dot in its
 * filter, which is a worse answer than trusting the field consistently.
 * Trim-and-test-for-empty is the whole rule.
 */

/** The two colour fields, as the facet payload carries them. */
export interface FacetSwatchSource {
  swatchColor?: string | null;
  swatchColor2?: string | null;
}

/** A resolved swatch. `color2` present means a two-tone dot. */
export interface FacetSwatch {
  color1: string;
  color2?: string;
}

/**
 * The option's colour(s), or null when it has none.
 *
 * `color2` WITHOUT `color1` is null, not a one-sided gradient: `SwatchDot` only
 * reads `color2` when `color1` is set, so a second colour alone has nothing to
 * paint against and the honest answer is "no swatch".
 */
export function facetSwatch(option: FacetSwatchSource): FacetSwatch | null {
  const color1 = (option.swatchColor ?? "").trim();
  if (!color1) return null;
  const color2 = (option.swatchColor2 ?? "").trim();
  return color2 ? { color1, color2 } : { color1 };
}

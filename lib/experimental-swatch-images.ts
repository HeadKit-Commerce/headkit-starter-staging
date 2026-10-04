/**
 * WooCommerce Store API `__experimental_visual` term photos.
 *
 * DEFAULT OFF. A store that sets nothing makes zero attribute-term requests.
 * The recognised on values are `true`, `1`, `on`, and `yes`, in any case, with
 * surrounding whitespace ignored. Empty and anything else stay off — the same
 * table as the navigation switches. A typo must not start a WordPress crawl.
 *
 * Read from `process.env` here, not through `lib/env.ts`. The key is declared
 * on the server schema so a set value passes the boot parse and an operator
 * can find it. Importing the env module would drag that boot parse into every
 * caller. This is server-only: the layout passes the boolean into
 * `SwatchImageProvider`. Do not rename it to `NEXT_PUBLIC_` — the browser
 * must not be what decides to call WordPress.
 */
const ON_VALUES: ReadonlySet<string> = new Set(["true", "1", "on", "yes"]);

export function experimentalSwatchImagesEnabled(): boolean {
  const raw = process.env.HEADKIT_EXPERIMENTAL_SWATCH_IMAGES;
  if (raw === undefined) return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

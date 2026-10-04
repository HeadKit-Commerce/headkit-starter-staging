import type { CartTheme, StoreTheme } from "@/lib/store-theme";

/**
 * The theme fields client catalogue components actually read.
 * The server layout passes this slice in. The client never imports
 * lib/store-theme.ts, which is what pulls zod into the page.
 */
export interface ClientThemeSlice {
  badgeTags?: string[];
  maxCardSwatches?: number;
  sizeGuideHref?: string;
  cart?: CartTheme;
}

export function clientThemeSlice(theme: StoreTheme): ClientThemeSlice {
  const slice: ClientThemeSlice = {};
  const badgeTags = theme.catalog?.badgeTags;
  if (badgeTags !== undefined && badgeTags.length > 0) {
    slice.badgeTags = badgeTags;
  }
  const maxCardSwatches = theme.catalog?.maxCardSwatches;
  if (maxCardSwatches !== undefined) {
    slice.maxCardSwatches = maxCardSwatches;
  }
  const sizeGuideHref = theme.pdp?.sizeGuideHref;
  if (sizeGuideHref !== undefined && sizeGuideHref.length > 0) {
    slice.sizeGuideHref = sizeGuideHref;
  }
  if (theme.cart !== undefined) {
    slice.cart = theme.cart;
  }
  return slice;
}

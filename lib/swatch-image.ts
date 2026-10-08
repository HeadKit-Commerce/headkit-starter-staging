/**
 * Map WooCommerce Store API visual terms onto product options.
 *
 * Image swatches live on the attribute term, not the product gallery.
 * `GET /wp-json/wc/store/v1/products/attributes/{id}/terms?__experimental_visual=true`
 * adds `__experimentalVisual` for `wc-visual` attributes:
 * `{ type: "color" | "image" | "none", value }`.
 * An image swatch is `type: "image"` and `value` is the image URL.
 *
 * Nothing in this file performs that request. `lib/swatch-visual.ts` does,
 * and only when `HEADKIT_EXPERIMENTAL_SWATCH_IMAGES` is on.
 */

import { isSwatchAttribute } from "@/lib/swatch-attribute";

export interface SwatchOptionLike {
  slug?: string | null;
  swatchColor?: string | null;
  swatchImage?: string | null;
}

export interface SwatchAttributeLike {
  id?: string | number | null;
  slug?: string | null;
  type?: string | null;
  fullOptions?: ReadonlyArray<SwatchOptionLike> | null;
}

export interface SwatchProductLike {
  image?: { src?: string | null } | null;
  attributes?: ReadonlyArray<SwatchAttributeLike> | null;
  variations?: ReadonlyArray<{
    image?: { src?: string | null } | null;
  }> | null;
}

const ATTRIBUTE_ID = /^[0-9]+$/;

export function optionSwatchImage(option: object | null | undefined): string {
  if (!option) return "";
  const value = (option as { swatchImage?: unknown }).swatchImage;
  return typeof value === "string" ? value.trim() : "";
}

/** Absolute http(s) URL when the term visual is an image. Hex and empty values are not images. */
export function imageUrlFromVisual(visual: unknown): string {
  if (!visual || typeof visual !== "object") return "";
  const record = visual as { type?: unknown; value?: unknown };
  if (record.type !== "image" || typeof record.value !== "string") return "";
  const value = record.value.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return value;
  } catch {
    return "";
  }
}

/** Term slug → image URL, from one Store API attribute-terms page. */
export function visualImageBySlug(
  terms: readonly unknown[],
): Map<string, string> {
  const images = new Map<string, string>();
  for (const term of terms) {
    if (!term || typeof term !== "object") continue;
    const slug = (term as { slug?: unknown }).slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    const url = imageUrlFromVisual(
      (term as { __experimentalVisual?: unknown }).__experimentalVisual,
    );
    if (url) images.set(slug, url);
  }
  return images;
}

export function storeApiAttributeTermsUrl(
  origin: string,
  attributeId: string,
  page = 1,
): string {
  if (!ATTRIBUTE_ID.test(attributeId)) {
    throw new Error("WooCommerce attribute id must be numeric");
  }
  const url = new URL(
    `/wp-json/wc/store/v1/products/attributes/${attributeId}/terms`,
    origin,
  );
  url.searchParams.set("__experimental_visual", "true");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("hide_empty", "false");
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function commerceOriginFromImageSrc(
  src: string | null | undefined,
): string | null {
  if (!src) return null;
  try {
    const url = new URL(src);
    if (!url.pathname.includes("/wp-content/")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function commerceOriginFromProduct(
  product: SwatchProductLike,
): string | null {
  const fromMain = commerceOriginFromImageSrc(product.image?.src);
  if (fromMain) return fromMain;
  for (const variation of product.variations ?? []) {
    const origin = commerceOriginFromImageSrc(variation.image?.src);
    if (origin) return origin;
  }
  return null;
}

/**
 * An option still needs a Store API lookup when it has no image yet.
 * A hex `swatchColor` paints the chip immediately; the photo can arrive
 * later. An option that already has `swatchImage` does not need a lookup.
 */
function optionNeedsImageLookup(option: SwatchOptionLike): boolean {
  if (!option.slug) return false;
  return !optionSwatchImage(option);
}

/** `${attributeId}:${optionSlug}` key for a streamed swatch photo. */
export function swatchImageKey(
  attributeId: string,
  optionSlug: string,
): string {
  return `${attributeId}:${optionSlug}`;
}

export interface SwatchImageStream {
  /** `${attributeId}:${optionSlug}` → image URL. Absent when Woo has no photo. */
  images: Record<string, string>;
  /** Lookups that finished, including options that have no photo. */
  covered: Record<string, true>;
}

/** WooCommerce attribute ids whose terms must be loaded for empty image swatches. */
export function attributeIdsNeedingVisuals(
  product: SwatchProductLike,
): string[] {
  const ids: string[] = [];
  for (const attr of product.attributes ?? []) {
    const id = attr.id == null ? "" : String(attr.id);
    if (!ATTRIBUTE_ID.test(id)) continue;
    // Optional fields are omitted when unset. exactOptionalPropertyTypes
    // rejects an explicit `undefined` on `type` and `fullOptions`.
    const swatchAttr: Parameters<typeof isSwatchAttribute>[0] = {
      slug: attr.slug ?? "",
    };
    if (attr.type !== undefined) swatchAttr.type = attr.type;
    if (attr.fullOptions !== undefined) {
      swatchAttr.fullOptions = attr.fullOptions;
    }
    if (!isSwatchAttribute(swatchAttr)) continue;
    const missing = (attr.fullOptions ?? []).some(optionNeedsImageLookup);
    if (missing) ids.push(id);
  }
  return ids;
}

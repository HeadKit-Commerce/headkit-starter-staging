import { cacheLife, cacheTag } from "next/cache";
import { TAG } from "@/lib/cache-tags";
import { experimentalSwatchImagesEnabled } from "@/lib/experimental-swatch-images";
import {
  attributeIdsNeedingVisuals,
  commerceOriginFromProduct,
  storeApiAttributeTermsUrl,
  swatchImageKey,
  visualImageBySlug,
  type SwatchImageStream,
  type SwatchProductLike,
} from "@/lib/swatch-image";

export type { SwatchImageStream };

const visualCache = new Map<string, Promise<ReadonlyMap<string, string>>>();

/**
 * One shared copy of an attribute's image terms. A plain object, not a Map,
 * so the remote cache can store it. A failed response throws and is not stored,
 * so a rate-limit does not stick for the cache lifetime.
 *
 * Callers must not invoke this from inside `"use cache"`. The promise is
 * created in the page and unwrapped in the chip.
 */
async function loadVisualImages(
  origin: string,
  attributeId: string,
): Promise<Record<string, string>> {
  "use cache: remote";
  cacheLife("days");
  cacheTag(TAG.products);
  const images: Record<string, string> = {};
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(
      storeApiAttributeTermsUrl(origin, attributeId, page),
    );
    if (!response.ok) {
      throw new Error(
        `WooCommerce attribute ${attributeId} terms failed (${response.status})`,
      );
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(
        `WooCommerce attribute ${attributeId} terms were not a list`,
      );
    }
    for (const [slug, url] of visualImageBySlug(data)) {
      images[slug] = url;
    }
    if (data.length < 100) break;
  }
  return images;
}

function visualImagesForAttribute(
  origin: string,
  attributeId: string,
): Promise<ReadonlyMap<string, string>> {
  const key = `${origin}|${attributeId}`;
  const cached = visualCache.get(key);
  if (cached) return cached;

  const pending = loadVisualImages(origin, attributeId)
    .then((record) => new Map(Object.entries(record)))
    .catch(() => {
      visualCache.delete(key);
      return new Map<string, string>();
    });
  visualCache.set(key, pending);
  return pending;
}

const EMPTY_STREAM: SwatchImageStream = { images: {}, covered: {} };

/**
 * Start the visual-term read without blocking the caller.
 *
 * Returns an already-resolved empty stream unless
 * `HEADKIT_EXPERIMENTAL_SWATCH_IMAGES` is on. When it is on, the chip paints
 * its hex (or an empty circle) and `use()` streams the photo into that
 * placeholder. Do not await this inside `getCachedProduct` or any other
 * `"use cache"` function — a runtime promise created in there hangs the build.
 */
export function loadSwatchImageMap(
  products: readonly unknown[],
): Promise<SwatchImageStream> {
  if (!experimentalSwatchImagesEnabled()) {
    return Promise.resolve(EMPTY_STREAM);
  }
  return buildSwatchImageMap(products);
}

async function buildSwatchImageMap(
  products: readonly unknown[],
): Promise<SwatchImageStream> {
  const images: Record<string, string> = {};
  const covered: Record<string, true> = {};
  const groups = new Map<
    string,
    Array<{ ids: string[]; product: SwatchProductLike }>
  >();

  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    const candidate = product as SwatchProductLike;
    const ids = attributeIdsNeedingVisuals(candidate);
    if (ids.length === 0) continue;
    const origin = commerceOriginFromProduct(candidate);
    if (!origin) continue;
    const list = groups.get(origin) ?? [];
    list.push({ ids, product: candidate });
    groups.set(origin, list);
  }

  if (groups.size === 0) return EMPTY_STREAM;

  await Promise.all(
    [...groups.entries()].map(async ([origin, lookups]) => {
      const ids = [...new Set(lookups.flatMap((lookup) => lookup.ids))];
      const byId = new Map<string, ReadonlyMap<string, string>>();
      await Promise.all(
        ids.map(async (id) => {
          byId.set(id, await visualImagesForAttribute(origin, id));
        }),
      );
      for (const { ids: attrIds, product } of lookups) {
        for (const attr of product.attributes ?? []) {
          const id = attr.id == null ? "" : String(attr.id);
          if (!attrIds.includes(id)) continue;
          const found = byId.get(id);
          for (const option of attr.fullOptions ?? []) {
            if (!option.slug || option.swatchImage?.trim()) continue;
            const key = swatchImageKey(id, option.slug);
            covered[key] = true;
            const url = found?.get(option.slug);
            if (url) images[key] = url;
          }
        }
      }
    }),
  );

  return { images, covered };
}

/** One attribute's image terms, shared across chips that mount after the stream. */
export async function swatchImageRecord(
  origin: string,
  attributeId: string,
): Promise<Record<string, string>> {
  const images = await visualImagesForAttribute(origin, attributeId);
  return Object.fromEntries(images);
}

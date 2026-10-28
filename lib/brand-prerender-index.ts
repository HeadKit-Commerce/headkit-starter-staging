import { cacheLife, cacheTag } from "next/cache";
import { TAG } from "@/lib/cache-tags";
import { collectAllBrands } from "@/lib/brand-list";
import type { BrandHeaderSummary } from "@/lib/brand-prerender";

/**
 * One list walk, shared by every build-time brand read. The list route stays on
 * the CDN; `brands.get` does not (commerce sends the edge-bypass cookie on the
 * by-slug read, so each brand is a WordPress origin read that can 429 — see
 * `lib/brand-prerender.ts`).
 *
 * `"use cache: remote"` so the walk is ONE entry rather than one HTTP walk per
 * brand. The value is a serializable array — a Map cannot cross the cache
 * boundary. An incomplete walk THROWS instead of returning what it has: a
 * partial list would read a missing brand as a 404 and pin it for `days`, and a
 * thrown read is not cached.
 *
 * Only call this while `brandPrerenderUsesList(env.NEXT_PHASE)` holds.
 */
export async function getPrerenderBrandIndex(): Promise<BrandHeaderSummary[]> {
  "use cache: remote";
  cacheLife("days");
  cacheTag(TAG.brands);
  const { brands, complete } = await collectAllBrands();
  if (!complete) {
    throw new Error(
      "getPrerenderBrandIndex: brand list walk incomplete; refusing to treat a missing slug as a 404",
    );
  }
  return brands.map(({ slug, name, description, thumbnail, image }) => ({
    slug,
    name,
    description,
    thumbnail,
    imageSrc: image?.src ?? "",
  }));
}

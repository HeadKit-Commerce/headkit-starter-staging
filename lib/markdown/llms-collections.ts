import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import {
  pickLlmsCollections,
  type LlmsCollection,
} from "@/lib/markdown/llms-txt";
import { headkit } from "@/lib/sdk";

/**
 * Cached so `/llms.txt` costs the category tree one read per lifetime, not one
 * per fetch. Tagged `TAG.collections`, which WordPress fires on a category edit.
 * `hours` because a product save can empty or fill a category without firing it.
 */
export async function getLlmsCollections(): Promise<LlmsCollection[]> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  cacheTag(TAG.collections);
  return pickLlmsCollections(await headkit.collections.getCategories());
}

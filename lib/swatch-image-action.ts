"use server";

import { experimentalSwatchImagesEnabled } from "@/lib/experimental-swatch-images";
import { swatchImageRecord } from "@/lib/swatch-visual";

const ATTRIBUTE_ID = /^[0-9]+$/;

/**
 * Image terms for chips that mount outside the page stream (homepage, search,
 * load-more). Returns nothing unless the experimental flag is on, so a store
 * that has not opted in never calls WordPress from the browser.
 */
export async function fetchSwatchImages(
  origin: string,
  attributeId: string,
): Promise<Record<string, string>> {
  if (!experimentalSwatchImagesEnabled()) return {};
  if (!origin.startsWith("https://") && !origin.startsWith("http://")) {
    return {};
  }
  if (!ATTRIBUTE_ID.test(attributeId)) return {};
  return swatchImageRecord(origin, attributeId);
}

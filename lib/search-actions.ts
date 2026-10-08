"use server";

import type { ProductSummaryFieldsFragment } from "@headkit/sdk";
import { headkit } from "@/lib/sdk";

export async function searchProducts(
  q: string,
  limit = 4,
): Promise<ProductSummaryFieldsFragment[]> {
  if (!q.trim()) return [];
  // Same closest-match order as `/search` with no sort chosen, so the four
  // preview cards are the products "View more results" opens on.
  const result = await headkit.collections.list(
    { search: q, orderby: "relevance", order: "desc" },
    1,
    limit,
  );
  return result.products as ProductSummaryFieldsFragment[];
}

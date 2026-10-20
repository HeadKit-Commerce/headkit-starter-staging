import { NextResponse } from "next/server";
import { getCachedSearchFacets } from "@/lib/catalog-cache";
import { parseSearchFacetIds } from "@/lib/search-facet-ids";

/**
 * POST /api/search-filters  `{ "productIds": [1201, 1388, ...] }`
 *
 * The search page's filter options, counted over the products its search
 * matched (`productFilters(productIds:)`), so Brand / Category / Colour / Size
 * list only what applies to the grid. The IDs are the `matchedProductIds` the
 * grid's own search returned — no second search runs here.
 *
 * A Route Handler, NOT a Server Action, on purpose: the client dispatches
 * Server Actions one at a time, and this read takes 2-5 s on a cold WordPress
 * (the counting scales with the ID list). As an action it would queue every
 * Sort change and Load More behind it; as a fetch it runs beside them.
 *
 * POST because a broad search sends up to 500 IDs. JSON is required, so a
 * cross-site form cannot trigger the aggregation. Any upstream failure is a
 * 502 with no options: the page hides its filter buttons rather than falling
 * back to store-wide options, which are the wrong answer for a search.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "application/json required" },
      { status: 415 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    productIds?: unknown;
  } | null;
  const productIds = parseSearchFacetIds(body?.productIds);
  if (productIds === null) {
    return NextResponse.json(
      { error: "productIds must be 1-500 positive integers" },
      { status: 400 },
    );
  }
  try {
    const filters = await getCachedSearchFacets(productIds);
    return NextResponse.json(filters, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "filter options unavailable" },
      { status: 502 },
    );
  }
}

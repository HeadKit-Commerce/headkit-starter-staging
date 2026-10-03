/**
 * Whether a build prerenders collection facet URLs (`/collections/…/f/…`).
 *
 * Product HTML already follows the HeadKit catalogue size
 * (`lib/product-prerender-plan.ts`, commerce `ProductPrerenderSKUCeiling`).
 * Facet HTML is the other family that can walk a build into Vercel's
 * 45-minute kill. It is not an env cap and it is not a walk-order slice:
 * the indexable set is emitted in full, or not at all. An un-emitted URL
 * still routes. With the route's `loading.tsx`, the first request paints
 * that page's skeleton and then the cached document.
 *
 * The decision is made BEFORE `getFilters`. Discovering the set is one
 * read per category; rendering a facet page is another catalogue read on
 * top. A finite "keep the first N" still pays every read and then bakes
 * whichever facets the category walk happened to yield first.
 */

/** Same line as `PRODUCT_PRERENDER_SKU_CEILING`. A test pins the equality. */
export const FACET_PRODUCT_SKU_CEILING = 4_000;

/**
 * Pages a build can finish inside the 45-minute kill, with headroom.
 * A green build finished 5,118 pages in 33 minutes. A later one was killed
 * at 45.6 minutes having reached 3,444 of 5,277. 4,500 sits under both.
 * This is a budget for the whole build, not a choice of which facets.
 */
export const BUILD_PAGE_CEILING = 4_500;

/**
 * Shop URLs per SKU on the catalogue the product ceiling was drawn from:
 * 2,677 products, about 4,000 canonical shop URLs once colourways are
 * included. An estimate of product HTML, used only to see whether facet
 * HTML still fits. Commerce replaces it when bulk status reports a URL count.
 */
export const MEASURED_SKUS = 2_677;
export const MEASURED_SHOP_URLS = 4_000;

/**
 * Used only to skip the `getFilters` fan-out when even a dense indexable
 * matrix cannot fit. The measured store was about 4.5 facets per category
 * after the empty-pair cut (687 facets across ~154 categories). 8 sits
 * above that so a denser catalogue is still discovered when the page
 * budget can hold the result. It is not a cap on what gets emitted.
 */
export const FACETS_PER_CATEGORY_DISCOVERY_CEILING = 8;

export interface FacetCataloguePlan {
  readonly mode: "all" | "on-demand";
  readonly paths: readonly string[];
  readonly reason: string;
  readonly total: number | null;
}

const ALL_WITHOUT_STATUS: FacetCataloguePlan = {
  mode: "all",
  paths: [],
  reason: "NO_BULK_STATUS",
  total: null,
};

const ON_DEMAND_UNAVAILABLE: FacetCataloguePlan = {
  mode: "on-demand",
  paths: [],
  reason: "PLAN_UNAVAILABLE",
  total: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTotal(status: Record<string, unknown>): number | null {
  const total = status.total;
  return typeof total === "number" && Number.isFinite(total) && total >= 0
    ? total
    : null;
}

function normalizeMode(mode: unknown): "all" | "on-demand" | null {
  if (mode === "all" || mode === "ALL") return "all";
  if (mode === "on-demand" || mode === "ON_DEMAND") return "on-demand";
  return null;
}

/**
 * The same reading as `planFromStatus`, kept here so a storefront whose
 * product route has not imported that module can still decide facets.
 * A platform test asserts the SKU ceiling matches.
 */
export function facetPlanFromStatus(status: unknown): FacetCataloguePlan {
  if (!isRecord(status)) return ON_DEMAND_UNAVAILABLE;
  const total = readTotal(status);
  if (isRecord(status.prerender)) {
    const mode = normalizeMode(status.prerender.mode);
    if (mode) {
      const reasonRaw = status.prerender.reason;
      const pathsRaw = status.prerender.paths;
      const paths = Array.isArray(pathsRaw)
        ? pathsRaw.filter(
            (path): path is string =>
              typeof path === "string" && path.length > 0,
          )
        : [];
      return {
        mode,
        paths,
        reason:
          typeof reasonRaw === "string" && reasonRaw.length > 0
            ? reasonRaw
            : `API_${mode === "all" ? "ALL" : "ON_DEMAND"}`,
        total,
      };
    }
  }
  const reason = status.reason;
  if (reason === "PROBE_FAILED" || reason === "probe_failed") {
    return { mode: "on-demand", paths: [], reason: "PROBE_FAILED", total };
  }
  if (total === null) {
    return {
      mode: "on-demand",
      paths: [],
      reason: "TOTAL_UNKNOWN",
      total: null,
    };
  }
  if (total > FACET_PRODUCT_SKU_CEILING) {
    return {
      mode: "on-demand",
      paths: [],
      reason: `SKU_CEILING ${total}>${FACET_PRODUCT_SKU_CEILING}`,
      total,
    };
  }
  return {
    mode: "all",
    paths: [],
    reason: `SKU_CEILING ${total}<=${FACET_PRODUCT_SKU_CEILING}`,
    total,
  };
}

function bulkStatusOf(products: object): (() => Promise<unknown>) | undefined {
  if (!("bulkStatus" in products)) return undefined;
  const bulkStatus = products.bulkStatus;
  if (typeof bulkStatus !== "function") return undefined;
  return bulkStatus as () => Promise<unknown>;
}

/** Ask commerce once. Never throws. No client → treat as a small catalogue. */
export async function readFacetCataloguePlan(
  products: object | undefined,
): Promise<FacetCataloguePlan> {
  if (!products) return ALL_WITHOUT_STATUS;
  const bulkStatus = bulkStatusOf(products);
  if (!bulkStatus) return ALL_WITHOUT_STATUS;
  try {
    return facetPlanFromStatus(await bulkStatus());
  } catch {
    return ON_DEMAND_UNAVAILABLE;
  }
}

/** Product HTML this plan will emit, estimated from the SKU count. */
export function productPagesForPlan(plan: FacetCataloguePlan): number {
  if (plan.mode === "on-demand") return plan.paths.length;
  if (plan.total === null) return 0;
  return Math.ceil((plan.total * MEASURED_SHOP_URLS) / MEASURED_SKUS);
}

/**
 * Pages left for facet HTML after product URLs and the base category URLs.
 * `Infinity` means the catalogue size is unknown and small (no bulk status):
 * emit the indexable set, which is what those storefronts build today.
 */
export function facetPageRoom(
  plan: FacetCataloguePlan,
  categoryCount: number,
): number {
  if (
    plan.reason === "PROBE_FAILED" ||
    plan.reason === "PLAN_UNAVAILABLE" ||
    plan.reason === "TOTAL_UNKNOWN"
  ) {
    return 0;
  }
  if (plan.mode === "on-demand") return 0;
  if (plan.total === null) return Number.POSITIVE_INFINITY;
  return (
    BUILD_PAGE_CEILING - productPagesForPlan(plan) - Math.max(0, categoryCount)
  );
}

/** False skips `getFilters` and the brand list entirely. */
export function shouldDiscoverCollectionFacets(
  plan: FacetCataloguePlan,
  categoryCount: number,
): boolean {
  if (categoryCount <= 0) return false;
  const room = facetPageRoom(plan, categoryCount);
  if (!Number.isFinite(room)) return true;
  if (room <= 0) return false;
  return categoryCount * FACETS_PER_CATEGORY_DISCOVERY_CEILING <= room;
}

/**
 * All or nothing. A set larger than the room is not sliced down to the room.
 */
export function shouldEmitCollectionFacets(
  plan: FacetCataloguePlan,
  categoryCount: number,
  facetCount: number,
): boolean {
  if (facetCount <= 0) return false;
  const room = facetPageRoom(plan, categoryCount);
  if (!Number.isFinite(room)) return true;
  return facetCount <= room;
}

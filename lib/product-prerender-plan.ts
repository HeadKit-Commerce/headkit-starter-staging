/**
 * Whether a build prerenders product HTML, decided by the HeadKit API.
 *
 * Both PDP routes (`app/products/[...slug]` and `app/shop/[...slug]`) ask
 * `products.bulkStatus()` once and obey the answer. Commerce owns the cutoff
 * against Vercel's 45-minute build kill, which cannot be raised on any plan.
 * The storefront does not read `HEADKIT_PRERENDER_PRODUCT_LIMIT` or
 * `HEADKIT_PRERENDER_PRODUCT_COLOURWAYS`.
 *
 * Commerce response, on the existing bulk-status object:
 *
 *   prerender: {
 *     mode: "all" | "on-demand";
 *     paths?: string[]; // optional hot set, site paths (`/shop/…`, `/products/…`)
 *     reason?: string;
 *   }
 *
 * `all` walks the catalogue and builds every canonical product URL, including
 * colourways on the nested route. `on-demand` builds nothing (or only `paths`).
 * Unbuilt URLs stay routable: `dynamicParams` stays on, the sitemap still
 * lists them, and the first request is ISR — a finished document the CDN keeps.
 * Count canonical URLs, not SKUs: colourways multiply the page count.
 *
 * Until commerce sends `prerender`, this module uses `total` (the SKU count
 * already on that response) against {@link PRODUCT_PRERENDER_SKU_CEILING}.
 * That ceiling is a platform stand-in, not a per-store setting. It sits above
 * the catalogues that already finish inside the kill (a measured store at
 * 2,677 products and about 4,000 shop URLs) and below a 20,000-SKU catalogue,
 * whose bulk fetch alone is ~22 minutes before any HTML is rendered. A store
 * over the line builds no product HTML. A directed `all`, or an `on-demand`
 * that names a reason or a hot set, replaces this comparison. An `on-demand`
 * with no reason and no paths is a zero mode, not a measured refusal, so a
 * counted catalogue under the ceiling still builds.
 *
 * Failure is build-safe, and it is never silent: a thrown status call is
 * retried once and then answers `on-demand` with the error message in the
 * build log, so an unknown catalogue cannot walk itself into the 45-minute
 * kill and a dead product pass cannot hide as a bare reason. A client whose
 * SDK has no `bulkStatus` (older storefronts, and the unit-test doubles) answers
 * `all`: those catalogues are the ones this method predates, and their
 * `generateStaticParams` tests enumerate real products.
 */

/** SKU stand-in used only when commerce has not sent `prerender`. */
export const PRODUCT_PRERENDER_SKU_CEILING = 4_000;

export type ProductPrerenderMode = "all" | "on-demand";

export interface ProductPrerenderPlan {
  readonly mode: ProductPrerenderMode;
  /** Site paths commerce named. Meaningful for `on-demand`; ignored for `all`. */
  readonly paths: readonly string[];
  readonly reason: string;
  /** Catalogue size the status reported, when it was a finite count. */
  readonly total: number | null;
}

/**
 * Read `bulkStatus` off any object. The published `ProductsDomain` on stores
 * whose SDK predates that method has nothing else in common with a type whose
 * only member is optional `bulkStatus`, and TypeScript rejects that as a weak
 * type (TS2559). `object` accepts the class either way; a missing method is
 * the `all` path below.
 */
function bulkStatusOf(products: object): (() => Promise<unknown>) | undefined {
  if (!("bulkStatus" in products)) return undefined;
  const bulkStatus = products.bulkStatus;
  if (typeof bulkStatus !== "function") return undefined;
  return bulkStatus as () => Promise<unknown>;
}

const ALL_WITHOUT_STATUS: ProductPrerenderPlan = {
  mode: "all",
  paths: [],
  reason: "NO_BULK_STATUS",
  total: null,
};

const ON_DEMAND_UNAVAILABLE: ProductPrerenderPlan = {
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

function normalizeMode(mode: unknown): ProductPrerenderMode | null {
  // Commerce's GraphQL enum serialises as ALL / ON_DEMAND. The storefront
  // also accepts the lowercase spelling used before that schema existed.
  if (mode === "all" || mode === "ALL") return "all";
  if (mode === "on-demand" || mode === "ON_DEMAND") return "on-demand";
  return null;
}

function readDirected(
  status: Record<string, unknown>,
): { mode: ProductPrerenderMode; paths: string[]; reason: string } | null {
  if (!isRecord(status.prerender)) return null;
  const mode = normalizeMode(status.prerender.mode);
  if (mode === null) return null;
  const pathsRaw = status.prerender.paths;
  const paths = Array.isArray(pathsRaw)
    ? pathsRaw.filter(
        (path): path is string => typeof path === "string" && path.length > 0,
      )
    : [];
  const reasonRaw = status.prerender.reason;
  const reason =
    typeof reasonRaw === "string" && reasonRaw.length > 0
      ? reasonRaw
      : `API_${mode === "all" ? "ALL" : "ON_DEMAND"}`;
  return { mode, paths, reason };
}

/**
 * Pure reading of one bulk-status payload. Exported so the decision is tested
 * without a client.
 */
export function planFromStatus(status: unknown): ProductPrerenderPlan {
  if (!isRecord(status)) return ON_DEMAND_UNAVAILABLE;
  const total = readTotal(status);
  const directed = readDirected(status);
  if (directed) {
    // A zero `prerender.mode` is serialised as on-demand with no reason and
    // no hot set. That is not a measured refusal: commerce's real refusals
    // name `probe_failed`, `sku_ceiling`, or `OVER_URL_BUDGET`. A counted
    // catalogue at or under the ceiling still builds every product URL.
    if (
      directed.mode === "on-demand" &&
      directed.paths.length === 0 &&
      directed.reason === "API_ON_DEMAND" &&
      total !== null &&
      total <= PRODUCT_PRERENDER_SKU_CEILING
    ) {
      return {
        mode: "all",
        paths: [],
        reason: `SKU_CEILING ${total}<=${PRODUCT_PRERENDER_SKU_CEILING}`,
        total,
      };
    }
    return {
      mode: directed.mode,
      paths: directed.paths,
      reason: directed.reason,
      total,
    };
  }
  // A failed probe reports total 0. That is not an empty catalogue, and
  // treating it as one would prerender a store whose size is unknown.
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
  if (total > PRODUCT_PRERENDER_SKU_CEILING) {
    return {
      mode: "on-demand",
      paths: [],
      reason: `SKU_CEILING ${total}>${PRODUCT_PRERENDER_SKU_CEILING}`,
      total,
    };
  }
  return {
    mode: "all",
    paths: [],
    reason: `SKU_CEILING ${total}<=${PRODUCT_PRERENDER_SKU_CEILING}`,
    total,
  };
}

function logDuringBuild(message: string): void {
  // Proof is the build log, the same way bulk prefetch is. Unit tests and
  // runtime requests do not run inside `next build`.
  if (process.env.NEXT_PHASE !== "phase-production-build") return;
  console.log(message);
}

function logPlan(plan: ProductPrerenderPlan): void {
  logDuringBuild(`[product-prerender] ${plan.mode} (${plan.reason})`);
}

/** Ask commerce, then {@link planFromStatus}. Never throws. */
export async function readProductPrerenderPlan(
  products: object,
): Promise<ProductPrerenderPlan> {
  const bulkStatus = bulkStatusOf(products);
  if (!bulkStatus) {
    logPlan(ALL_WITHOUT_STATUS);
    return ALL_WITHOUT_STATUS;
  }
  // Call with the products client as `this`. Pulling the method off the class
  // and invoking it bare throws inside the SDK (`this.opts` is undefined), and
  // that throw used to become "no product HTML" with nothing in the build log
  // but a bare PLAN_UNAVAILABLE. `lib/collection-facet-plan.ts` reads the same
  // endpoint and was fixed the same way; keep the two explainable side by side.
  //
  // Retry once, as the facet module does, and for the same reason: the two
  // modules ask the same endpoint in the same build, so a single flaky read
  // must not be able to leave one answering `all` and the other refusing.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const plan = planFromStatus(await bulkStatus.call(products));
      logPlan(plan);
      return plan;
    } catch (error) {
      lastError = error;
    }
  }
  // Carry the cause. A silent catch here hid a dead product pass for four days.
  const message = lastError instanceof Error ? lastError.message : "unknown";
  logDuringBuild(
    `[product-prerender] ${ON_DEMAND_UNAVAILABLE.mode} (${ON_DEMAND_UNAVAILABLE.reason}) status read failed (${message})`,
  );
  return ON_DEMAND_UNAVAILABLE;
}

/**
 * Turn commerce's hot-set paths into params for one route. Paths for the
 * other route are ignored. An empty result means "placeholder only".
 */
export function paramsFromPlanPaths(
  paths: readonly string[],
  route: "products" | "shop",
): { slug: string[] }[] {
  const prefix = route === "products" ? "/products/" : "/shop/";
  const seen = new Set<string>();
  const params: { slug: string[] }[] = [];
  for (const raw of paths) {
    const noHash = raw.split("#")[0] ?? "";
    const noQuery = noHash.split("?")[0] ?? "";
    let path = noQuery;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (!path.startsWith(prefix)) continue;
    const slug = path
      .slice(prefix.length)
      .split("/")
      .filter((segment) => segment.length > 0);
    if (slug.length === 0) continue;
    const key = slug.join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    params.push({ slug });
  }
  return params;
}

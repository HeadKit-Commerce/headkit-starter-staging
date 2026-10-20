import type {
  ProductListFilter,
  ProductCategoryDetail,
  ProductFilters,
} from "@headkit/sdk";
import {
  COLOR_ATTR_SLUGS,
  isColorAttrSlug,
  toAttributeKey,
} from "@/lib/color-attr-slug";
import { decodeHtmlEntities } from "@/lib/utils";
import { COLLECTION_PATH_PREFIX } from "@/lib/route-prefixes";

export { isColorAttrSlug, toAttributeKey };

export const SortKey = {
  FEATURED: "FEATURED",
  BEST_SELLING: "BEST_SELLING",
  CREATED_AT: "CREATED_AT",
  CREATED_AT_DESC: "CREATED_AT_DESC",
  PRICE: "PRICE",
  PRICE_DESC: "PRICE_DESC",
  TITLE: "TITLE",
  TITLE_DESC: "TITLE_DESC",
} as const;

export type SortKeyType = keyof typeof SortKey;

export const SortKeyLabels: Record<SortKeyType, string> = {
  FEATURED: "Featured",
  BEST_SELLING: "Best selling",
  CREATED_AT: "Date, new to old",
  CREATED_AT_DESC: "Date, old to new",
  PRICE: "Price, low to high",
  PRICE_DESC: "Price, high to low",
  TITLE: "Alphabetically, A-Z",
  TITLE_DESC: "Alphabetically, Z-A",
};

export interface FilterValues {
  categories: string[];
  brands: string[];
  attributes: Record<string, string[]>;
  instock: boolean;
  sort: SortKeyType | "";
  page: number;
  /** Price lower bound (string for SDK compat); empty/undefined = unset. */
  price_min?: string;
  /** Price upper bound (string for SDK compat); empty/undefined = unset. */
  price_max?: string;
}

export const DEFAULT_FILTER_VALUES: FilterValues = {
  categories: [],
  brands: [],
  attributes: {},
  instock: false,
  sort: "",
  page: 1,
  price_min: "",
  price_max: "",
};

/**
 * Tier-1 SEO predicate. Returns true ONLY for a "Nike-style" single-color
 * collection URL: exactly one attribute, that attribute is the color facet
 * (`pa_color`/`pa_colour`), it carries exactly one value, AND no other filter
 * is engaged (no brand, category, price, in-stock, non-default sort/page).
 *
 * This is the single source of truth gating index-vs-canonical-to-base. It runs
 * at request time too, so on-demand single-color pages are also SEO-correct.
 */
export function isIndexableFacet(filters: FilterValues): boolean {
  // No non-facet filter may be engaged. Brand is now an indexable facet (06.1)
  // so it is NOT rejected up-front — it is one of the two allowed dimensions.
  if (filters.categories.length > 0) return false;
  if (filters.instock) return false;
  if (filters.price_min) return false;
  if (filters.price_max) return false;
  if (filters.sort && filters.sort !== DEFAULT_FILTER_VALUES.sort) return false;
  if (filters.page && filters.page !== DEFAULT_FILTER_VALUES.page) return false;

  // Active attribute groups (ignore stray empty-array keys) and brand values.
  const activeAttrs = Object.entries(filters.attributes).filter(
    ([, vals]) => vals.length > 0,
  );
  const hasBrand = filters.brands.length > 0;

  // Indexable iff EXACTLY ONE facet dimension is engaged:
  //   (a) one color attribute with one value, AND no brand, OR
  //   (b) one brand with one value, AND no attribute.
  if (hasBrand) {
    // Brand path: no attribute groups may be engaged, single brand value only.
    if (activeAttrs.length > 0) return false;
    return filters.brands.length === 1;
  }

  // Color path: exactly one attribute group, the color facet, single value.
  if (activeAttrs.length !== 1) return false;
  const [slug, values] = activeAttrs[0]!;
  if (!COLOR_ATTR_SLUGS.includes(slug as (typeof COLOR_ATTR_SLUGS)[number]))
    return false;
  if (values.length !== 1) return false;

  return true;
}

/**
 * Tier-1 SEO title: "{FacetLabel} {categoryName}" — works for a color label
 * (e.g. "Red Lifestyle Shoes") OR a brand label (e.g. "Velocity Apparel").
 */
export function facetTitle(categoryName: string, facetLabel: string): string {
  return `${facetLabel} ${categoryName}`.trim();
}

/**
 * Tier-1 SEO description: a templated sentence for a single-facet collection.
 * `facetLabel` is a color or a brand label. Pass the real dashboard store name
 * when available — never hardcode a placeholder like `"Store"`.
 */
export function facetDescription(
  categoryName: string,
  facetLabel: string,
  storeName?: string | null,
): string {
  const site = (storeName ?? "").trim();
  const atSite = site.length > 0 ? ` at ${site}` : "";
  return `Shop ${facetLabel} ${categoryName}${atSite}. Browse the latest ${facetLabel.toLowerCase()} ${categoryName.toLowerCase()} with prices and availability.`;
}

/** Convert slug-like option value to display name (e.g. "some-option" -> "Some Option"). */
export function formatOptionName(slug: string): string {
  // WooCommerce often returns names with HTML entities (`&amp;`); decode first
  // so filters don't render literal `&amp;` in the UI.
  return decodeHtmlEntities(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Coerce a price-like string into a non-negative numeric string, or undefined. */
function coercePrice(value?: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return String(n);
}

export function buildProductListFilter(
  filterValues: FilterValues,
  options: {
    categorySlug?: string;
    onSale?: boolean;
    isNew?: boolean;
    featured?: boolean;
    search?: string;
    brandSlug?: string;
    /** In-stock toggle; `filterValues.instock` (`?instock=true`) also sets it. */
    instock?: boolean;
    /** Price lower bound; coerced to a numeric string before mapping. */
    minPrice?: string;
    /** Price upper bound; coerced to a numeric string before mapping. */
    maxPrice?: string;
    /**
     * Branding default sort when `filterValues.sort` is empty (no ?sort=).
     * Keeps the URL indexable while still applying merchant-chosen order.
     */
    defaultSort?: SortKeyType | "";
  } = {},
): ProductListFilter {
  const filter: ProductListFilter = {};

  const categoryValue = options.categorySlug ?? filterValues.categories[0];
  if (categoryValue) filter.category = categoryValue;

  // ⚠ Open Q1 = single-ok: ProductListFilter.brand is a single String. The UI
  // and URL carry a multi-select brands[] (D-02), but only the FIRST selected
  // brand maps to the backend filter (parity: old store was single-brand).
  const brandValue = options.brandSlug ?? filterValues.brands[0];
  if (brandValue) filter.brand = brandValue;

  if (Object.keys(filterValues.attributes).length) {
    filter.attributes = Object.entries(filterValues.attributes)
      .filter(([, v]) => v.length > 0)
      .flatMap(([slug, values]) => values.map((value) => ({ slug, value })));
  }

  const minPrice = coercePrice(options.minPrice ?? filterValues.price_min);
  if (minPrice !== undefined) filter.minPrice = minPrice;
  const maxPrice = coercePrice(options.maxPrice ?? filterValues.price_max);
  if (maxPrice !== undefined) filter.maxPrice = maxPrice;

  if (options.onSale) filter.onSale = true;
  if (options.isNew) filter.isNew = true;
  if (options.featured) filter.featured = true;
  if (options.search) filter.search = options.search;
  // In stock OR on backorder (commerce `inStock`). Sent only when on: a
  // gateway that predates the field rejects the whole query for it.
  if (options.instock ?? filterValues.instock) filter.inStock = true;

  const sortMap: Record<SortKeyType, { orderby: string; order: string }> = {
    FEATURED: { orderby: "menu_order", order: "asc" },
    BEST_SELLING: { orderby: "popularity", order: "desc" },
    CREATED_AT: { orderby: "date", order: "desc" },
    CREATED_AT_DESC: { orderby: "date", order: "asc" },
    PRICE: { orderby: "price", order: "asc" },
    PRICE_DESC: { orderby: "price", order: "desc" },
    TITLE: { orderby: "title", order: "asc" },
    TITLE_DESC: { orderby: "title", order: "desc" },
  };

  const effectiveSort = (filterValues.sort || options.defaultSort || "") as
    | SortKeyType
    | "";
  if (effectiveSort && effectiveSort in sortMap) {
    const s = sortMap[effectiveSort];
    filter.orderby = s.orderby;
    filter.order = s.order;
  }

  return filter;
}

/**
 * Parse raw searchParams into FilterValues, reading ONLY known facet keys
 * (unknown URL params are ignored — no passthrough; T-03-P1). Attribute keys
 * (e.g. `pa_colour`) are namespaced and parsed separately by the client
 * context against the available ProductFilters; the server-side initial render
 * here covers the canonical first-class facets.
 */
export function parseSearchParams(sp: Record<string, string>): FilterValues {
  const split = (v?: string) => v?.split(",").filter(Boolean) ?? [];
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;
  const sort = (sp.sort ?? "") as SortKeyType | "";
  return {
    ...DEFAULT_FILTER_VALUES,
    categories: split(sp.categories),
    brands: split(sp.brands),
    attributes: {},
    instock: sp.instock === "true",
    sort: sort in SortKey ? sort : "",
    page,
    price_min: coercePrice(sp.price_min) ?? "",
    price_max: coercePrice(sp.price_max) ?? "",
  };
}

/**
 * Produce a STABLE cache key from a built ProductListFilter (sorted keys, no
 * volatile fields). Used to key the durable catalog cache so equal filters
 * share a cache entry and the key space stays bounded (T-03-P2). Never derive
 * this from raw searchParams.
 */
export function normalizeFilterKey(filter: ProductListFilter): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(filter).sort()) {
    const value = (filter as Record<string, unknown>)[key];
    if (key === "attributes" && Array.isArray(value)) {
      sorted[key] = [...value]
        .map((a) => ({ slug: a.slug, value: a.value }))
        .sort((x, y) =>
          `${x.slug}:${x.value}`.localeCompare(`${y.slug}:${y.value}`),
        );
    } else {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

/**
 * The `/f/<slug>` facet codec lives in `@/lib/filter-slug` — dependency-free so
 * `proxy.ts` can fold legacy facet query keys into the path form without
 * pulling the UI layer into the proxy bundle. Re-exported here so every
 * existing caller is unchanged and there is only ONE copy of the codec.
 */
export {
  encodeFilterSlug,
  decodeFilterSlug,
  BRAND_GROUP_KEY,
  type DecodedFilterSlug,
} from "@/lib/filter-slug";

/**
 * The single `/collections/...` path a category is canonically served at:
 * its ancestors root-first, then its own slug.
 *
 * The route resolves a category from the LAST slug segment, so
 * `/collections/child` and `/collections/parent/child` both serve the same
 * category. Deriving the path from the category itself rather than from the
 * requested URL is what lets every one of those shapes agree, and it
 * reproduces exactly the path `app/sitemap.ts` advertises.
 *
 * Ancestors arrive root → immediate parent (Woo HeadKit REST already
 * `array_reverse`s the walk-up); do not reverse them.
 */
export function collectionPathFromCategory(
  category: ProductCategoryDetail,
): string {
  const segments = [
    ...(category.ancestors ?? []).map((ancestor) => ancestor.slug),
    category.slug,
  ].filter((segment) => segment.length > 0);
  return `/${COLLECTION_PATH_PREFIX}/${segments.join("/")}`;
}

/** Build breadcrumb URIs to match the Next.js route /collections/[...slug] (same as URL path). */
export function buildBreadcrumbFromCategory(
  category: ProductCategoryDetail,
): { name: string; uri: string; current: boolean }[] {
  const crumbs: { name: string; uri: string; current: boolean }[] = [
    { name: "Home", uri: "/", current: false },
    { name: "Shop", uri: "/shop", current: false },
  ];

  // Ancestors are root → immediate parent (Woo HeadKit REST already
  // array_reverse's the walk-up). Reversing again inverts labels and
  // produces invalid nested URIs (SEO + broken crumb links).
  const ancestors = category.ancestors ?? [];
  const pathSegments: string[] = [];

  for (const ancestor of ancestors) {
    pathSegments.push(ancestor.slug);
    crumbs.push({
      name: ancestor.name,
      uri: `/collections/${pathSegments.join("/")}`,
      current: false,
    });
  }

  crumbs.push({
    name: category.name,
    uri: collectionPathFromCategory(category),
    current: true,
  });

  return crumbs;
}
/** Query state this provider owns, and the only thing `CollectionProvider`'s mount effect
 *  reads from `window.location.search`. Everything else (path facets, the
 *  category, the search term) is a prop the server already resolved. */
export interface DeriveFilterValuesOptions {
  initialPage: number;
  productFilter: ProductFilters;
  initialFilterValues?: Record<string, string[]> | undefined;
  initialBrands?: string[] | undefined;
}

/**
 * Build `FilterValues` from the props the server passes plus an optional query
 * string. Pure, and called twice: once at mount with NO query string (so the
 * provider renders identically on the server and the client — see `CollectionProvider`'s
 * mount effect for why that matters), and once from that effect with the
 * real `window.location.search`.
 *
 * Precedence is unchanged from when this read `useSearchParams()` directly:
 * path-decoded brands/attributes (`/f/<slug>`) beat the legacy query forms.
 */
export function deriveFilterValues(
  searchParams: URLSearchParams,
  {
    initialPage,
    productFilter,
    initialFilterValues,
    initialBrands,
  }: DeriveFilterValuesOptions,
): FilterValues {
  const pageParam = searchParams.get("page");
  const page = pageParam
    ? Math.max(1, parseInt(pageParam, 10) || initialPage)
    : initialPage;
  // `attributes: {}` is NOT redundant: spreading DEFAULT_FILTER_VALUES copies
  // the REFERENCE to its `attributes` object, and the legacy-query branch below
  // writes into it — which mutates the module-level default for every later
  // caller. Harmless when this ran once per mount; with the mount correction it
  // made `corrected.attributes` and the seeded `current.attributes` the SAME
  // object, so the equality check below saw no change and a legacy `?colour=`
  // URL silently stopped folding into `/f/colour.<value>`. Measured in a
  // browser against a production build.
  const vals: FilterValues = { ...DEFAULT_FILTER_VALUES, attributes: {}, page };
  const categories =
    searchParams.get("categories")?.split(",").filter(Boolean) ?? [];
  if (categories.length) vals.categories = categories;
  // Brand is path-encoded (06.1): the server decodes it from the `/f/` slug and
  // passes it via initialBrands. That takes precedence over the legacy
  // `?brands=` query param (still read as a fallback for old/in-flight URLs).
  if (initialBrands && initialBrands.length > 0) {
    vals.brands = initialBrands;
  } else {
    const brands = searchParams.get("brands")?.split(",").filter(Boolean) ?? [];
    if (brands.length) vals.brands = brands;
  }
  // Path-decoded attributes take precedence; fall back to search params for legacy URLs.
  if (initialFilterValues && Object.keys(initialFilterValues).length > 0) {
    vals.attributes = initialFilterValues;
  } else {
    productFilter.attributes?.forEach((attr) => {
      if (!attr?.slug) return;
      const values =
        searchParams.get(attr.slug)?.split(",").filter(Boolean) ?? [];
      if (values.length) vals.attributes[attr.slug] = values;
    });
  }
  vals.instock = searchParams.get("instock") === "true";
  vals.sort = (searchParams.get("sort") ?? "") as SortKeyType | "";
  const priceMin = searchParams.get("price_min");
  if (priceMin) vals.price_min = priceMin;
  const priceMax = searchParams.get("price_max");
  if (priceMax) vals.price_max = priceMax;
  return vals;
}

/**
 * Resolve the active search term after hydration.
 * Prefer `?q=` from the URL; fall back to the server prop (usually empty on
 * the static `/search` shell).
 */
export function searchTermFromQuery(
  serverSearch: string | undefined,
  searchParams: URLSearchParams,
): string {
  const q = searchParams.get("q")?.trim() ?? "";
  if (q) return q;
  return serverSearch ?? "";
}

/** Query string with nothing in it — the server's view of the world. */
export const NO_SEARCH_PARAMS = new URLSearchParams();

/** Value equality for two derived `FilterValues`, so the mount correction can
 *  no-op on the common case (a bare canonical URL with no query string) rather
 *  than handing the provider's
 *  reconciling effect a fresh object and forcing a refetch. */
export function sameFilterValues(a: FilterValues, b: FilterValues): boolean {
  const sameList = (x: string[], y: string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  if (a.page !== b.page) return false;
  if (a.instock !== b.instock) return false;
  if (a.sort !== b.sort) return false;
  if ((a.price_min ?? "") !== (b.price_min ?? "")) return false;
  if ((a.price_max ?? "") !== (b.price_max ?? "")) return false;
  if (!sameList(a.categories, b.categories)) return false;
  if (!sameList(a.brands, b.brands)) return false;
  const aKeys = Object.keys(a.attributes).sort();
  const bKeys = Object.keys(b.attributes).sort();
  if (!sameList(aKeys, bKeys)) return false;
  return aKeys.every((key) =>
    sameList(a.attributes[key] ?? [], b.attributes[key] ?? []),
  );
}

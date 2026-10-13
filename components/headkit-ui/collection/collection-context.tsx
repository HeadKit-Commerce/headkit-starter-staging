"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type {
  ProductSummaryFieldsFragment,
  ProductFilters,
} from "@headkit/sdk";
import { listCollectionProducts } from "@/lib/collection-actions";
import { useCatalogDisplay } from "@/components/headkit-ui/catalog-display-provider";
import { nextSearchHold } from "./search-hold";
import {
  buildProductListFilter,
  deriveFilterValues,
  encodeFilterSlug,
  isColorAttrSlug,
  sameFilterValues,
  searchTermFromQuery,
  toAttributeKey,
  DEFAULT_FILTER_VALUES,
  NO_SEARCH_PARAMS,
  type FilterValues,
  type SortKeyType,
} from "./utils";

interface CollectionContextType {
  products: ProductSummaryFieldsFragment[];
  totalProducts: number;
  currentPage: number;
  itemsPerPage: number;
  isLoading: boolean;
  isLoadingBefore: boolean;
  isLoadingAfter: boolean;
  hasMore: boolean;
  hasFirstPage: boolean;
  filterValues: FilterValues;
  setFilterValues: (values: FilterValues) => void;
  clearFilters: () => void;
  loadMore: () => void;
  loadPrevious: () => void;
  /** Warm the next page without committing — near-end prefetch (not on entry). */
  prefetchNextPage: () => void;
  productFilter: ProductFilters;
  /** True on /new — sort default is newest-first, not branding. */
  isNew: boolean;
  /** Search query on /search — empty sort means relevance (closest match). */
  search: string;
}

interface CollectionProviderProps {
  children: React.ReactNode;
  initialProducts: ProductSummaryFieldsFragment[];
  initialTotal: number;
  productFilter: ProductFilters;
  initialPage?: number;
  itemsPerPage?: number;
  onSale?: boolean | undefined;
  isNew?: boolean | undefined;
  search?: string | undefined;
  brandSlug?: string | undefined;
  categorySlug?: string | undefined;
  /** Base path for the collection (e.g. `/collections/hoodies`). When provided, attribute
   *  filters are encoded into the URL path as `/f/{slug}` and URL updates use
   *  `window.history.replaceState` instead of the Next.js router to avoid server re-renders. */
  categoryBasePath?: string | undefined;
  /** Attribute filter values decoded from the URL path by the server component. Takes
   *  precedence over search-param attributes when present. */
  initialFilterValues?: Record<string, string[]> | undefined;
  /** Brand values decoded from the URL path by the server component (06.1). When
   *  present, seeds `filterValues.brands` so the brand sidebar hydrates checked. */
  initialBrands?: string[] | undefined;
}

const CollectionContext = createContext<CollectionContextType | null>(null);

type PrefetchBuffer = {
  page: number;
  products: ProductSummaryFieldsFragment[];
  total: number;
};

/** Scroll the listing chrome into view after a full grid replace (sort/filter). */
function scrollCollectionToTop(): void {
  const el = document.querySelector<HTMLElement>("[data-headkit-collection]");
  if (el) {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function CollectionProvider({
  children,
  initialProducts,
  initialTotal,
  productFilter,
  initialPage = 1,
  itemsPerPage = 24,
  onSale,
  isNew,
  search,
  brandSlug,
  categorySlug,
  categoryBasePath,
  initialFilterValues,
  initialBrands,
}: CollectionProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { defaultCollectionSort } = useCatalogDisplay();
  // Filter / catalog updates are non-urgent — keep checkbox/toggle INP low (ENG-856).
  const [, startFilterTransition] = useTransition();
  // A SECOND transition, and the reason it is second rather than the first one
  // extended is a measured race, not a preference.
  //
  // The two have different jobs and, crucially, different lifetimes. The filter
  // transition ends when the new `filterValues` commit — which is what SCHEDULES
  // the effect the push lives in, so by the time the navigation starts that
  // transition is already finishing. Carrying the push in it means `isPending` dips
  // false between the two, and any flag lowered on that dip is lowered
  // mid-navigation: traced render by render in jsdom, the sequence is pending=true
  // (state commit) → pending=false (committed, push not yet started) → pending=true
  // (push in flight). A transition whose ONLY member is the push has no middle step.
  //
  // It is also what makes the exclusion structural rather than a condition somebody
  // has to keep true: nothing else is ever wrapped in it, so the skeleton cannot be
  // raised over a change served in place by `fetchProducts` — sort, price, in-stock,
  // category chips, Load More, Load Previous. Those already have their own in-grid
  // cue (`ProductGrid` keeps the cards the shopper is reading and appends a skeleton
  // row) and must keep it.
  //
  // What it gives that a link's own pending state cannot: a filter tick is not a
  // link click, so nothing in `InstantLink` fires for it, and React keeps a
  // transition pending across a `router.push` until the destination's RSC payload
  // has arrived and committed.
  const [, startNavigationTransition] = useTransition();

  const [products, setProducts] = useState(initialProducts);
  const [totalProducts, setTotalProducts] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBefore, setIsLoadingBefore] = useState(false);
  const [isLoadingAfter, setIsLoadingAfter] = useState(false);
  // A ref, not state: it is read only inside the effect below and never
  // rendered, and the mount correction makes that effect run twice — as state
  // it would add a render of its own between the two passes.
  const isInitialLoadRef = useRef(true);
  const [hasFirstPage, setHasFirstPage] = useState(initialPage === 1);
  const prevAttributeSlugRef = useRef<string | undefined>(undefined);
  // Loading flags live in refs so fetchProducts never closes over a stale
  // isLoadingAfter=true after a filter change mid-request (that bug made
  // load-more permanently no-op while the UI looked idle).
  const isLoadingRef = useRef(false);
  const isLoadingBeforeRef = useRef(false);
  const isLoadingAfterRef = useRef(false);
  // Synchronous mirror of products.length — written ONLY by commitProducts, never
  // in render (react-hooks/refs + discarded-render races). See
  // collection-load-more-count.test.tsx.
  const productsCountRef = useRef(initialProducts.length);
  const currentPageRef = useRef(initialPage);
  currentPageRef.current = currentPage;
  const totalProductsRef = useRef(initialTotal);
  totalProductsRef.current = totalProducts;
  const prefetchRef = useRef<PrefetchBuffer | null>(null);
  const prefetchInFlightRef = useRef<number | null>(null);

  const commitProducts = useCallback(
    (
      next:
        | ProductSummaryFieldsFragment[]
        | ((
            prev: ProductSummaryFieldsFragment[],
          ) => ProductSummaryFieldsFragment[]),
    ) => {
      setProducts((prev) => {
        const list = typeof next === "function" ? next(prev) : next;
        productsCountRef.current = list.length;
        return list;
      });
    },
    [],
  );

  // Seeded from PROPS ONLY, with no query string. This provider renders in the
  // static shell (outside every Suspense boundary), so it may not perform a
  // request-time read: `useSearchParams()` here turned the whole listing route
  // dynamic (ƒ, 0-byte shell) and hid the grid from JS-off shoppers and
  // non-rendering crawlers. The query state is corrected in the mount effect
  // below instead: page 1 in the store's default order is what the shell
  // carries, and no URL that needs the correction is canonical or in the
  // sitemap.
  const [filterValues, setFilterValues] = useState<FilterValues>(() =>
    deriveFilterValues(NO_SEARCH_PARAMS, {
      initialPage,
      productFilter,
      initialFilterValues,
      initialBrands,
    }),
  );
  const searchTermRef = useRef(search ?? "");
  const [activeSearch, setActiveSearch] = useState(search ?? "");

  const hasMore = products.length < totalProducts;

  const clearPrefetch = useCallback(() => {
    prefetchRef.current = null;
    prefetchInFlightRef.current = null;
  }, []);

  /**
   * Sync query/path. Append (Load More) omits `page` so a remount cannot
   * reinterpret `?page=N` as a single-page window and put Load More under a
   * short grid. Deep links still set `page` until the shopper appends further.
   */
  const syncUrl = useCallback(
    (
      page: number,
      filters: FilterValues,
      opts?: { omitPage?: boolean },
    ) => {
      const params = new URLSearchParams();
      if (searchTermRef.current) params.set("q", searchTermRef.current);
      if (page > 1 && !opts?.omitPage) params.set("page", page.toString());
      if (filters.categories.length)
        params.set("categories", filters.categories.join(","));
      // Brand is path-encoded (06.1) — NEVER a query param. It rides in the
      // `/f/` slug via encodeFilterSlug below. price/sort/page stay query.
      if (filters.instock) params.set("instock", "true");
      if (filters.sort) params.set("sort", filters.sort);
      if (filters.price_min) params.set("price_min", filters.price_min);
      if (filters.price_max) params.set("price_max", filters.price_max);

      // Always use replaceState for query/path sync during client pagination.
      // router.replace() remounts searchParams-driven Suspense islands (e.g.
      // /shop) and wipes the appended product list back to a single page.
      if (categoryBasePath) {
        const filterSlug = encodeFilterSlug(filters);
        const filterPath = filterSlug ? `/f/${filterSlug}` : "";
        const qs = params.toString();
        window.history.replaceState(
          null,
          "",
          `${categoryBasePath}${filterPath}${qs ? `?${qs}` : ""}`,
        );
      } else {
        for (const [slug, vals] of Object.entries(filters.attributes)) {
          if (vals.length) params.set(slug, vals.join(","));
        }
        const qs = params.toString();
        window.history.replaceState(
          null,
          "",
          `${pathname}${qs ? `?${qs}` : ""}`,
        );
      }
    },
    [categoryBasePath, pathname],
  );

  const buildListFilter = useCallback(
    (filters: FilterValues) => {
      const filter = buildProductListFilter(filters, {
        ...(categorySlug !== undefined ? { categorySlug } : {}),
        ...(brandSlug !== undefined ? { brandSlug } : {}),
        ...(onSale !== undefined ? { onSale } : {}),
        ...(isNew !== undefined ? { isNew } : {}),
        ...(searchTermRef.current ? { search: searchTermRef.current } : {}),
        ...(isNew
          ? { defaultSort: "CREATED_AT" as SortKeyType }
          : searchTermRef.current
            ? {}
            : {
                defaultSort: defaultCollectionSort as SortKeyType,
              }),
      });
      if (searchTermRef.current && !filters.sort?.trim()) {
        filter.orderby = "relevance";
        filter.order = "desc";
      }
      return filter;
    },
    [
      categorySlug,
      brandSlug,
      onSale,
      isNew,
      defaultCollectionSort,
    ],
  );

  const fetchProducts = useCallback(
    async (page: number, position: "before" | "after" | "middle") => {
      if (
        isLoadingRef.current ||
        isLoadingBeforeRef.current ||
        isLoadingAfterRef.current
      ) {
        return;
      }

      if (position === "before") {
        isLoadingBeforeRef.current = true;
        setIsLoadingBefore(true);
      } else if (position === "after") {
        isLoadingAfterRef.current = true;
        setIsLoadingAfter(true);
      } else {
        isLoadingRef.current = true;
        setIsLoading(true);
        clearPrefetch();
      }

      try {
        const result = await listCollectionProducts(
          buildListFilter(filterValues),
          page,
          itemsPerPage,
        );

        // Empty "after" page means we've exhausted the list — clamp the total
        // so hasMore flips false and the sentinel stops firing.
        if (position === "after" && result.products.length === 0) {
          setTotalProducts(productsCountRef.current);
          return;
        }

        // Commit product appends synchronously — do NOT wrap in startTransition.
        // Loading flags clear in `finally` as urgent updates; an urgent clear
        // after a transition-scheduled append interrupts that transition, so
        // Load More flickered "Loading…" then never grew the grid (ENG-856
        // regression). Filter checkbox INP still uses startFilterTransition.
        setCurrentPage(page);
        setTotalProducts(result.total);

        if (position === "middle") {
          commitProducts(result.products);
          setHasFirstPage(page === 1);
          syncUrl(page, filterValues);
          scrollCollectionToTop();
        } else if (position === "before") {
          commitProducts((prev) => [...result.products, ...prev]);
          if (page === 1) setHasFirstPage(true);
          syncUrl(page, filterValues);
        } else {
          commitProducts((prev) => [...prev, ...result.products]);
          // Omit page so remount/refresh cannot collapse to a single-page window.
          syncUrl(page, filterValues, { omitPage: true });
        }
      } catch {
        // Keep the previous product list; loading flags clear in finally so the
        // user can retry via the Load More button.
      } finally {
        if (position === "before") {
          isLoadingBeforeRef.current = false;
          setIsLoadingBefore(false);
        } else if (position === "after") {
          isLoadingAfterRef.current = false;
          setIsLoadingAfter(false);
        } else {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [
      filterValues,
      itemsPerPage,
      syncUrl,
      buildListFilter,
      commitProducts,
      clearPrefetch,
    ],
  );

  /**
   * Deep link `?page=N`: keep SSR page 1 and append 2…N so the grid is a
   * continuous list (Load Previous / short-window Load More never appear).
   */
  const hydrateThroughPage = useCallback(
    async (targetPage: number) => {
      if (targetPage <= 1) return;
      if (
        isLoadingRef.current ||
        isLoadingBeforeRef.current ||
        isLoadingAfterRef.current
      ) {
        return;
      }
      clearPrefetch();
      isLoadingAfterRef.current = true;
      setIsLoadingAfter(true);
      try {
        const filter = buildListFilter(filterValues);
        for (let page = 2; page <= targetPage; page++) {
          const result = await listCollectionProducts(
            filter,
            page,
            itemsPerPage,
          );
          if (result.products.length === 0) {
            setTotalProducts(productsCountRef.current);
            break;
          }
          setCurrentPage(page);
          setTotalProducts(result.total);
          commitProducts((prev) => [...prev, ...result.products]);
        }
        setHasFirstPage(true);
        // Keep `?page=` for shareable deep links until the shopper loads more.
        syncUrl(targetPage, filterValues);
      } catch {
        /* keep SSR page 1 */
      } finally {
        isLoadingAfterRef.current = false;
        setIsLoadingAfter(false);
      }
    },
    [
      filterValues,
      itemsPerPage,
      buildListFilter,
      commitProducts,
      syncUrl,
      clearPrefetch,
    ],
  );

  const loadMore = useCallback(() => {
    if (isLoadingAfterRef.current) return;
    if (productsCountRef.current >= totalProductsRef.current) return;
    const nextPage = currentPageRef.current + 1;
    const buffered = prefetchRef.current;
    if (buffered && buffered.page === nextPage) {
      prefetchRef.current = null;
      isLoadingAfterRef.current = true;
      setIsLoadingAfter(true);
      try {
        if (buffered.products.length === 0) {
          setTotalProducts(productsCountRef.current);
        } else {
          setCurrentPage(nextPage);
          setTotalProducts(buffered.total);
          commitProducts((prev) => [...prev, ...buffered.products]);
          syncUrl(nextPage, filterValues, { omitPage: true });
        }
      } finally {
        isLoadingAfterRef.current = false;
        setIsLoadingAfter(false);
      }
      return;
    }
    void fetchProducts(nextPage, "after");
  }, [fetchProducts, commitProducts, syncUrl, filterValues]);

  const loadPrevious = useCallback(() => {
    if (isLoadingBeforeRef.current || currentPageRef.current <= 1) return;
    void fetchProducts(currentPageRef.current - 1, "before");
  }, [fetchProducts]);

  const prefetchNextPage = useCallback(() => {
    const nextPage = currentPageRef.current + 1;
    if (productsCountRef.current >= totalProductsRef.current) return;
    if (prefetchRef.current?.page === nextPage) return;
    if (prefetchInFlightRef.current === nextPage) return;
    if (
      isLoadingAfterRef.current ||
      isLoadingRef.current ||
      isLoadingBeforeRef.current
    ) {
      return;
    }

    prefetchInFlightRef.current = nextPage;
    const filter = buildListFilter(filterValues);
    void listCollectionProducts(filter, nextPage, itemsPerPage)
      .then((result) => {
        if (prefetchInFlightRef.current !== nextPage) return;
        prefetchRef.current = {
          page: nextPage,
          products: result.products,
          total: result.total,
        };
      })
      .catch(() => {
        /* leave buffer empty — loadMore will fetch on demand */
      })
      .finally(() => {
        if (prefetchInFlightRef.current === nextPage) {
          prefetchInFlightRef.current = null;
        }
      });
  }, [buildListFilter, filterValues, itemsPerPage]);

  useEffect(() => {
    const newAttributeSlug = encodeFilterSlug(filterValues);
    // Capture BEFORE overwriting, and record the slug on the initial pass too.
    // The mount effect below can replace `filterValues` immediately, and a
    // `prevAttributeSlugRef` still holding `undefined` at that point compares
    // unequal to the empty slug and pushes a pointless navigation.
    const previousAttributeSlug = prevAttributeSlugRef.current;
    prevAttributeSlugRef.current = newAttributeSlug;

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    clearPrefetch();

    if (categoryBasePath && newAttributeSlug !== previousAttributeSlug) {
      // Attribute/brand filters changed — navigate to the new filter path so the
      // server renders the correct products from cache (static per filter combo).
      // Brand is part of newAttributeSlug now (06.1), so toggling a brand drives
      // a path change, not a query param.
      const filterPath = newAttributeSlug ? `/f/${newAttributeSlug}` : "";
      const params = new URLSearchParams();
      if (searchTermRef.current) params.set("q", searchTermRef.current);
      if (filterValues.categories.length)
        params.set("categories", filterValues.categories.join(","));
      // Brand omitted from query (06.1) — it lives in filterPath.
      if (filterValues.instock) params.set("instock", "true");
      if (filterValues.sort) params.set("sort", filterValues.sort);
      if (filterValues.price_min) params.set("price_min", filterValues.price_min);
      if (filterValues.price_max) params.set("price_max", filterValues.price_max);
      const qs = params.toString();
      // Concise body, so whatever `router.push` returns is the transition's result.
      // Today that is `undefined` and React treats the scope as an ordinary sync
      // transition, which is what production runs; if a future Next returns a
      // thenable, awaiting it is the correct behaviour rather than a surprise. It is
      // also the seam a guard uses — a mocked `push` returning a promise is the only
      // way to hold a transition open in jsdom, where there is no router to suspend
      // on a real payload.
      startNavigationTransition(() =>
        router.push(`${categoryBasePath}${filterPath}${qs ? `?${qs}` : ""}`),
      );
      return;
    }

    const targetPage = filterValues.page;
    // Deep link / remount with ?page=N while SSR still holds page 1: accumulate
    // rather than replace with a short window (Load More-at-top defect).
    if (targetPage > 1 && hasFirstPage && currentPageRef.current === 1) {
      void hydrateThroughPage(targetPage);
      return;
    }

    void fetchProducts(targetPage, "middle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterValues]);

  // The query-state correction. The provider is seeded without a query string
  // so the route can prerender (see the `filterValues` initial state above);
  // `?page=`, `?sort=`, `?q=`, `?price_min=`, `?price_max=`, `?instock=`,
  // `?categories=` and the legacy query-facet forms are applied here, on mount,
  // from `window.location.search`. Reading that during render would be a
  // hydration mismatch, so it has to be an effect.
  //
  // Setting `filterValues` is all this does: the effect above already knows how
  // to reconcile a change — one `listCollectionProducts` round trip for a query
  // change, or a `router.push` to `/f/<slug>` for a legacy query facet. Page 1
  // is visible for that round trip's duration, and permanently with JS off.
  // Accepted: none of these URLs is canonical, none is in the sitemap, and each
  // is produced by this grid's own `history.replaceState` rather than linked to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const corrected = deriveFilterValues(params, {
      initialPage,
      productFilter,
      initialFilterValues,
      initialBrands,
    });
    const nextSearch = searchTermFromQuery(search, params);
    const searchChanged = nextSearch !== searchTermRef.current;
    if (searchChanged) {
      searchTermRef.current = nextSearch;
      setActiveSearch(nextSearch);
    }
    let filtersChanged = false;
    setFilterValues((current) => {
      if (sameFilterValues(current, corrected)) return current;
      filtersChanged = true;
      return corrected;
    });
    // A query alone (`/search?q=`) does not change filter values, so fetch here.
    if (searchChanged && !filtersChanged) {
      void fetchProducts(corrected.page, "middle");
    }
    // Mount only — later URL changes come from this provider itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // A colour click is `router.push` to `/f/<slug>`. Those URLs are not built
  // at deploy time, so the first open is a cold function render. Bare collections
  // are already a prerender HIT. Warm the top colours while the shopper is still
  // reading, but not during LCP: a short timer from mount used to prefetch eight
  // colour routes while the hero image was still loading. Eight, not every
  // option: a full sweep made the click they were meant to speed up slower.
  useEffect(() => {
    if (!categoryBasePath) return;
    if (typeof router.prefetch !== "function") return;
    const colorAttr = productFilter.attributes?.find(
      (attr) => attr?.slug && isColorAttrSlug(attr.slug),
    );
    if (!colorAttr?.slug) return;
    const key = toAttributeKey(colorAttr.slug);
    const hrefs = [...(colorAttr.options ?? [])]
      .flatMap((option) => (option?.slug ? [option] : []))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .flatMap((option) => {
        const slug = encodeFilterSlug({
          ...DEFAULT_FILTER_VALUES,
          attributes: { [key]: [option.slug] },
        });
        if (!slug) return [];
        const href = `${categoryBasePath}/f/${slug}`;
        return href === pathname ? [] : [href];
      });
    if (hrefs.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const warm = (): void => {
      if (cancelled) return;
      timer = setTimeout(() => {
        for (const href of hrefs) router.prefetch(href);
      }, 3500);
    };
    if (document.readyState === "complete") warm();
    else window.addEventListener("load", warm, { once: true });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("load", warm);
    };
  }, [categoryBasePath, pathname, productFilter, router]);


  // `/search` prerenders the unfiltered catalog. A `?q=` visit used to paint
  // that catalog and then replace it when this effect's fetch returned.
  // Hide that grid until the query's own products have committed. A later
  // sort or filter refresh must not hide results again — `settled` sticks.
  const searchHoldRef = useRef({
    fetchSeen: false,
    settled: false,
    serverMatched: null as boolean | null,
  });
  useLayoutEffect(() => {
    const urlQuery = new URLSearchParams(window.location.search).get("q") ?? "";
    const decision = nextSearchHold({
      urlQuery,
      appliedQuery: activeSearch,
      isLoading,
      fetchSeen: searchHoldRef.current.fetchSeen,
      settled: searchHoldRef.current.settled,
      serverMatched: searchHoldRef.current.serverMatched,
    });
    searchHoldRef.current = {
      fetchSeen: decision.fetchSeen,
      settled: decision.settled,
      serverMatched: decision.serverMatched,
    };
    if (decision.hold) {
      document.documentElement.setAttribute("data-search-query", "1");
    } else {
      document.documentElement.removeAttribute("data-search-query");
    }
    return () => {
      document.documentElement.removeAttribute("data-search-query");
    };
  }, [isLoading, activeSearch]);

  const setFilterValuesDeferred = useCallback(
    (values: FilterValues) => {
      startFilterTransition(() => {
        setFilterValues(values);
      });
    },
    [startFilterTransition],
  );

  const clearFilters = useCallback(() => {
    startFilterTransition(() => {
      setFilterValues({ ...DEFAULT_FILTER_VALUES, page: 1 });
    });
  }, [startFilterTransition]);


  return (
    <CollectionContext.Provider
      value={{
        products,
        totalProducts,
        currentPage,
        itemsPerPage,
        isLoading,
        isLoadingBefore,
        isLoadingAfter,
        hasMore,
        hasFirstPage,
        filterValues,
        setFilterValues: setFilterValuesDeferred,
        clearFilters,
        loadMore,
        loadPrevious,
        prefetchNextPage,
        productFilter,
        isNew: Boolean(isNew),
        search: activeSearch,
      }}
    >
      {children}
    </CollectionContext.Provider>
  );
}

export function useCollection(): CollectionContextType {
  const ctx = useContext(CollectionContext);
  if (!ctx)
    throw new Error("useCollection must be used within CollectionProvider");
  return ctx;
}

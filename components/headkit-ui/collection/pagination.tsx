"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCollection } from "./collection-context";

/** Prefetch the next page when the sentinel is this far below the viewport. */
const PREFETCH_ROOT_MARGIN = "1800px";
/** Auto-load when the sentinel is this far below the viewport. */
const LOAD_ROOT_MARGIN = "400px";

/**
 * Infinite scroll sentinel — triggers loadMore() when the element
 * becomes visible in the viewport. Falls back to a manual button
 * if IntersectionObserver is not available or the user prefers
 * reduced motion. Near-end prefetch warms the next page without
 * committing (Lighthouse-safe: not on entry).
 */
export function LoadMore() {
  const { hasMore, isLoadingAfter, loadMore, prefetchNextPage, currentPage } =
    useCollection();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  const prefetchRef = useRef(prefetchNextPage);
  const hasMoreRef = useRef(hasMore);
  const isLoadingAfterRef = useRef(isLoadingAfter);
  const [autoScrollActive, setAutoScrollActive] = useState(false);

  // Keep observer callbacks current without writing refs during render
  // (eslint react-hooks/refs — "Cannot access refs during render").
  useEffect(() => {
    loadMoreRef.current = loadMore;
    prefetchRef.current = prefetchNextPage;
    hasMoreRef.current = hasMore;
    isLoadingAfterRef.current = isLoadingAfter;
  }, [loadMore, prefetchNextPage, hasMore, isLoadingAfter]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) {
      setAutoScrollActive(false);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setAutoScrollActive(false);
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      setAutoScrollActive(false);
      return;
    }

    setAutoScrollActive(true);

    // Re-bind only when the page advances (successful append) or hasMore
    // changes — NOT when isLoadingAfter flips. Re-observing on every failed
    // fetch caused a CORS/error retry storm that left the button stuck on
    // "Loading…".
    const loadObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry?.isIntersecting &&
          hasMoreRef.current &&
          !isLoadingAfterRef.current
        ) {
          loadMoreRef.current();
        }
      },
      {
        rootMargin: LOAD_ROOT_MARGIN,
        threshold: 0,
      },
    );

    // Wider margin: warm the next page while the shopper is still scrolling,
    // so Load More / auto-append feels instant. Does not fire on first paint
    // unless the grid is shorter than the viewport + buffer.
    const prefetchObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasMoreRef.current) {
          prefetchRef.current();
        }
      },
      {
        rootMargin: PREFETCH_ROOT_MARGIN,
        threshold: 0,
      },
    );

    loadObserver.observe(sentinel);
    prefetchObserver.observe(sentinel);
    return () => {
      loadObserver.disconnect();
      prefetchObserver.disconnect();
    };
  }, [hasMore, currentPage]);

  if (!hasMore) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Sentinel for IntersectionObserver */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      {/* Manual fallback when auto-scroll is off (reduced motion / no IO). */}
      {!autoScrollActive && (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={isLoadingAfter}
          className="w-full max-w-xs"
        >
          {isLoadingAfter ? "Loading…" : "Load More"}
        </Button>
      )}
    </div>
  );
}

export function LoadPrevious() {
  const { hasFirstPage, isLoadingBefore, currentPage, loadPrevious } =
    useCollection();
  if (hasFirstPage || currentPage <= 1) return null;
  return (
    <div className="flex justify-center px-5 md:px-10">
      <Button
        variant="outline"
        onClick={loadPrevious}
        disabled={isLoadingBefore}
        className="w-full max-w-xs"
      >
        {isLoadingBefore ? "Loading…" : "Load Previous"}
      </Button>
    </div>
  );
}

export function ProductCount() {
  const { products, totalProducts } = useCollection();
  if (!totalProducts) return null;
  // Count parent Woo products (pagination unit), not expanded colourway cards.
  return (
    <p className="text-sm text-gray-800">
      Viewing {products.length} of {totalProducts} products
    </p>
  );
}

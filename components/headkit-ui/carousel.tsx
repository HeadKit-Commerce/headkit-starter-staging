"use client";

import { cn } from "@/lib/utils";
import { Children, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icon";

interface CarouselProps<T> {
  /**
   * Server-rendered slides. Pass these instead of `renderItem` so the slide
   * markup stays a Server Component and is not part of this client module.
   * https://nextjs.org/docs/app/getting-started/server-and-client-components
   */
  children?: ReactNode;
  items?: T[];
  renderItem?: (item: T, index: number) => ReactNode;
  carouselItemClassName?: string;
  id?: string;
  className?: string;
  gap?: string;
  padding?: string;
  /** Extra classes on the horizontal scroll track (e.g. `justify-center`). */
  trackClassName?: string;
  /**
   * Apply `justify-center` only when all items fit (no overflow).
   * Avoids the mobile bug where `justify-center` + overflow hides the first item.
   */
  centerWhenFits?: boolean;
  itemSizing?: {
    base: string;
    sm?: string;
    lg?: string;
    /** Extra-wide screens (e.g. 4 columns when lg is 3). */
    xl?: string;
    "2xl"?: string;
  };
  showControls?: boolean;
  showScrollbar?: boolean;
  showPagination?: boolean;
  paginationDotClassName?: string;
  paginationClassName?: string;
  controlsPosition?: "top" | "bottom";
  scrollAmount?: number;
  autoplay?: {
    enabled: boolean;
    delay?: number;
    stopOnInteraction?: boolean;
  };
  loop?: boolean;
  useScrollSnap?: boolean;
  /**
   * `slide` (default): horizontal scroll. `fade`: cross-fade stacked slides
   * (used by hero carousels — no horizontal motion).
   */
  transition?: "slide" | "fade";
  onSlideChange?: (index: number) => void;
  /** Stable React key per item. Defaults to index (avoid for remount-sensitive cards). */
  itemKey?: (item: T, index: number) => string | number;
}

const Carousel = <T,>({
  items,
  renderItem,
  children,
  carouselItemClassName,
  id = "carousel",
  className,
  gap = "gap-[30px]",
  padding = "px-5 md:px-10",
  trackClassName,
  centerWhenFits = false,
  itemSizing = {
    // ~1.1 / 2 / 3 columns through xl (~1280–1535); 4 columns at 2xl+
    base: "w-[calc(91.666667%-15px)]",
    sm: "sm:w-[calc(50%-15px)]",
    lg: "lg:w-[calc(33.333333%-20px)]",
    "2xl": "2xl:w-[calc(25%-22.5px)]",
  },
  showControls = true,
  showScrollbar = true,
  showPagination = false,
  paginationDotClassName = "bg-gray-300",
  paginationClassName,
  controlsPosition = "top",
  scrollAmount = 0.5,
  autoplay,
  loop = false,
  useScrollSnap = false,
  transition = "slide",
  onSlideChange,
  itemKey,
}: CarouselProps<T>) => {
  const usingChildren = children != null;
  const filteredItems = usingChildren
    ? Children.toArray(children)
    : items?.filter((item) => item !== null && item !== undefined) || [];
  const isFade = transition === "fade";
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  // The first paint is already the active slide. Adding the 1s cross-fade
  // only after mount keeps that paint from waiting out the transition.
  const [fadeReady, setFadeReady] = useState(false);
  useEffect(() => {
    setFadeReady(true);
  }, []);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /** True only after measure shows items fit — never center before that (mobile overflow). */
  const [fitsViewport, setFitsViewport] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateScrollState = useCallback(() => {
    if (isFade) return;
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;
    const overflows = scrollWidth > clientWidth + 1;
    setCanScroll(overflows);
    setFitsViewport(!overflows);
    setCanScrollPrev(scrollLeft > 0);
    setCanScrollNext(scrollLeft < scrollWidth - clientWidth - 1);
    setScrollProgress(overflows ? scrollLeft / (scrollWidth - clientWidth) : 0);
    if (useScrollSnap) {
      // Each snap slide spans the full container, so a slide's width is the
      // total scrollable width divided by the slide count. Clamp so the active
      // index never overflows the pagination dots.
      const itemWidth = scrollWidth / filteredItems.length;
      const rawIndex = itemWidth > 0 ? Math.round(scrollLeft / itemWidth) : 0;
      const newIndex = Math.min(
        Math.max(rawIndex, 0),
        filteredItems.length - 1,
      );
      setCurrentIndex(newIndex);
      if (onSlideChange && newIndex !== currentIndex) {
        onSlideChange(newIndex);
      }
    }
  }, [
    isFade,
    useScrollSnap,
    filteredItems.length,
    currentIndex,
    onSlideChange,
  ]);

  const getItemWidth = useCallback(() => {
    if (!containerRef.current) return 0;
    const itemElement = containerRef.current.querySelector(`#${id}-item-0`);
    return itemElement ? (itemElement as HTMLElement).clientWidth : 0;
  }, [id]);

  const goToIndex = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), filteredItems.length - 1);
      if (clamped === currentIndex) return;
      setCurrentIndex(clamped);
      onSlideChange?.(clamped);
    },
    [currentIndex, filteredItems.length, onSlideChange],
  );

  const scrollTo = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      if (isFade) {
        goToIndex(index);
        return;
      }
      if (!containerRef.current) return;
      const itemWidth = getItemWidth();
      const gapValue = parseInt(gap.replace("gap-", "")) || 0;
      const scrollLeft = index * (itemWidth + gapValue);
      containerRef.current.scrollTo({ left: scrollLeft, behavior });
      setCurrentIndex(index);
    },
    [gap, getItemWidth, goToIndex, isFade],
  );

  const scrollNext = useCallback(() => {
    // Single-item carousels have nowhere to advance; looping back to 0 still
    // fires onSlideChange and is wasteful (hero video handles its own loop).
    if (filteredItems.length <= 1) return;
    let nextIndex = currentIndex + 1;
    // Index-based boundary: the previous scrollLeft comparison treated the
    // last slide as out-of-range, so full-width heroes never advanced past
    // slide 0 when loop was false.
    if (nextIndex >= filteredItems.length) {
      if (loop) {
        nextIndex = 0;
      } else {
        return;
      }
    }
    scrollTo(nextIndex);
  }, [currentIndex, loop, scrollTo, filteredItems.length]);

  const scrollPrev = useCallback(() => {
    if (filteredItems.length === 0) return;
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      if (loop) {
        prevIndex = filteredItems.length - 1;
      } else {
        return;
      }
    }
    scrollTo(prevIndex);
  }, [currentIndex, loop, scrollTo, filteredItems.length]);

  const stopAutoplay = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startAutoplay = useCallback(() => {
    if (autoplay?.enabled && autoplay.delay && !isHovered && !isDragging) {
      stopAutoplay();
      intervalRef.current = setInterval(() => {
        scrollNext();
      }, autoplay.delay);
    }
  }, [autoplay, isHovered, isDragging, scrollNext]);

  const scrollToPrev = () => {
    if (isFade) {
      scrollPrev();
      return;
    }
    if (!containerRef.current) return;
    const scrollAmountPx = containerRef.current.clientWidth * scrollAmount;
    containerRef.current.scrollBy({
      left: -scrollAmountPx,
      behavior: "smooth",
    });
  };

  const scrollToNext = () => {
    if (isFade) {
      scrollNext();
      return;
    }
    if (!containerRef.current) return;
    const scrollAmountPx = containerRef.current.clientWidth * scrollAmount;
    containerRef.current.scrollBy({ left: scrollAmountPx, behavior: "smooth" });
  };

  useEffect(() => {
    if (isFade) {
      const multi = filteredItems.length > 1;
      setCanScroll(multi);
      setCanScrollPrev(loop || currentIndex > 0);
      setCanScrollNext(loop || currentIndex < filteredItems.length - 1);
      setFitsViewport(true);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    updateScrollState();
    container.addEventListener("scroll", updateScrollState);
    return () => container.removeEventListener("scroll", updateScrollState);
  }, [isFade, updateScrollState, filteredItems.length, currentIndex, loop]);

  useEffect(() => {
    if (autoplay?.enabled) startAutoplay();
    return () => stopAutoplay();
  }, [autoplay?.enabled, startAutoplay]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (autoplay?.stopOnInteraction) stopAutoplay();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    startAutoplay();
  };

  const scrollToProgress = (progress: number) => {
    if (!containerRef.current) return;
    const { scrollWidth, clientWidth } = containerRef.current;
    containerRef.current.scrollTo({
      left: progress * (scrollWidth - clientWidth),
      behavior: "smooth",
    });
  };

  const itemSizeClasses = [
    itemSizing.base,
    itemSizing.sm,
    itemSizing.lg,
    itemSizing.xl,
    itemSizing["2xl"],
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cn("relative w-full", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
    >
      {isFade ? (
        <div
          ref={containerRef}
          className={cn("relative w-full", padding, trackClassName)}
        >
          {/* Stack slides in one grid cell so height follows the tallest slide
              and inactive slides soft-fade via opacity (no horizontal motion). */}
          <div className="grid w-full [&>*]:col-start-1 [&>*]:row-start-1">
            {filteredItems.map((item, index) => {
              const active = index === currentIndex;
              const multi = filteredItems.length > 1;
              return (
                <div
                  key={usingChildren || !itemKey ? index : itemKey(item as T, index)}
                  id={`${id}-item-${index}`}
                  aria-hidden={!active}
                  // `aria-hidden` alone is a contradiction while the slide's
                  // links stay focusable: the keyboard lands on a slide the
                  // shopper cannot see (Lighthouse `aria-hidden-focus`).
                  // `inert` takes the whole subtree out of the focus order and
                  // the accessibility tree together, so it cannot drift out of
                  // sync the way a per-descendant `tabIndex` sweep can. It
                  // changes no layout and no paint, so the 1s opacity
                  // cross-fade below is untouched.
                  inert={!active}
                  className={cn(
                    "w-full",
                    // Opacity crossfade only when there is another slide to
                    // blend with — a single slide must stay fully opaque.
                    multi &&
                      fadeReady &&
                      "transition-opacity duration-1000 ease-in-out",
                    active
                      ? "z-10 opacity-100"
                      : "pointer-events-none z-0 opacity-0",
                    carouselItemClassName,
                  )}
                >
                  {usingChildren ? (item as ReactNode) : renderItem?.(item as T, index)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={cn(
            // Vertical padding keeps selected swatch outlines inside overflow parents
            "flex overflow-x-auto scroll-smooth py-2",
            gap,
            padding,
            trackClassName,
            centerWhenFits && fitsViewport && "justify-center",
            useScrollSnap && "snap-x snap-mandatory",
            "[&::-webkit-scrollbar]:hidden",
          )}
        >
          {filteredItems.map((item, index) => (
            <div
              key={usingChildren || !itemKey ? index : itemKey(item as T, index)}
              id={`${id}-item-${index}`}
              className={cn(
                "flex-none",
                useScrollSnap && "snap-start",
                itemSizeClasses,
                carouselItemClassName,
              )}
            >
              {usingChildren ? (item as ReactNode) : renderItem?.(item as T, index)}
            </div>
          ))}
        </div>
      )}

      {canScroll && showControls && (
        <div
          className={cn(
            "absolute flex gap-4 justify-end items-center",
            padding,
            controlsPosition === "top"
              ? "-top-[32px] right-0"
              : "bottom-4 right-0",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-none bg-transparent shadow-none hover:bg-transparent hidden md:flex items-center justify-center"
            disabled={!canScrollPrev}
            onClick={scrollToPrev}
          >
            <ChevronLeftIcon
              className={cn(
                "h-5 w-5 text-primary transition-opacity hover:opacity-70",
                !canScrollPrev && "text-gray-300",
              )}
            />
            <span className="sr-only">Previous slide</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-none bg-transparent shadow-none hover:bg-transparent hidden md:flex items-center justify-center"
            disabled={!canScrollNext}
            onClick={scrollToNext}
          >
            <ChevronRightIcon
              className={cn(
                "h-5 w-5 text-primary transition-opacity hover:opacity-70",
                !canScrollNext && "text-gray-300",
              )}
            />
            <span className="sr-only">Next slide</span>
          </Button>
        </div>
      )}

      {canScroll && showScrollbar && (
        <div className={cn("mt-4 md:mt-6", padding)}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={scrollProgress}
            onChange={(e) => scrollToProgress(parseFloat(e.target.value))}
            aria-label="Carousel scroll"
            style={{ ["--thumb-w" as string]: "25%" }}
            className={cn(
              "w-full h-1 cursor-pointer appearance-none bg-transparent",
              "[&::-webkit-slider-runnable-track]:h-[1px] [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-webkit-slider-runnable-track]:border [&::-webkit-slider-runnable-track]:border-[rgba(220,220,220,1)]",
              "[&::-moz-range-track]:h-[1px] [&::-moz-range-track]:bg-transparent",
              "[&::-moz-range-track]:border [&::-moz-range-track]:border-[rgba(220,220,220,1)]",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[1px] [&::-webkit-slider-thumb]:w-[var(--thumb-w)]",
              "[&::-webkit-slider-thumb]:-mt-[1px] [&::-webkit-slider-thumb]:rounded-none",
              "[&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary",
              "[&::-webkit-slider-thumb]:shadow-none [&::-webkit-slider-thumb]:outline-none",
              "[&::-moz-range-thumb]:h-[1px] [&::-moz-range-thumb]:w-[var(--thumb-w)] [&::-moz-range-thumb]:rounded-none",
              "[&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary",
              "[&::-moz-range-thumb]:shadow-none [&::-moz-range-thumb]:outline-none",
            )}
          />
        </div>
      )}

      {showPagination && (
        <div
          className={cn(
            "absolute inset-x-0 z-20 flex justify-center",
            paginationClassName,
          )}
        >
          {filteredItems.map((_, index) => (
            // 24x24 hit area (WCAG target-size); the visual dot stays 8px.
            <button
              key={index}
              onClick={() => scrollTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              className="flex h-6 w-6 items-center justify-center cursor-pointer"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  paginationDotClassName,
                  currentIndex === index && "bg-white",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export { Carousel };

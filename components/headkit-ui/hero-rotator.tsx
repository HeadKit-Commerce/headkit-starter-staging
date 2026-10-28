"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Multi-slide hero controls only. The slides themselves are Server
 * Components passed as children, so the largest image is not part of
 * this client module.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 *
 * EVERY SLIDE IS LAID OUT, ALWAYS — that is what gives the hero a stable
 * height. Putting `hidden` (`display: none`) on the inactive slides lays out
 * only the active one, so the container's height tracks whatever text that
 * slide happens to carry: on a phone the title's line count and the
 * description's length move the hero by tens of pixels every 5 s, and the
 * document moves with it (layout shift).
 *
 * It is MOBILE-ONLY because the text column sits in flow below the image
 * (`flex-col-reverse` in `main-carousel.tsx`); from `md` up it is `md:absolute`
 * over the image, so the slide's height is the media box's and every slide
 * already agrees.
 *
 * The slides are therefore stacked in ONE grid cell (`[grid-area:1/1]`) and
 * hidden with `invisible`/`opacity-0`, never `display: none`, so the container
 * resolves to the TALLEST slide and stops moving.
 *
 * An inactive slide stays in the layout, so it must be `inert`: `invisible` and
 * `aria-hidden` do nothing for the keyboard, and every CTA inside a hidden
 * slide would otherwise stay in the tab order — the contradiction Lighthouse
 * reports as `aria-hidden-focus`. `inert` is driven by the same expression
 * `aria-hidden` uses so the two can never disagree. `carousel.inert.test.tsx`
 * holds both directions.
 */
export function HeroRotator({
  children,
  paginationClassName,
}: {
  children: ReactNode;
  /** Where the dot row sits — `heroPaginationClasses` in `lib/hero-layout.ts`. */
  paginationClassName?: string;
}): React.JSX.Element {
  const slides = Children.toArray(children);
  const [index, setIndex] = useState(0);

  // A timeout keyed on the CURRENT index rather than one long-lived interval,
  // so a shopper who picks a slide from the pagination gets the full dwell on
  // it instead of however much of the tick happened to be left. Autoplay's
  // cadence is unchanged (5 s per slide) when nobody touches it.
  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setTimeout(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 5000);
    return () => window.clearTimeout(id);
  }, [index, slides.length]);

  return (
    <div className="relative grid">
      {slides.map((slide, slideIndex) => {
        const active = slideIndex === index;
        return (
          <div
            key={slideIndex}
            id={`carousel-item-${slideIndex}`}
            className={cn(
              "[grid-area:1/1]",
              active ? "opacity-100" : "invisible opacity-0",
            )}
            aria-hidden={!active}
            inert={!active}
          >
            {slide}
          </div>
        );
      })}

      {slides.length > 1 && (
        <div
          // Centred 10 px dots on an 18 px pitch (10 + `gap-2`), riding inside
          // the image's bottom edge on mobile and 20 px above the hero's from
          // `md` up. The offset itself is the caller's, because it depends on
          // the shell variant — `heroPaginationClasses` in `lib/hero-layout.ts`
          // carries it and the arithmetic behind it.
          //
          // z-10, not higher: it only has to beat the slide it sits over, and
          // at z-20 it would tie with the sticky nav and paint through it.
          className={cn(
            "absolute left-1/2 z-10 flex -translate-x-1/2 flex-wrap justify-center gap-2",
            paginationClassName ?? "top-[87vw] md:top-auto md:bottom-5",
          )}
        >
          {slides.map((_, slideIndex) => (
            <button
              key={slideIndex}
              type="button"
              onClick={() => setIndex(slideIndex)}
              aria-label={`Go to slide ${slideIndex + 1}`}
              aria-current={slideIndex === index}
              // The dot IS the 10 px box, so the row's geometry stays exact.
              // The tap target is a `::before` at `-inset-[7px]` (24x24, the
              // WCAG target-size floor) rather than padding on the button,
              // because padding would widen the box and take the pitch from
              // 18 px to 32.
              className={cn(
                "relative h-[10px] w-[10px] cursor-pointer rounded-full bg-white transition-opacity",
                "before:absolute before:-inset-[7px] before:content-['']",
                slideIndex === index ? "opacity-100" : "opacity-50",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

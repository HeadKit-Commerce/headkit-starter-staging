"use client";

import { getImageProps } from "next/image";
import { ElementType, useState } from "react";
import { HeroVideoSlide } from "@/components/headkit-ui/hero-video-slide";
import { Carousel } from "@/components/headkit-ui/carousel";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { TitleEmphasis } from "@/components/headkit-ui/title-emphasis";
import { Button } from "@/components/ui/button";
import type { HeroCarouselItem } from "@headkit/sdk";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { decodeHtmlEntities, cn } from "@/lib/utils";
import {
  heroLayoutClasses,
  heroMediaClasses,
  type HeroLayout,
} from "@/lib/store-theme";

interface Props {
  carouselItems: HeroCarouselItem[];
  /** Shell variant — defaults to inset when omitted (starter template). */
  heroLayout?: HeroLayout;
}

type HeroSlide = HeroCarouselItem & {
  video?: string | null;
  mobileVideo?: string | null;
};

function slideVideo(slide: HeroSlide, mobile: boolean): string {
  if (mobile) {
    return slide.mobileVideo || slide.video || "";
  }
  return slide.video || "";
}

export const MainCarousel = ({
  carouselItems,
  heroLayout = "inset",
}: Props) => {
  // Schedule windows are applied in WordPress (headkit_query_active_carousels).
  const items = carouselItems as HeroSlide[];
  const [activeIndex, setActiveIndex] = useState(0);

  if (items.length === 0) return null;

  const shellClass = heroLayoutClasses(heroLayout);
  const mediaClass = heroMediaClasses(heroLayout);

  return (
    <div className={cn("headkit-hero-carousel overflow-hidden", shellClass)}>
      <Carousel
        items={items}
        onSlideChange={setActiveIndex}
        renderItem={(carousel, index) => {
          const slide = carousel as HeroSlide;
          const HeaderTag: ElementType = index === 0 ? "h1" : "h2";
          const desktopVideo = slideVideo(slide, false);
          const mobileVideo = slideVideo(slide, true);
          const hasVideo = Boolean(desktopVideo || mobileVideo);
          const isActive = index === activeIndex;

          return (
            <div className="basis-full w-full relative">
              <div
                className={cn(
                  "relative flex flex-col-reverse overflow-hidden md:flex-col",
                  heroLayout === "inset" ? "rounded-brand" : "rounded-none",
                )}
              >
                <div className="z-10 h-full w-full md:absolute">
                  <div className="mx-auto flex h-full items-center">
                    <div className="py-[20px] md:w-[400px] md:pl-[20px] lg:w-[600px] lg:pl-[100px]">
                      <HeaderTag className="text-[40px] leading-normal text-primary md:text-[48px] md:text-brand-bg!">
                        <TitleEmphasis text={slide?.header ?? ""} highlight />
                      </HeaderTag>
                      {slide?.description ? (
                        <p className="mt-8 text-base font-semibold text-black md:text-3xl md:text-brand-bg!">
                          {decodeHtmlEntities(slide.description)}
                        </p>
                      ) : null}
                      <div className="mt-8">
                        <InstantLink href={slide?.url ?? "#"}>
                          <Button className="text-brand-bg">
                            {slide?.buttonText}
                          </Button>
                        </InstantLink>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Desktop: prefer 16:9; cap height so ultrawide never overflows
                    the fold (object-cover crops within the box). Mobile stays square. */}
                <div className={mediaClass}>
                  {hasVideo ? (
                    <>
                      {/* Poster is the LCP image. The MP4 starts after load. */}
                      <HeroVideoSlide
                        mobileSrc={mobileVideo}
                        desktopSrc={desktopVideo}
                        posterSrc={slide.mobileImage || slide.image}
                        desktopPosterSrc={slide.image}
                        posterAlt={stripTitleMarkers(decodeHtmlEntities(slide.header ?? ""))}
                        isLcp={index === 0}
                        isActive={isActive}
                      />
                      <div
                        aria-hidden
                        className="absolute inset-0 hidden md:block bg-gradient-to-r from-black/50 via-black/25 to-transparent"
                      />
                    </>
                  ) : slide?.image ? (
                    (() => {
                      const isLcp = index === 0;
                      const headerAlt = stripTitleMarkers(
                        decodeHtmlEntities(slide.header ?? ""),
                      );
                      const desktop = {
                        alt: headerAlt,
                        sizes: "100vw",
                        width: 1920,
                        height: 1080,
                        // Desktop can afford slightly higher quality; mobile LCP
                        // path stays leaner under Slow 4G (~65 vs 75).
                        quality: 75 as const,
                        priority: isLcp,
                        fetchPriority: (isLcp ? "high" : "auto") as
                          | "high"
                          | "auto",
                      };
                      const {
                        props: { srcSet: desktopSrcSet, sizes: desktopSizes },
                      } = getImageProps({ ...desktop, src: slide.image });
                      // Prefer a real mobile asset when CMS provides one; fall
                      // back to the desktop image at a smaller encode budget.
                      const mobileSrc = slide.mobileImage || slide.image;
                      const {
                        props: { srcSet: mobileSrcSet, ...mobileRest },
                      } = getImageProps({
                        alt: headerAlt,
                        sizes: "100vw",
                        width: 768,
                        height: 768,
                        quality: 65 as const,
                        priority: isLcp,
                        fetchPriority: (isLcp ? "high" : "auto") as
                          | "high"
                          | "auto",
                        src: mobileSrc,
                      });
                      return (
                        <>
                          <picture>
                            <source
                              media="(min-width: 768px)"
                              srcSet={desktopSrcSet}
                              sizes={desktopSizes}
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              {...mobileRest}
                              srcSet={mobileSrcSet}
                              alt={headerAlt}
                              className="h-full w-full object-cover"
                              width={768}
                              height={768}
                              fetchPriority={isLcp ? "high" : "auto"}
                              decoding={isLcp ? "sync" : "async"}
                            />
                          </picture>
                          <div
                            aria-hidden
                            className="absolute inset-0 hidden md:block bg-gradient-to-r from-black/50 via-black/25 to-transparent"
                          />
                        </>
                      );
                    })()
                  ) : null}
                </div>
              </div>
            </div>
          );
        }}
        className="w-full"
        // One slide: no fade blend, no slide autoplay / loop — the video
        // handles a hard 0-gap wrap. Multi-slide heroes keep fade rotation.
        loop={items.length > 1}
        transition={items.length > 1 ? "fade" : "slide"}
        autoplay={
          items.length > 1
            ? { enabled: true, delay: 5000, stopOnInteraction: true }
            : { enabled: false }
        }
        showScrollbar={false}
        showPagination={items.length > 1}
        paginationDotClassName="bg-white/50"
        paginationClassName="top-[calc(100vw-4.5rem)] md:top-auto md:bottom-6"
        itemSizing={{ base: "w-full" }}
        itemKey={(slide) => slide.id}
        gap="gap-0"
        padding="px-0"
      />
    </div>
  );
};

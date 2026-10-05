import { type ElementType } from "react";
import { ArtDirectedImage } from "@/components/headkit-ui/art-directed-image";
import { HeroRotator } from "@/components/headkit-ui/hero-rotator";
import { HeroVideoSlide } from "@/components/headkit-ui/hero-video-slide";
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
} from "@/lib/hero-layout";

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

/**
 * Server Component. The heading and the largest image render here, not
 * inside a client carousel, so they are part of the static shell and do
 * not ship their own JavaScript.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 * https://nextjs.org/docs/app/getting-started/caching#static-cached-and-streaming
 */
function HeroSlideView({
  slide,
  index,
  heroLayout,
  mediaClass,
  active,
}: {
  slide: HeroSlide;
  index: number;
  heroLayout: HeroLayout;
  mediaClass: string;
  active: boolean;
}): React.JSX.Element {
  const HeaderTag: ElementType = index === 0 ? "h1" : "h2";
  const desktopVideo = slideVideo(slide, false);
  const mobileVideo = slideVideo(slide, true);
  const hasVideo = Boolean(desktopVideo || mobileVideo);
  const alt = stripTitleMarkers(decodeHtmlEntities(slide.header ?? ""));

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
                <TitleEmphasis text={slide.header ?? ""} highlight />
              </HeaderTag>
              {slide.description ? (
                <p className="mt-8 text-base font-semibold text-black md:text-3xl md:text-brand-bg!">
                  {decodeHtmlEntities(slide.description)}
                </p>
              ) : null}
              <div className="mt-8">
                <InstantLink href={slide.url ?? "#"} prefetch={true}>
                  <Button className="text-brand-bg">{slide.buttonText}</Button>
                </InstantLink>
              </div>
            </div>
          </div>
        </div>
        <div className={mediaClass}>
          {slide.image || slide.mobileImage ? (
            <ArtDirectedImage
              mobileSrc={slide.mobileImage || slide.image}
              desktopSrc={slide.image || slide.mobileImage || ""}
              alt={alt}
              isLcp={index === 0}
              className="h-full w-full object-cover"
            />
          ) : null}
          {hasVideo ? (
            <HeroVideoSlide
              mobileSrc={mobileVideo}
              desktopSrc={desktopVideo}
              isActive={active}
            />
          ) : null}
          <div
            aria-hidden
            className="absolute inset-0 hidden md:block bg-gradient-to-r from-black/50 via-black/25 to-transparent"
          />
        </div>
      </div>
    </div>
  );
}

export const MainCarousel = ({
  carouselItems,
  heroLayout = "inset",
}: Props): React.JSX.Element | null => {
  const items = carouselItems as HeroSlide[];
  if (items.length === 0) return null;

  const shellClass = heroLayoutClasses(heroLayout);
  const mediaClass = heroMediaClasses(heroLayout);
  const slides = items.map((slide, index) => (
    <HeroSlideView
      key={slide.id || String(index)}
      slide={slide}
      index={index}
      heroLayout={heroLayout}
      mediaClass={mediaClass}
      active={index === 0 || items.length === 1}
    />
  ));

  return (
    <div className={cn("headkit-hero-carousel overflow-hidden", shellClass)}>
      {items.length > 1 ? <HeroRotator>{slides}</HeroRotator> : slides}
    </div>
  );
};

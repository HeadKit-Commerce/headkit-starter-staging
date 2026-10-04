"use client";

import { getImageProps } from "next/image";
import { useEffect, useState } from "react";
import { AutoplayVideo } from "@/components/headkit-ui/autoplay-video";

/**
 * How long after the window `load` event before the hero file starts.
 * `load` already waits for the poster. The extra delay keeps the multi-megabyte
 * MP4 out of the LCP dependency graph: a request that starts before the paint
 * is simulated in full, even when its priority is low.
 */
const POST_LOAD_VIDEO_DELAY_MS = 1500;

interface Props {
  mobileSrc: string;
  desktopSrc: string;
  /** Mobile poster, falling back to the desktop still. */
  posterSrc?: string | null;
  /** Desktop still. Used as the min-width 768 source when it differs. */
  desktopPosterSrc?: string | null;
  posterAlt: string;
  /** First slide. Its poster is the LCP image. */
  isLcp: boolean;
  isActive: boolean;
}

/**
 * Hero video that paints an optimized poster first.
 *
 * The raw CMS JPEG and both breakpoint MP4s were the homepage LCP: on mobile
 * the browser downloaded the desktop file as well (`preload="auto"` on a
 * CSS-hidden element). The poster is a `next/image` encode. The video src is
 * assigned only for the active slide, only for the matching breakpoint, and
 * only after `load` plus a short delay.
 */
export function HeroVideoSlide({
  mobileSrc,
  desktopSrc,
  posterSrc,
  desktopPosterSrc,
  posterAlt,
  isLcp,
  isActive,
}: Props): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setSrc(null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const start = (): void => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        const chosen = mobile
          ? mobileSrc || desktopSrc
          : desktopSrc || mobileSrc;
        if (chosen) setSrc(chosen);
      }, POST_LOAD_VIDEO_DELAY_MS);
    };

    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener("load", start);
    };
  }, [isActive, mobileSrc, desktopSrc]);

  const mobilePoster = posterSrc || desktopPosterSrc || "";
  const widePoster = desktopPosterSrc || posterSrc || "";
  const poster = mobilePoster
    ? getImageProps({
        alt: posterAlt,
        src: mobilePoster,
        sizes: "100vw",
        width: 768,
        height: 768,
        quality: 50,
        priority: isLcp,
      })
    : null;
  const wide =
    widePoster && widePoster !== mobilePoster
      ? getImageProps({
          alt: posterAlt,
          src: widePoster,
          sizes: "100vw",
          width: 1920,
          height: 1080,
          quality: 65,
          // Do not preload the desktop encode on a phone.
          priority: false,
        })
      : null;

  return (
    <>
      {poster ? (
        <picture>
          {wide ? (
            <source
              media="(min-width: 768px)"
              srcSet={wide.props.srcSet}
              sizes={wide.props.sizes}
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            {...poster.props}
            alt={posterAlt}
            className="h-full w-full object-cover"
            width={768}
            height={768}
            fetchPriority={isLcp ? "high" : "low"}
            decoding={isLcp ? "sync" : "async"}
            loading={isLcp ? "eager" : "lazy"}
          />
        </picture>
      ) : null}
      {src ? (
        <AutoplayVideo
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          isActive={isActive}
          preload="none"
        />
      ) : null}
    </>
  );
}

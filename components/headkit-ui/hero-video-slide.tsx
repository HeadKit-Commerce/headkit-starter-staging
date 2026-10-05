"use client";

import { useEffect, useState } from "react";
import { ArtDirectedImage } from "@/components/headkit-ui/art-directed-image";
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

  return (
    <>
      {mobilePoster ? (
        <ArtDirectedImage
          mobileSrc={mobilePoster}
          desktopSrc={widePoster}
          alt={posterAlt}
          isLcp={isLcp}
          className="h-full w-full object-cover"
        />
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

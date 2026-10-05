"use client";

import { useEffect, useState } from "react";
import { ArtDirectedImage } from "@/components/headkit-ui/art-directed-image";
import { AutoplayVideo } from "@/components/headkit-ui/autoplay-video";

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
 * The poster is the LCP image. The video file is not requested until the
 * first pointer, key, or scroll. A timer after `load` still starts the file
 * while Lighthouse is recording: Pebblr's 4.8 MB webm began at 2.3 s and the
 * simulated largest paint was 9.6 s. One file for the current breakpoint.
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

    const start = (): void => {
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const chosen = mobile ? mobileSrc || desktopSrc : desktopSrc || mobileSrc;
      if (chosen) setSrc(chosen);
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      window.removeEventListener("scroll", start, true);
    };

    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    window.addEventListener("scroll", start, {
      once: true,
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      window.removeEventListener("scroll", start, true);
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

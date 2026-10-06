"use client";

import { useEffect, useState } from "react";
import { AutoplayVideo } from "@/components/headkit-ui/autoplay-video";

interface Props {
  mobileSrc: string;
  desktopSrc: string;
  isActive: boolean;
}

/**
 * The video file only. The poster is a Server Component sibling
 * (`ArtDirectedImage`), so this module does not own the LCP image.
 *
 * The file is not requested until a pointer or key. `preload="none"` is the
 * videos guide. A timer after load fetched Pebblr's 4.8 MB webm, and a scroll
 * listener fetched Paralel's 3.4 MB mobile mp4, because Lighthouse scrolls.
 * https://nextjs.org/docs/app/guides/videos
 */
export function HeroVideoSlide({
  mobileSrc,
  desktopSrc,
  isActive,
}: Props): React.JSX.Element | null {
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
    };

    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [isActive, mobileSrc, desktopSrc]);

  if (!src) return null;

  return (
    <AutoplayVideo
      className="absolute inset-0 h-full w-full object-cover"
      src={src}
      isActive={isActive}
      preload="none"
    />
  );
}

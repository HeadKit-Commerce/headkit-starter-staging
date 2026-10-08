"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { syncInlineVideoPlayback } from "@/components/headkit-ui/autoplay-video-playback";

/** One file inside a `<video>`, optionally limited to a media query. */
export interface VideoSource {
  src: string;
  type: string;
  media?: string;
}

export interface AutoplayVideoProps {
  src?: string;
  sources?: VideoSource[];
  poster?: string;
  className?: string;
  /** When false, playback pauses (fade carousels keep every slide mounted). */
  isActive?: boolean;
  preload?: "auto" | "metadata" | "none";
}

/**
 * Muted inline hero video.
 *
 * Follows the Next.js video guide: a native `<video>` with `autoPlay`,
 * `muted`, and `playsInline`, plus `poster` until the first frame.
 * https://nextjs.org/docs/app/guides/videos
 * Safari still needs a programmatic `play()` after those attributes are set.
 */
export function AutoplayVideo({
  src,
  sources,
  poster,
  className,
  isActive = true,
  preload = "metadata",
}: AutoplayVideoProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const sourceKey =
    sources?.map((source) => `${source.media ?? ""}:${source.src}`).join("|") ??
    src ??
    "";

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    syncInlineVideoPlayback(video, isActive);

    if (!isActive) return;

    const retry = (): void => {
      syncInlineVideoPlayback(video, true);
    };

    video.addEventListener("loadeddata", retry);
    video.addEventListener("canplay", retry);

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        retry();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      video.removeEventListener("loadeddata", retry);
      video.removeEventListener("canplay", retry);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isActive, sourceKey]);

  return (
    <video
      ref={ref}
      className={cn(className)}
      {...(src && !sources?.length ? { src } : {})}
      {...(poster ? { poster } : {})}
      autoPlay
      muted
      loop
      playsInline
      preload={preload}
      disablePictureInPicture
    >
      {sources?.map((source) => (
        <source
          key={`${source.media ?? ""}:${source.src}`}
          src={source.src}
          type={source.type}
          {...(source.media ? { media: source.media } : {})}
        />
      ))}
    </video>
  );
}

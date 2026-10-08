import {
  AutoplayVideo,
  type VideoSource,
} from "@/components/headkit-ui/autoplay-video";

interface Props {
  mobileSrc: string;
  desktopSrc: string;
  /** Slide still used as the video `poster` on small screens. */
  mobilePoster?: string;
  /** Slide still used as the video `poster` from the `md` breakpoint up. */
  desktopPoster?: string;
  isActive: boolean;
}

function videoType(src: string): string {
  const path = src.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogv") || path.endsWith(".ogg")) return "video/ogg";
  return "video/mp4";
}

/**
 * Hero background video.
 *
 * The Next.js video guide uses a native `<video>` with `poster`, `autoPlay`,
 * `muted`, and `playsInline`. The slide image is that poster, not a second
 * picture stacked on top, so the first frame replaces it as soon as it
 * decodes. `source media` picks the phone or desktop file without fetching both.
 * https://nextjs.org/docs/app/guides/videos
 */
export function HeroVideoSlide({
  mobileSrc,
  desktopSrc,
  mobilePoster,
  desktopPoster,
  isActive,
}: Props): React.JSX.Element | null {
  const sources: VideoSource[] = [];
  if (mobileSrc && desktopSrc && mobileSrc !== desktopSrc) {
    sources.push({
      src: mobileSrc,
      type: videoType(mobileSrc),
      media: "(max-width: 767px)",
    });
    sources.push({
      src: desktopSrc,
      type: videoType(desktopSrc),
      media: "(min-width: 768px)",
    });
  } else {
    const only = desktopSrc || mobileSrc;
    if (only) sources.push({ src: only, type: videoType(only) });
  }
  if (sources.length === 0) return null;

  const poster = desktopPoster || mobilePoster;

  return (
    <AutoplayVideo
      className="absolute inset-0 h-full w-full object-cover"
      sources={sources}
      {...(poster ? { poster } : {})}
      isActive={isActive}
      preload={isActive ? "auto" : "none"}
    />
  );
}

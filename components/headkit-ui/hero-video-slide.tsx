import { ArtDirectedImage } from "@/components/headkit-ui/art-directed-image";
import {
  AutoplayVideo,
  type VideoSource,
} from "@/components/headkit-ui/autoplay-video";

interface Props {
  mobileSrc: string;
  desktopSrc: string;
  /** Slide still painted under the video on small screens. */
  mobileStill?: string;
  /** Slide still painted under the video from the `md` breakpoint up. */
  desktopStill?: string;
  /** Alt text for the still. The video itself is decorative. */
  alt: string;
  /** First slide. Its still is the LCP element until the video decodes. */
  isLcp: boolean;
  /** Slot width for the still's `sizes`. */
  sizes?: string;
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
 * The still is a stacked `ArtDirectedImage`, NOT the native `poster`
 * attribute. A `poster` is a plain URL: Next never optimises it, and it
 * carries no `srcSet`, no `media` and no priority hint, so the raw WordPress
 * upload became the LCP resource. Measured on the Paralel Furniture store
 * (tigerheart-studios/paralel-storefront#54, Lighthouse 13.5.0, three runs
 * per form factor): mobile LCP 11.5 s -> 2.7 s, performance 68 -> 86, page
 * weight 5,652 KB -> 4,591 KB, and the `lcp-discovery` audit went from
 * failing on `priorityHinted=false` to passing. The LCP resource went from a
 * 1,132,082-byte upload to 5,490 bytes of AVIF at `w=640`.
 *
 * `ArtDirectedImage` is what makes that possible: one encode per breakpoint
 * through `getImageProps`, AVIF/WebP negotiation, and a media-scoped
 * `preload(..., { as: "image", fetchPriority: "high" })` for the first slide.
 *
 * The video sits above the still and loads `metadata` rather than `auto`, so
 * it no longer competes with the LCP image for bandwidth; it fades in over
 * the still as it decodes instead of replacing a poster.
 * https://nextjs.org/docs/app/guides/videos
 */
export function HeroVideoSlide({
  mobileSrc,
  desktopSrc,
  mobileStill,
  desktopStill,
  alt,
  isLcp,
  sizes,
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

  const mobileStillSrc = mobileStill || desktopStill || "";
  const desktopStillSrc = desktopStill || mobileStill || "";

  return (
    <>
      {mobileStillSrc ? (
        <ArtDirectedImage
          mobileSrc={mobileStillSrc}
          desktopSrc={desktopStillSrc}
          alt={alt}
          isLcp={isLcp && isActive}
          className="absolute inset-0 h-full w-full object-cover"
          {...(sizes ? { sizes } : {})}
        />
      ) : null}
      <AutoplayVideo
        className="absolute inset-0 h-full w-full object-cover"
        sources={sources}
        isActive={isActive}
        preload={isActive ? "metadata" : "none"}
      />
    </>
  );
}

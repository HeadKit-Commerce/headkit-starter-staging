import { getImageProps } from "next/image";
import { preload } from "react-dom";

const DESKTOP_MEDIA = "(min-width: 768px)";
const MOBILE_MEDIA = "(max-width: 767px)";

interface Props {
  mobileSrc: string;
  desktopSrc: string;
  alt: string;
  /** First slide. Its poster is the LCP image for this breakpoint only. */
  isLcp: boolean;
  className?: string;
  /**
   * Slot width. Defaults to the full viewport. An inset hero passes
   * `calc(100vw - 2.5rem)` so a phone does not take the next larger encode.
   */
  sizes?: string;
  mobileWidth?: number;
  mobileHeight?: number;
  desktopWidth?: number;
  desktopHeight?: number;
}

/**
 * One file per viewport. The `<picture>` selects the source, and each preload
 * carries a `media` query so a phone does not fetch the desktop encode (or
 * the reverse). `getImageProps({ priority: true })` cannot express that: its
 * preload has no media.
 */
export function ArtDirectedImage({
  mobileSrc,
  desktopSrc,
  alt,
  isLcp,
  className,
  sizes = "100vw",
  mobileWidth = 768,
  mobileHeight = 768,
  desktopWidth = 1920,
  desktopHeight = 1080,
}: Props): React.JSX.Element {
  const mobile = getImageProps({
    alt,
    src: mobileSrc,
    sizes,
    width: mobileWidth,
    height: mobileHeight,
    // Phone slot is about 370px. q=50 is the next allowed step under 65 and
    // is what the mobile encode uses. Desktop stays at 75.
    quality: 50,
  });
  const desktopDiffers = desktopSrc.length > 0 && desktopSrc !== mobileSrc;
  const desktop = desktopDiffers
    ? getImageProps({
        alt,
        src: desktopSrc,
        sizes,
        width: desktopWidth,
        height: desktopHeight,
        quality: 75,
      })
    : null;

  if (isLcp) {
    preload(mobile.props.src, {
      as: "image",
      imageSrcSet: mobile.props.srcSet,
      imageSizes: mobile.props.sizes,
      ...(desktop ? { media: MOBILE_MEDIA } : {}),
      fetchPriority: "high",
    });
    if (desktop?.props.srcSet) {
      preload(desktop.props.src, {
        as: "image",
        imageSrcSet: desktop.props.srcSet,
        imageSizes: desktop.props.sizes,
        media: DESKTOP_MEDIA,
        fetchPriority: "high",
      });
    }
  }

  return (
    <picture>
      {desktop?.props.srcSet ? (
        <source
          media={DESKTOP_MEDIA}
          srcSet={desktop.props.srcSet}
          sizes={desktop.props.sizes}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...mobile.props}
        alt={alt}
        className={className}
        width={mobileWidth}
        height={mobileHeight}
        fetchPriority={isLcp ? "high" : "auto"}
        decoding="async"
        loading={isLcp ? "eager" : "lazy"}
      />
    </picture>
  );
}

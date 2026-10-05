"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image, { getImageProps } from "next/image";
import { preload } from "react-dom";
import { cn } from "@/lib/utils";
import { BadgeList } from "@/components/headkit-ui/badge-list";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Lightbox } from "@/components/ui/lightbox";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icon";
import {
  DEFAULT_PDP_GALLERY_LAYOUT,
  resolvePdpGalleryLayout,
  type PdpGalleryLayout,
} from "@/lib/pdp-gallery-layout";
import { youtubeThumbnailUrl, youtubeVideoId } from "@/lib/youtube";

interface GalleryImage {
  src: string;
  alt: string;
  /**
   * Set on the ONE synthetic tile a product video adds at the end of the
   * gallery: `src` is then the YouTube poster frame and the lightbox slide is
   * the embed rather than a zoomable image.
   */
  videoId?: string;
}

interface Props {
  images: GalleryImage[];
  isSale?: boolean;
  isNew?: boolean;
  badges?: { label: string; slug: string }[];
  /** Branding `pdpGalleryLayout`. Unknown values fall back to grid. */
  layout?: string;
  /**
   * Desktop hero `sizes`. Defaults to a half-width PDP column. A store whose
   * gallery column is wider passes its own hint (Bike Society: 66vw). The
   * phone carousel stays `100vw`. `sizes` cannot be set from CSS.
   */
  desktopHeroSizes?: string;
  /**
   * Desktop secondary-tile `sizes` for the grid layout. Defaults to a
   * quarter-width column. Bike Society's half of a two-thirds column is 33vw.
   */
  desktopTileSizes?: string;
  /**
   * WooCommerce "Product Video" URL (`product.productVideoUrl`). When it parses
   * as a YouTube video the gallery appends one video tile as its LAST item and
   * the lightbox gains a matching embed slide; null/unset/unparseable renders
   * exactly the image gallery it always did.
   */
  videoUrl?: string | null | undefined;
}

const FALLBACK_IMAGE_SRC = "/assets/HeadKit-Fallback.png";
const FALLBACK_ITEM: GalleryImage = {
  src: FALLBACK_IMAGE_SRC,
  alt: "No product image available",
};
const SWIPE_THRESHOLD_PX = 40;
const MOBILE_GALLERY_MEDIA = "(max-width: 767px)";
const DESKTOP_GALLERY_MEDIA = "(min-width: 768px)";
const DEFAULT_DESKTOP_HERO_SIZES = "(min-width: 768px) 50vw, 100vw";
const DEFAULT_DESKTOP_TILE_SIZES = "(min-width: 768px) 25vw, 100vw";

/**
 * The gallery renders a phone carousel and a desktop layout from the same
 * photo. `priority` on both would preload both encodes on every device.
 * Each preload is scoped with `media`, and the `<img>` copies stay lazy so a
 * `display: none` layout is not fetched. `desktopSizes` must match the hero
 * `<img>` `sizes` so the preloaded URL is the one the browser requests.
 */
function preloadGalleryLcp(src: string, desktopSizes: string): void {
  const mobile = getImageProps({
    alt: "",
    src,
    fill: true,
    sizes: "100vw",
  });
  const desktop = getImageProps({
    alt: "",
    src,
    fill: true,
    sizes: desktopSizes,
  });
  if (mobile.props.srcSet) {
    preload(mobile.props.src, {
      as: "image",
      imageSrcSet: mobile.props.srcSet,
      imageSizes: "100vw",
      media: MOBILE_GALLERY_MEDIA,
      fetchPriority: "high",
    });
  }
  if (desktop.props.srcSet) {
    preload(desktop.props.src, {
      as: "image",
      imageSrcSet: desktop.props.srcSet,
      imageSizes: desktopSizes,
      media: DESKTOP_GALLERY_MEDIA,
      fetchPriority: "high",
    });
  }
}

interface GalleryTileProps {
  item: GalleryImage;
  className: string;
  sizes: string;
  priority?: boolean;
  fetchPriority?: "high" | "auto";
  loading?: "lazy" | "eager" | undefined;
  draggable?: boolean;
}

/**
 * One gallery image, or the video tile: the YouTube poster frame under a play
 * glyph. The poster is served `unoptimized` because `i.ytimg.com` is not — and
 * should not be — in the image-optimizer allowlist; it is a third-party host
 * the merchant chose by pasting the URL, not one the store serves.
 */
function GalleryTile({
  item,
  className,
  sizes,
  priority,
  fetchPriority,
  loading,
  draggable,
}: GalleryTileProps) {
  const isVideo = Boolean(item.videoId);
  return (
    <>
      <Image
        src={item.src}
        alt={item.alt || (isVideo ? "Product video" : "Product image")}
        fill
        className={className}
        sizes={sizes}
        unoptimized={isVideo}
        {...(item.src === FALLBACK_IMAGE_SRC ? { quality: 50 as const } : {})}
        {...(priority !== undefined ? { priority } : {})}
        {...(fetchPriority !== undefined ? { fetchPriority } : {})}
        {...(loading !== undefined ? { loading } : {})}
        {...(draggable !== undefined ? { draggable } : {})}
      />
      {isVideo ? (
        <span
          data-testid="gallery-video-tile"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow">
            <svg
              viewBox="0 0 24 24"
              className="ml-1 h-6 w-6"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      ) : null}
    </>
  );
}

export function ProductImageGallery({
  images: rawImages,
  isSale = false,
  isNew = false,
  badges = [],
  layout: rawLayout,
  videoUrl,
  desktopHeroSizes = DEFAULT_DESKTOP_HERO_SIZES,
  desktopTileSizes = DEFAULT_DESKTOP_TILE_SIZES,
}: Props) {
  const layout: PdpGalleryLayout = resolvePdpGalleryLayout(
    rawLayout ?? DEFAULT_PDP_GALLERY_LAYOUT,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  // A product with no images still renders a placeholder rather than an
  // endless skeleton; downstream image src is always non-empty.
  const images: GalleryImage[] = rawImages?.length
    ? rawImages.filter((img) => img.src)
    : [];
  const baseImages: GalleryImage[] = images.length ? images : [FALLBACK_ITEM];
  // The video tile is always LAST, after the placeholder too: the hero slot
  // stays an image, so the priority preload and the badge overlay are unchanged.
  const videoId = youtubeVideoId(videoUrl);
  const galleryImages: GalleryImage[] = videoId
    ? [
        ...baseImages,
        {
          src: youtubeThumbnailUrl(videoId),
          alt: "Product video",
          videoId,
        },
      ]
    : baseImages;

  const lcpSrc = galleryImages[0]?.src;
  if (lcpSrc && lcpSrc !== FALLBACK_IMAGE_SRC && !galleryImages[0]?.videoId) {
    preloadGalleryLcp(lcpSrc, desktopHeroSizes);
  }

  // Reset selection when the image set changes (e.g. colourway swap).
  const galleryKey = galleryImages.map((img) => img.src).join("|");
  useEffect(() => {
    setSelectedIndex(0);
  }, [galleryKey]);

  const goTo = useCallback(
    (index: number) => {
      const len = galleryImages.length;
      if (len === 0) return;
      setSelectedIndex(((index % len) + len) % len);
    },
    [galleryImages.length],
  );

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchDeltaX.current = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const x = e.touches[0]?.clientX ?? touchStartX.current;
    touchDeltaX.current = x - touchStartX.current;
  };

  const onTouchEnd = () => {
    if (touchStartX.current === null) return;
    const delta = touchDeltaX.current;
    touchStartX.current = null;
    touchDeltaX.current = 0;
    if (galleryImages.length <= 1) return;
    if (delta <= -SWIPE_THRESHOLD_PX) goTo(selectedIndex + 1);
    else if (delta >= SWIPE_THRESHOLD_PX) goTo(selectedIndex - 1);
  };

  const badgesOverlay = (
    <div className="absolute left-2 top-2 z-10">
      <BadgeList isSale={isSale} isNewIn={isNew} badges={badges} />
    </div>
  );

  // Every layout keeps the swipe carousel below `md`. Desktop chrome
  // (masonry / thumbs / stack) is `hidden md:*` so phones never download
  // those extra images — same first-src/sizes as this carousel so the
  // priority preload still dedupes.
  const mobileCarousel = (
    <div
      className="relative overflow-hidden rounded-brand bg-white md:hidden touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className="absolute left-2 top-2 z-10">
        <BadgeList isSale={isSale} isNewIn={isNew} badges={badges} />
      </div>

      <Dialog>
        <DialogTrigger className="block w-full appearance-none border-0 bg-transparent p-0 text-left">
          <div
            className="relative aspect-square overflow-hidden bg-white"
            data-gallery-lead={selectedIndex === 0 ? "" : undefined}
          >
            <GalleryTile
              item={galleryImages[selectedIndex] ?? FALLBACK_ITEM}
              className={
                selectedIndex === 0
                  ? "object-cover object-center"
                  : "object-cover object-top"
              }
              sizes="100vw"
              loading={selectedIndex === 0 ? "eager" : "lazy"}
              fetchPriority={selectedIndex === 0 ? "high" : "auto"}
              draggable={false}
            />
          </div>
        </DialogTrigger>
        <Lightbox images={galleryImages} initialSelectedIndex={selectedIndex} />
      </Dialog>

      {galleryImages.length > 1 ? (
        <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2">
          {galleryImages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to image ${i + 1}`}
              className="flex h-6 w-6 cursor-pointer items-center justify-center"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === selectedIndex
                    ? "bg-black/70"
                    : "bg-black/30 hover:bg-black/50",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (layout === "thumbnails") {
    return (
      <div className="headkit-pdp-gallery" data-pdp-gallery="thumbnails">
        <div className="hidden flex-col gap-3 md:flex md:flex-row md:items-start">
          <div
            className="relative flex-1 overflow-hidden rounded-brand bg-white touch-pan-y"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            {badgesOverlay}
            <Dialog>
              <DialogTrigger className="block w-full appearance-none border-0 bg-transparent p-0 text-left">
                <div
                  className="relative aspect-square overflow-hidden bg-white md:aspect-[var(--pdp-gallery-hero-aspect,3/4)]"
                  data-gallery-tile=""
                  data-gallery-lead={selectedIndex === 0 ? "" : undefined}
                >
                  <GalleryTile
                    item={galleryImages[selectedIndex] ?? FALLBACK_ITEM}
                    className="object-cover object-center"
                    sizes={desktopHeroSizes}
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              </DialogTrigger>
              <Lightbox
                images={galleryImages}
                initialSelectedIndex={selectedIndex}
              />
            </Dialog>
          </div>

          {galleryImages.length > 1 ? (
            <div
              className="flex gap-2 overflow-x-auto md:w-[var(--pdp-gallery-thumb-size,4.5rem)] md:flex-col md:overflow-y-auto md:overflow-x-hidden"
              role="listbox"
              aria-label="Product images"
            >
              {galleryImages.map((item, index) => (
                <button
                  key={`${item.src}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-label={`View image ${index + 1}`}
                  onClick={() => goTo(index)}
                  className={cn(
                    "relative aspect-square w-[var(--pdp-gallery-thumb-size,4.5rem)] shrink-0 overflow-hidden rounded-brand bg-white",
                    index === selectedIndex
                      ? "ring-2 ring-primary ring-offset-2"
                      : "ring-1 ring-transparent hover:ring-gray-300",
                  )}
                >
                  <GalleryTile
                    item={item}
                    className="object-cover object-center"
                    sizes="72px"
                    loading={index === 0 ? undefined : "lazy"}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {mobileCarousel}
      </div>
    );
  }

  if (layout === "carousel") {
    return (
      <div
        data-pdp-gallery="carousel"
        className="headkit-pdp-gallery relative overflow-hidden rounded-brand bg-white touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {badgesOverlay}
        <Dialog>
          <DialogTrigger className="block w-full appearance-none border-0 bg-transparent p-0 text-left">
            <div
              className="relative aspect-square overflow-hidden bg-white md:aspect-[var(--pdp-gallery-hero-aspect,1/1)]"
              data-gallery-tile=""
              data-gallery-lead={selectedIndex === 0 ? "" : undefined}
            >
              <GalleryTile
                item={galleryImages[selectedIndex] ?? FALLBACK_ITEM}
                className="object-cover object-center"
                sizes={desktopHeroSizes}
                fetchPriority="high"
                loading="eager"
                draggable={false}
              />
            </div>
          </DialogTrigger>
          <Lightbox
            images={galleryImages}
            initialSelectedIndex={selectedIndex}
          />
        </Dialog>

        {galleryImages.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => goTo(selectedIndex - 1)}
              className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center bg-transparent text-primary"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => goTo(selectedIndex + 1)}
              className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center bg-transparent text-primary"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
            <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2">
              {galleryImages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Go to image ${i + 1}`}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-colors",
                      i === selectedIndex
                        ? "bg-black/70"
                        : "bg-black/30 hover:bg-black/50",
                    )}
                  />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  if (layout === "stack") {
    return (
      <div className="headkit-pdp-gallery" data-pdp-gallery="stack">
        <div className="hidden flex-col gap-5 md:flex">
          {galleryImages.map((item, index) => (
            <Dialog key={`${item.src}-${index}`}>
              <DialogTrigger className="relative block w-full cursor-pointer appearance-none overflow-hidden rounded-brand border-0 bg-white p-0 text-left">
                {index === 0 ? badgesOverlay : null}
                <div
                  className="relative aspect-square overflow-hidden"
                  data-gallery-tile=""
                  data-gallery-lead={index === 0 ? "" : undefined}
                >
                  <GalleryTile
                    item={item}
                    className={
                      index === 0
                        ? "object-cover object-center"
                        : "object-cover object-top"
                    }
                    sizes={desktopHeroSizes}
                    loading="lazy"
                  />
                </div>
              </DialogTrigger>
              <Lightbox images={galleryImages} initialSelectedIndex={index} />
            </Dialog>
          ))}
        </div>
        {mobileCarousel}
      </div>
    );
  }

  return (
    <div className="headkit-pdp-gallery" data-pdp-gallery="grid">
      {/* Desktop: masonry-style two-column grid.
          The phone carousel and this grid share one photo. Preloads are
          media-scoped (see preloadGalleryLcp); these copies stay lazy so a
          display:none layout is not fetched. Hero/tile sizes default to a
          half-width column and are overridable per store. */}
      <div className="hidden gap-5 md:grid md:grid-cols-2">
        {galleryImages.map((item, index) => (
          <Dialog key={index}>
            <DialogTrigger
              className={cn(
                "relative block w-full cursor-pointer appearance-none overflow-hidden rounded-brand border-0 bg-white p-0 text-left",
                index === 0 ? "col-span-2" : "col-span-1",
              )}
            >
              {index === 0 && (
                <div className="absolute left-2 top-2 z-10">
                  <BadgeList isSale={isSale} isNewIn={isNew} badges={badges} />
                </div>
              )}
              <div
                className="relative aspect-square overflow-hidden"
                data-gallery-tile=""
                data-gallery-lead={index === 0 ? "" : undefined}
              >
                <GalleryTile
                  item={item}
                  className={
                    index === 0
                      ? "object-cover object-center"
                      : "object-cover object-top"
                  }
                  sizes={index === 0 ? desktopHeroSizes : desktopTileSizes}
                  loading="lazy"
                />
              </div>
            </DialogTrigger>
            <Lightbox images={galleryImages} initialSelectedIndex={index} />
          </Dialog>
        ))}
      </div>

      {mobileCarousel}
    </div>
  );
}

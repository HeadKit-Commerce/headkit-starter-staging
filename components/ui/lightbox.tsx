"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import Image from "next/image";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
} from "@/components/icon";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { youtubeEmbedUrl } from "@/lib/youtube";
import {
  applyLightboxPan,
  lightboxCursorClass,
  lightboxImageTransform,
  nextLightboxScale,
  type LightboxPan,
} from "@/lib/lightbox-zoom";

interface Props {
  /**
   * Slides in gallery order. An entry with `videoId` is the product-video
   * slide: it renders the privacy-enhanced YouTube embed instead of a zoomable
   * image, and `src` (the poster frame) is not shown.
   */
  images: {
    src: string;
    alt: string;
    videoId?: string;
    /** Original upload. The visible gallery keeps `src` (a derivative). */
    fullSrc?: string;
    /**
     * Render a plain img. Set when the host is not in remotePatterns:
     * next/image throws at render for that host and would take the page down.
     */
    plain?: boolean;
  }[];
  initialSelectedIndex: number;
}

const Lightbox = ({ images, initialSelectedIndex }: Props) => {
  const [currentIndex, setCurrentIndex] = useState(initialSelectedIndex);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<LightboxPan>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    start: LightboxPan;
    origin: LightboxPan;
    moved: boolean;
  } | null>(null);
  const skipClickRef = useRef(false);

  useEffect(() => {
    setCurrentIndex(initialSelectedIndex);
  }, [initialSelectedIndex]);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    dragRef.current = null;
  }, [currentIndex]);

  const zoomed = scale > 1;

  const setZoom = (direction: "in" | "out" | "toggle"): void => {
    const next = nextLightboxScale(scale, direction);
    setScale(next);
    if (next <= 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setScale(nextLightboxScale(1, "in"));
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setScale(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const prev = (): void =>
    setCurrentIndex((i) => (i - 1 + images.length) % images.length);
  const next = (): void => setCurrentIndex((i) => (i + 1) % images.length);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!zoomed) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: pan,
      moved: false,
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const nextPan = applyLightboxPan(drag.origin, drag.start, {
      x: event.clientX,
      y: event.clientY,
    });
    if (
      Math.abs(nextPan.x - drag.origin.x) +
        Math.abs(nextPan.y - drag.origin.y) >
      4
    ) {
      drag.moved = true;
    }
    setPan(nextPan);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag?.moved) {
      skipClickRef.current = true;
    }
    if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const onImageActivate = (): void => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    setZoom("toggle");
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0) {
      setZoom("in");
      return;
    }
    setZoom("out");
  };

  const current = images[currentIndex];
  const currentVideoId = current?.videoId;
  const cursorClass = lightboxCursorClass(scale, dragging);

  return (
    <DialogContent className="inset-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 left-0 top-0 items-center justify-center rounded-none border-0 bg-brand-bg p-0">
      <DialogTitle className="sr-only">Image preview</DialogTitle>
      <DialogDescription className="sr-only">
        Image {currentIndex + 1} of {images.length}
      </DialogDescription>

      <div className="relative flex h-full w-full items-center justify-center px-4 md:px-16">
        {current && currentVideoId ? (
          <div
            className="relative flex h-full w-full items-center justify-center"
            data-lightbox-video={currentVideoId}
          >
            <iframe
              src={youtubeEmbedUrl(currentVideoId)}
              title={current.alt || "Product video"}
              className="aspect-video w-full max-h-full max-w-5xl"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              loading="lazy"
            />
          </div>
        ) : null}
        {current && !currentVideoId && (
          <div
            className={`relative h-full w-full overflow-hidden ${cursorClass}`}
            data-lightbox-zoom={scale}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={onImageActivate}
            onWheel={onWheel}
            style={{ touchAction: zoomed ? "none" : "auto" }}
          >
            {current.plain ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.fullSrc || current.src}
                alt={current.alt}
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain select-none"
              />
            ) : (
              <Image
                src={current.fullSrc || current.src}
                alt={current.alt}
                fill
                draggable={false}
                className="object-contain select-none"
                sizes="100vw"
                quality={100}
                priority
                style={{
                  transform: lightboxImageTransform(scale, pan),
                  transformOrigin: "center center",
                  transition: dragging ? "none" : "transform 200ms ease",
                }}
              />
            )}
          </div>
        )}

        <div className="absolute left-4 top-4 z-20 flex gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setZoom("in");
            }}
            disabled={zoomed || Boolean(currentVideoId)}
            className="cursor-pointer rounded-full bg-primary/10 p-2 text-primary backdrop-blur-sm transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setZoom("out");
            }}
            disabled={!zoomed}
            className="cursor-pointer rounded-full bg-primary/10 p-2 text-primary backdrop-blur-sm transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            <MinusIcon className="h-5 w-5" />
          </button>
        </div>

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-4 top-1/2 z-20 -translate-y-1/2 cursor-pointer rounded-full bg-primary/10 p-2 text-primary backdrop-blur-sm transition hover:bg-primary/20"
              aria-label="Previous image"
            >
              <ChevronLeftIcon className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-4 top-1/2 z-20 -translate-y-1/2 cursor-pointer rounded-full bg-primary/10 p-2 text-primary backdrop-blur-sm transition hover:bg-primary/20"
              aria-label="Next image"
            >
              <ChevronRightIcon className="h-6 w-6" />
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-primary/70">
              {currentIndex + 1} / {images.length}
            </div>
          </>
        )}
      </div>
    </DialogContent>
  );
};

export { Lightbox };

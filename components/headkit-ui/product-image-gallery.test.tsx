import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const preload = vi.hoisted(() => vi.fn());

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return { ...actual, preload };
});
import { ProductImageGallery } from "./product-image-gallery";

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    src?: string;
    className?: string;
    sizes?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={props.alt ?? ""}
      src={typeof props.src === "string" ? props.src : ""}
      className={props.className}
      data-sizes={props.sizes}
    />
  ),
  getImageProps: ({ src }: { src: string }) => ({
    props: {
      src: typeof src === "string" ? src : "",
      srcSet: typeof src === "string" ? `${src} 800w` : "",
      sizes: "100vw",
    },
  }),
}));

vi.mock("@/components/icon", () => ({
  ChevronLeftIcon: () => <span data-icon="chevron-left" />,
  ChevronRightIcon: () => <span data-icon="chevron-right" />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTrigger: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
}));

const lightboxImages = vi.fn<(images: unknown[]) => void>();
vi.mock("@/components/ui/lightbox", () => ({
  Lightbox: ({ images }: { images: unknown[] }): null => {
    lightboxImages(images);
    return null;
  },
}));

vi.mock("@/components/headkit-ui/badge-list", () => ({
  BadgeList: (): null => null,
}));

const IMAGES = [
  { src: "/a.jpg", alt: "Front" },
  { src: "/b.jpg", alt: "Back" },
  { src: "/c.jpg", alt: "Detail" },
];

function markup(layout?: string): string {
  return renderToStaticMarkup(
    layout === undefined ? (
      <ProductImageGallery images={IMAGES} />
    ) : (
      <ProductImageGallery images={IMAGES} layout={layout} />
    ),
  );
}

describe("ProductImageGallery layouts", () => {
  it("defaults to grid masonry and marks the hook", () => {
    const html = markup();
    expect(html).toContain('data-pdp-gallery="grid"');
    expect(html).toContain("headkit-pdp-gallery");
    expect(html).toContain('data-gallery-tile=""');
    expect(html).toContain('data-gallery-lead=""');
    expect(html).toContain("md:grid md:grid-cols-2");
    expect(html).toContain("col-span-2");
    expect(html).not.toContain("Previous image");
    expect(html).not.toContain('role="listbox"');
  });

  it("renders hero + thumbnail strip on desktop and carousel on mobile", () => {
    const html = markup("thumbnails");
    expect(html).toContain('data-pdp-gallery="thumbnails"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("View image 2");
    expect(html).toContain("md:aspect-[var(--pdp-gallery-hero-aspect,3/4)]");
    expect(html).toContain("hidden flex-col gap-3 md:flex");
    expect(html).toContain("md:hidden");
    expect(html).toContain("Go to image 2");
    expect(html).not.toContain("Previous image");
    expect(html).not.toContain("md:grid md:grid-cols-2");
  });

  it("renders carousel arrows and dots", () => {
    const html = markup("carousel");
    expect(html).toContain('data-pdp-gallery="carousel"');
    expect(html).toContain("Previous image");
    expect(html).toContain("Next image");
    expect(html).toContain("Go to image 2");
    expect(html).toContain('data-icon="chevron-left"');
    expect(html).not.toContain("rounded-full bg-white");
    expect(html).not.toContain("bg-white/80");
  });

  it("renders a stacked lookbook on desktop and carousel on mobile", () => {
    const html = markup("stack");
    expect(html).toContain('data-pdp-gallery="stack"');
    expect(html).toContain("hidden flex-col gap-5 md:flex");
    expect(html).toContain("md:hidden");
    expect(html).toContain("Go to image 2");
    expect(html).not.toContain("Previous image");
    expect(html).not.toContain("md:grid md:grid-cols-2");
  });

  it("preloads the hero per breakpoint and honours a store size override", () => {
    preload.mockClear();
    const html = renderToStaticMarkup(
      <ProductImageGallery
        images={IMAGES}
        desktopHeroSizes="(min-width: 768px) 66vw, 100vw"
        desktopTileSizes="(min-width: 768px) 33vw, 100vw"
      />,
    );
    expect(preload).toHaveBeenCalledWith(
      "/a.jpg",
      expect.objectContaining({
        as: "image",
        media: "(max-width: 767px)",
        imageSizes: "100vw",
        fetchPriority: "high",
      }),
    );
    expect(preload).toHaveBeenCalledWith(
      "/a.jpg",
      expect.objectContaining({
        as: "image",
        media: "(min-width: 768px)",
        imageSizes: "(min-width: 768px) 66vw, 100vw",
        fetchPriority: "high",
      }),
    );
    expect(html).toContain('data-sizes="(min-width: 768px) 66vw, 100vw"');
    expect(html).toContain('data-sizes="(min-width: 768px) 33vw, 100vw"');
    expect(html).toContain('data-sizes="100vw"');
  });

  it("coerces an unknown layout to grid", () => {
    const html = markup("masonry");
    expect(html).toContain('data-pdp-gallery="grid"');
  });

  it.each(["grid", "thumbnails", "carousel", "stack"] as const)(
    "covers the hero on desktop and mobile for %s",
    (layout) => {
      const html = markup(layout);
      expect(html).toContain("object-cover object-center");
      expect(html).not.toContain("object-contain");
    },
  );
});

/**
 * The product-video tile (Bike Society PDP gap #3). Present ONLY when
 * `videoUrl` parses as a YouTube video; a store whose products carry no
 * `productVideoUrl` (null from commerce, or a theme that predates the field)
 * renders the identical image gallery.
 */
describe("ProductImageGallery product video", () => {
  const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it.each(["grid", "thumbnails", "carousel", "stack"] as const)(
    "appends ONE video tile as the LAST item for %s",
    (layout) => {
      lightboxImages.mockClear();
      const html = renderToStaticMarkup(
        <ProductImageGallery
          images={IMAGES}
          layout={layout}
          videoUrl={VIDEO_URL}
        />,
      );
      // The carousel layout paints only the selected slide, so the tile itself
      // shows up there once the shopper reaches it; every other layout paints
      // all tiles at once.
      if (layout !== "carousel") {
        expect(html).toContain('data-testid="gallery-video-tile"');
        expect(html).toContain(
          "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        );
      }
      // The mobile carousel (every layout) counts the video as a slide.
      expect(html).toContain("Go to image 4");
      expect(html).not.toContain("Go to image 5");

      // The lightbox receives the SAME list, with the video slide last.
      const passed = lightboxImages.mock.calls[0]?.[0] as
        | { src: string; videoId?: string }[]
        | undefined;
      expect(passed).toHaveLength(4);
      expect(passed?.[3]).toMatchObject({ videoId: "dQw4w9WgXcQ" });
      expect(passed?.slice(0, 3).every((i) => i.videoId === undefined)).toBe(
        true,
      );
    },
  );

  it("keeps the hero an image so the priority preload is unchanged", () => {
    const html = renderToStaticMarkup(
      <ProductImageGallery images={IMAGES} videoUrl={VIDEO_URL} />,
    );
    // First tile in the desktop grid is still the first product image; the
    // video tile comes after it (and after every other image).
    const grid = html.slice(html.indexOf('data-pdp-gallery="grid"'));
    const firstImgTag = grid.slice(grid.indexOf("<img"));
    expect(firstImgTag.slice(0, firstImgTag.indexOf(">"))).toContain(
      'src="/a.jpg"',
    );
    const desktopGrid = grid.slice(0, grid.indexOf("md:hidden"));
    expect(desktopGrid.lastIndexOf("i.ytimg.com")).toBeGreaterThan(
      desktopGrid.lastIndexOf('src="/c.jpg"'),
    );
  });

  it.each([null, undefined, "", "https://vimeo.com/1", "not a url"])(
    "renders the plain image gallery when videoUrl is %s",
    (videoUrl) => {
      lightboxImages.mockClear();
      const withVideoProp = renderToStaticMarkup(
        <ProductImageGallery images={IMAGES} videoUrl={videoUrl} />,
      );
      const without = renderToStaticMarkup(
        <ProductImageGallery images={IMAGES} />,
      );
      expect(withVideoProp).toBe(without);
      expect(withVideoProp).not.toContain("gallery-video-tile");
      expect(withVideoProp).not.toContain("i.ytimg.com");
      expect(lightboxImages.mock.calls[0]?.[0]).toHaveLength(3);
    },
  );

  it("still shows the video after the placeholder when there are no images", () => {
    const html = renderToStaticMarkup(
      <ProductImageGallery images={[]} videoUrl={VIDEO_URL} />,
    );
    expect(html).toContain("/assets/HeadKit-Fallback.png");
    expect(html).toContain('data-testid="gallery-video-tile"');
  });
});

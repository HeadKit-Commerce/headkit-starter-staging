// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HeroCarouselItem } from "@headkit/sdk";
import type { ReactNode } from "react";

/**
 * Shopify / CMS hero titles use the same `{Towel}` markers as product names.
 * The heading (H1/H2) must run them through TitleEmphasis with highlight.
 *
 * The video-slide half below asserts the contract that replaced #633's: the
 * slide still is a stacked, OPTIMIZED image under the video, not the native
 * `poster` attribute. A `poster` is a plain URL — no `srcSet`, no `media`, no
 * priority hint — so the raw WordPress upload became the LCP resource.
 * Measured on the Paralel Furniture store (paralel-storefront#54): mobile LCP
 * 11.5 s -> 2.7 s and the `lcp-discovery` audit went from failing on
 * `priorityHinted=false` to passing.
 *
 * Twice now this file has outlived the decision it describes: before #633 it
 * still asserted a withheld video, and after #633 it still asserted the
 * `poster`. Both times it reported as a failure rather than as a caught
 * regression. Every `it` here must therefore name a decision the code makes
 * TODAY. If one of them starts failing, check which of the two is stale
 * before editing either.
 *
 * Written as the intent rather than as a snapshot of the markup: each `it`
 * reads back only the attribute that carries its decision, so a class-name or
 * wrapper change does not touch this file, while a change to the still's
 * source, the media queries or the preload policy cannot pass it.
 */

/** The optimizer URL Next serves an `ArtDirectedImage` encode from. */
function optimized(src: string, width: number, quality: number): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}

vi.mock("next/image", () => ({
  getImageProps: ({
    src,
    alt,
    sizes,
    width,
    quality,
  }: {
    src: string;
    alt: string;
    sizes: string;
    width: number;
    quality: number;
  }): {
    props: { srcSet: string; sizes: string; src: string; alt: string };
  } => {
    const half = Math.round(width / 2);
    return {
      props: {
        src: optimized(src, width, quality),
        srcSet: `${optimized(src, half, quality)} ${half}w, ${optimized(src, width, quality)} ${width}w`,
        sizes,
        alt,
      },
    };
  },
}));

vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    href,
    children,
  }: {
    href: string;
    children?: ReactNode;
  }): React.JSX.Element => <a href={href}>{children}</a>,
}));

import { MainCarousel } from "@/components/headkit-ui/main-carousel";

const slide = (header: string): HeroCarouselItem => ({
  id: "slide-1",
  header,
  title: "",
  description: "Soft on one side.",
  url: "/shop",
  buttonText: "Shop now",
  image: "https://cdn.example.com/hero.jpg",
  mobileImage: "",
  video: "",
  mobileVideo: "",
  startDate: "",
  endDate: "",
  textColor: "",
});

const DESKTOP_STILL = "https://cdn.example.com/poster.jpg";
const MOBILE_STILL = "https://cdn.example.com/poster-mobile.jpg";
const DESKTOP_VIDEO = "https://cdn.example.com/hero-desktop.mp4";
const MOBILE_VIDEO = "https://cdn.example.com/hero-mobile.mp4";

const DESKTOP_MEDIA = "(min-width: 768px)";
const MOBILE_MEDIA = "(max-width: 767px)";

/** A slide carrying both video files and both stills. */
function videoSlide(
  header: string,
  overrides: Partial<HeroCarouselItem> = {},
): HeroCarouselItem {
  return {
    ...slide(header),
    image: DESKTOP_STILL,
    mobileImage: MOBILE_STILL,
    video: DESKTOP_VIDEO,
    mobileVideo: MOBILE_VIDEO,
    ...overrides,
  };
}

function render(items: HeroCarouselItem[]): string {
  return renderToStaticMarkup(<MainCarousel carouselItems={items} />);
}

/** Every `<video …>` open tag, in document order. */
function videoTags(html: string): string[] {
  return html.match(/<video[^>]*>/g) ?? [];
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}[^>]*>`, "g")) ?? [];
}

/**
 * The element the slide's media renders into — the `<video>`'s own parent, so
 * the assertions below are about the media slot rather than the whole hero
 * shell. An arrow, badge or logo elsewhere in the slide is not a hero still.
 */
function mediaSlot(html: string): HTMLElement {
  const slot = parse(html).querySelector("video")?.parentElement ?? null;

  expect(
    slot,
    "the video slide must render a <video> inside a media slot",
  ).not.toBeNull();

  return slot as HTMLElement;
}

/** `{ src, media }` for every VIDEO `<source>` (the ones carrying `src`). */
function videoSources(
  html: string,
): Array<{ src: string; media: string | null }> {
  return tags(html, "source")
    .filter((tag) => attribute(tag, "src") !== null)
    .map((tag) => ({
      src: attribute(tag, "src") ?? "",
      media: attribute(tag, "media"),
    }));
}

/**
 * Parsed, not regexed. React serialises `srcSet` camelCase and escapes `&` as
 * `&amp;`, so an optimizer URL only reads back correctly through the parser.
 */
function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** `{ srcset, media }` for every `<picture>` `<source>` (the ones carrying `srcset`). */
function pictureSources(
  html: string,
): Array<{ srcset: string; media: string | null }> {
  return [...parse(html).querySelectorAll("source[srcset]")].map((node) => ({
    srcset: node.getAttribute("srcset") ?? "",
    media: node.getAttribute("media"),
  }));
}

/** Every hoisted `<link rel="preload" as="image">`, in document order. */
function imagePreloads(html: string): Element[] {
  return [...parse(html).querySelectorAll('link[rel="preload"][as="image"]')];
}

describe("MainCarousel title emphasis", () => {
  it("italicises {Towel} in the hero heading and drops the braces", () => {
    const html = render([slide("A new era of {Towel}")]);

    expect(html).toContain("A new era of ");
    expect(html).toContain('class="headkit-title-emphasis"');
    expect(html).toContain("Towel");
    expect(html).not.toContain("{Towel}");
    expect(html).not.toContain("A new era of {Towel}");
    expect(html).toContain('alt="A new era of Towel"');
  });
});

describe("MainCarousel video slide", () => {
  it("serves the still through the image optimizer, never as a video poster", () => {
    // The whole point of the port: a `poster` is a plain URL Next cannot
    // optimize, so the 1.1 MB upload became the LCP resource. The still is an
    // ArtDirectedImage now, and the raw upload must not reach the browser.
    const html = render([videoSlide("Outdoor dining")]);
    const slot = mediaSlot(html);
    const img = slot.querySelector("img");

    expect(img?.getAttribute("src")).toBe(optimized(MOBILE_STILL, 768, 50));
    expect(html).not.toContain(MOBILE_STILL);
    expect(html).not.toContain(DESKTOP_STILL);
    for (const tag of videoTags(html)) {
      expect(
        attribute(tag, "poster"),
        "<video> must carry no poster",
      ).toBeNull();
    }
  });

  it("offers one still encode per breakpoint, desktop still on the desktop source", () => {
    const html = render([videoSlide("Outdoor dining")]);

    expect(pictureSources(html)).toEqual([
      {
        srcset: `${optimized(DESKTOP_STILL, 960, 75)} 960w, ${optimized(DESKTOP_STILL, 1920, 75)} 1920w`,
        media: DESKTOP_MEDIA,
      },
    ]);
    expect(mediaSlot(html).querySelector("img")?.getAttribute("srcset")).toBe(
      `${optimized(MOBILE_STILL, 384, 50)} 384w, ${optimized(MOBILE_STILL, 768, 50)} 768w`,
    );
  });

  it("falls back to the mobile still when the slide has no desktop image", () => {
    const html = render([videoSlide("Outdoor dining", { image: "" })]);

    // One still for both breakpoints, so ArtDirectedImage emits no <source>.
    expect(pictureSources(html)).toEqual([]);
    expect(mediaSlot(html).querySelector("img")?.getAttribute("src")).toBe(
      optimized(MOBILE_STILL, 768, 50),
    );
  });

  it("stacks the still under the video, so the video fades in over it", () => {
    const slot = mediaSlot(render([videoSlide("Outdoor dining")]));
    const painted = [...slot.children].map((child) =>
      child.tagName.toLowerCase(),
    );

    // Both are `absolute inset-0`, so DOM order is paint order: the still
    // first, the video above it.
    expect(painted.indexOf("picture")).toBeGreaterThanOrEqual(0);
    expect(painted.indexOf("picture")).toBeLessThan(painted.indexOf("video"));
  });

  it("preloads the first slide's still at high priority, scoped per breakpoint", () => {
    const html = render([videoSlide("Outdoor dining")]);
    const preloads = imagePreloads(html);

    expect(preloads).toHaveLength(2);
    expect(preloads.map((node) => node.getAttribute("media"))).toEqual([
      MOBILE_MEDIA,
      DESKTOP_MEDIA,
    ]);
    for (const node of preloads) {
      expect(node.getAttribute("fetchpriority")).toBe("high");
    }
    expect(preloads[0]?.getAttribute("imagesrcset")).toContain(
      encodeURIComponent(MOBILE_STILL),
    );
    expect(preloads[1]?.getAttribute("imagesrcset")).toContain(
      encodeURIComponent(DESKTOP_STILL),
    );
  });

  it("preloads no still for the slides behind the first", () => {
    // Two slides, distinct stills, so React cannot dedupe the second away:
    // the only reason it is absent is that it is not the LCP candidate.
    const html = render([
      videoSlide("Outdoor dining"),
      {
        ...videoSlide("Indoor dining"),
        id: "slide-2",
        image: "https://cdn.example.com/poster-2.jpg",
        mobileImage: "https://cdn.example.com/poster-2-mobile.jpg",
      },
    ]);
    const preloads = imagePreloads(html);

    expect(preloads).toHaveLength(2);
    for (const node of preloads) {
      expect(node.getAttribute("imagesrcset")).not.toContain("poster-2");
    }
  });

  it("offers both files behind media queries, so the browser fetches one", () => {
    const html = render([videoSlide("Outdoor dining")]);

    expect(videoSources(html)).toEqual([
      { src: MOBILE_VIDEO, media: MOBILE_MEDIA },
      { src: DESKTOP_VIDEO, media: DESKTOP_MEDIA },
    ]);
  });

  it("offers one unconditional file when the slide has only one", () => {
    const html = render([videoSlide("Outdoor dining", { mobileVideo: "" })]);

    expect(videoSources(html)).toEqual([{ src: DESKTOP_VIDEO, media: null }]);
  });

  it("loads metadata for the slide on screen and nothing for the ones behind it", () => {
    // A multi-slide hero keeps every slide mounted and toggles visibility, so
    // every <video> is in the first HTML. The visible one takes `metadata`
    // rather than `auto`: the still is the LCP element now, and `auto` had the
    // video competing with it for bandwidth.
    const tags = videoTags(
      render([
        videoSlide("Outdoor dining"),
        { ...videoSlide("Indoor dining"), id: "slide-2" },
      ]),
    );

    expect(tags).toHaveLength(2);
    expect(tags.map((tag) => attribute(tag, "preload"))).toEqual([
      "metadata",
      "none",
    ]);
  });

  it("autoplays muted and inline, which is what lets it play at all", () => {
    const tag = videoTags(render([videoSlide("Outdoor dining")]))[0] ?? "";

    // Case-insensitive: React serialises these as `autoPlay=""` /
    // `playsInline=""` and the HTML parser lowercases them. The claim is that
    // the attributes are there — a muted, inline video is the only kind a
    // browser will start on its own — not how React spells them.
    for (const flag of ["autoplay", "muted", "loop", "playsinline"]) {
      expect(
        new RegExp(`\\s${flag}(=|\\s|>)`, "i").test(tag),
        `<video> must carry ${flag}`,
      ).toBe(true);
    }
  });
});

describe("MainCarousel image-only slide", () => {
  it("renders the still on its own, with no video and no absolute overlay", () => {
    // The image-only branch is untouched by the poster change: its still is
    // the media box itself, not a layer stacked inside it.
    const html = render([
      videoSlide("Outdoor dining", { video: "", mobileVideo: "" }),
    ]);
    const host = parse(html);
    const img = host.querySelector("img");

    expect(videoTags(html)).toEqual([]);
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(img?.getAttribute("class")).toBe("h-full w-full object-cover");
    expect(img?.getAttribute("src")).toBe(optimized(MOBILE_STILL, 768, 50));
    expect(imagePreloads(html)).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HeroCarouselItem } from "@headkit/sdk";
import type { ReactNode } from "react";

/**
 * Shopify / CMS hero titles use the same `{Towel}` markers as product names.
 * The heading (H1/H2) must run them through TitleEmphasis with highlight.
 *
 * The video-slide half below asserts the contract #633 shipped: the slide image
 * is the video's `poster`, not a second picture stacked on top of it, and the
 * file itself is offered through `<source media>` so the browser fetches one of
 * the two. Before #633 the hero painted an optimized still and withheld the
 * video from the first HTML, and this file still described THAT contract for
 * four commits — asserting a behaviour production had already left, which is
 * why it reports as a failure rather than as a caught regression.
 *
 * Written as the intent rather than as a snapshot of the markup: each `it`
 * names one decision and reads back only the attribute that carries it, so a
 * class-name or wrapper change does not touch this file and a change to the
 * poster source, the media queries or the preload policy cannot pass it.
 */

vi.mock("next/image", () => ({
  getImageProps: ({
    src,
    alt,
  }: {
    src: string;
    alt: string;
  }): {
    props: { srcSet: string; sizes: string; src: string; alt: string };
  } => ({
    props: { srcSet: src, sizes: "100vw", src, alt },
  }),
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

/** `{ src, media }` for every `<source>` the markup carries. */
function sources(html: string): Array<{ src: string; media: string | null }> {
  return (html.match(/<source[^>]*>/g) ?? []).map((tag) => ({
    src: attribute(tag, "src") ?? "",
    media: attribute(tag, "media"),
  }));
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
  it("posters the video with the slide image, preferring the desktop still", () => {
    const tags = videoTags(render([videoSlide("Outdoor dining")]));

    expect(tags).toHaveLength(1);
    // A `<video>` carries ONE poster, so the two stills cannot both be it. The
    // desktop still wins; the mobile one is the fallback, asserted below.
    expect(attribute(tags[0] ?? "", "poster")).toBe(DESKTOP_STILL);
  });

  it("falls back to the mobile still when the slide has no desktop image", () => {
    const tags = videoTags(
      render([videoSlide("Outdoor dining", { image: "" })]),
    );

    expect(attribute(tags[0] ?? "", "poster")).toBe(MOBILE_STILL);
  });

  it("stacks no second picture over the poster", () => {
    // The whole point of #633: the still is the poster, so the first video
    // frame replaces it as it decodes. An <img> here would be painted over.
    const html = render([videoSlide("Outdoor dining")]);

    expect(html).not.toContain("<img");
    expect(html).not.toContain("srcset");
  });

  it("offers both files behind media queries, so the browser fetches one", () => {
    const html = render([videoSlide("Outdoor dining")]);

    expect(sources(html)).toEqual([
      { src: MOBILE_VIDEO, media: "(max-width: 767px)" },
      { src: DESKTOP_VIDEO, media: "(min-width: 768px)" },
    ]);
  });

  it("offers one unconditional file when the slide has only one", () => {
    const html = render([videoSlide("Outdoor dining", { mobileVideo: "" })]);

    expect(sources(html)).toEqual([{ src: DESKTOP_VIDEO, media: null }]);
  });

  it("preloads the slide on screen and not the ones behind it", () => {
    // A multi-slide hero keeps every slide mounted and toggles visibility, so
    // every <video> is in the first HTML. Only the visible one may load bytes.
    const tags = videoTags(
      render([
        videoSlide("Outdoor dining"),
        { ...videoSlide("Indoor dining"), id: "slide-2" },
      ]),
    );

    expect(tags).toHaveLength(2);
    expect(tags.map((tag) => attribute(tag, "preload"))).toEqual([
      "auto",
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

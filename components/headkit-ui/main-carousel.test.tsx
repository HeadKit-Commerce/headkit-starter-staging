import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HeroCarouselItem } from "@headkit/sdk";
import type { ReactNode } from "react";

/**
 * Shopify / CMS hero titles use the same `{Towel}` markers as product names.
 * The heading (H1/H2) must run them through TitleEmphasis with highlight.
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

vi.mock("@/components/headkit-ui/carousel", () => ({
  Carousel: <T,>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (item: T, index: number) => ReactNode;
  }): React.JSX.Element => (
    <div data-testid="carousel">
      {items.map((item, index) => (
        <div key={index}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
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

describe("MainCarousel title emphasis", () => {
  it("italicises {Towel} in the hero heading and drops the braces", () => {
    const html = renderToStaticMarkup(
      <MainCarousel carouselItems={[slide("A new era of {Towel}")]} />,
    );

    expect(html).toContain("A new era of ");
    expect(html).toContain('class="headkit-title-emphasis"');
    expect(html).toContain("Towel");
    expect(html).not.toContain("{Towel}");
    expect(html).not.toContain("A new era of {Towel}");
    expect(html).toContain('alt="A new era of Towel"');
  });
});

describe("MainCarousel video slide", () => {
  it("paints the optimized poster and leaves the MP4 out of the first HTML", () => {
    const html = renderToStaticMarkup(
      <MainCarousel
        carouselItems={[
          {
            ...slide("Outdoor dining"),
            image: "https://cdn.example.com/poster.jpg",
            mobileImage: "https://cdn.example.com/poster-mobile.jpg",
            video: "https://cdn.example.com/hero-desktop.mp4",
            mobileVideo: "https://cdn.example.com/hero-mobile.mp4",
          },
        ]}
      />,
    );

    expect(html).toContain("https://cdn.example.com/poster-mobile.jpg");
    expect(html).toContain("https://cdn.example.com/poster.jpg");
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain(".mp4");
    expect(html).not.toContain('preload="auto"');
  });
});

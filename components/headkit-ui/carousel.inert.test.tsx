// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import type { HeroCarouselItem } from "@headkit/sdk";

/**
 * An inactive hero slide must leave the tab order, and the active one must not.
 *
 * `MainCarousel` renders each slide as a Server Component and, when there is
 * more than one, wraps them in `HeroRotator`. The rotator stacks every slide
 * in ONE grid cell so the hero keeps a constant height, which means an
 * inactive slide is still laid out: it is hidden with `invisible`, and it is
 * `inert` and `aria-hidden` so its CTA leaves the tab order (the
 * `aria-hidden-focus` audit). `display: none` is NOT used any more.
 *
 * These tests drive the real `MainCarousel` → `HeroRotator` chain in a DOM
 * and assert BOTH directions — hiding every slide would pass the audit and
 * break the hero — at the initial index, after one 5000 ms tick, and after a
 * pick from the pagination dots (which must get a full dwell).
 *
 * What this does NOT cover: the constant hero HEIGHT, which needs layout —
 * jsdom has none, and the browser measurement lives with the PR — and whether
 * a browser actually skips an `inert` subtree.
 */

// React 19 needs this before `act` will flush updates synchronously.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  }): ReactElement => <a href={href}>{children}</a>,
}));

import { MainCarousel } from "@/components/headkit-ui/main-carousel";

// Image-less slides keep the render to the text column and its one link, which
// is the focusable descendant the audit is about.
const SLIDES = [0, 1, 2, 3].map(
  (i) =>
    ({
      id: `slide-${i}`,
      title: `Slide ${i}`,
      header: `Header ${i}`,
      description: `Description ${i}`,
      buttonText: `Shop ${i}`,
      url: `/collections/slide-${i}`,
      image: "",
      mobileImage: "",
      textColor: "",
    }) as unknown as HeroCarouselItem,
);

function slideWrappers(container: HTMLElement): HTMLElement[] {
  const hero = container.querySelector(".headkit-hero-carousel");
  if (!hero) throw new Error("no .headkit-hero-carousel rendered");
  const rotator = hero.firstElementChild;
  if (!rotator || !rotator.classList.contains("relative")) {
    throw new Error("no hero rotator rendered");
  }
  return [...rotator.children].filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.id.startsWith("carousel-item-"),
  );
}

function renderCarousel(): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MainCarousel carouselItems={SLIDES} />);
  });
  return { container, root };
}

function expectOnlyActive(wrappers: HTMLElement[], active: number): void {
  wrappers.forEach((slide, index) => {
    if (index === active) {
      expect(slide.classList.contains("invisible")).toBe(false);
      expect(slide.getAttribute("aria-hidden")).toBe("false");
      expect(slide.hasAttribute("inert")).toBe(false);
    } else {
      expect(slide.classList.contains("invisible")).toBe(true);
      expect(slide.getAttribute("aria-hidden")).toBe("true");
      expect(slide.hasAttribute("inert")).toBe(true);
    }
  });
}

function dots(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      "button[aria-label^='Go to slide']",
    ),
  ];
}

describe("hero carousel slides leave the focus order when they are hidden", () => {
  it("makes every slide but the active one inert, and each slide really does hold a focusable link", () => {
    const { container, root } = renderCarousel();
    try {
      const wrappers = slideWrappers(container);
      expect(wrappers).toHaveLength(SLIDES.length);
      for (const slide of wrappers) {
        // Without this the assertions below would be vacuous: a slide with
        // nothing focusable in it could not fail the audit either way.
        expect(
          slide.querySelectorAll("a[href], button").length,
        ).toBeGreaterThan(0);
      }
      expectOnlyActive(wrappers, 0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("keeps every slide laid out so the hero height cannot swing", () => {
    const { container, root } = renderCarousel();
    try {
      for (const slide of slideWrappers(container)) {
        expect(slide.classList.contains("hidden")).toBe(false);
        expect(slide.className).toContain("[grid-area:1/1]");
      }
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("moves the exemption with the active slide", () => {
    vi.useFakeTimers();
    const { container, root } = renderCarousel();
    try {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expectOnlyActive(slideWrappers(container), 1);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });
});

describe("hero carousel pagination dots", () => {
  it("renders one dot per slide and marks the active one", () => {
    const { container, root } = renderCarousel();
    try {
      const buttons = dots(container);
      expect(buttons).toHaveLength(SLIDES.length);
      expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([
        "true",
        "false",
        "false",
        "false",
      ]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("switches slides when a dot is picked", () => {
    const { container, root } = renderCarousel();
    try {
      act(() => {
        dots(container)[2]!.click();
      });
      expectOnlyActive(slideWrappers(container), 2);
      expect(dots(container)[2]!.getAttribute("aria-current")).toBe("true");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("gives a manual pick a full dwell instead of the remainder of the tick", () => {
    vi.useFakeTimers();
    const { container, root } = renderCarousel();
    try {
      // 4 s into slide 0's 5 s dwell, the shopper picks slide 2.
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      act(() => {
        dots(container)[2]!.click();
      });
      // With a long-lived interval the next tick would land 1 s later.
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expectOnlyActive(slideWrappers(container), 2);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expectOnlyActive(slideWrappers(container), 3);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it("renders no dots for a single slide", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(<MainCarousel carouselItems={SLIDES.slice(0, 1)} />);
      });
      expect(dots(container)).toHaveLength(0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

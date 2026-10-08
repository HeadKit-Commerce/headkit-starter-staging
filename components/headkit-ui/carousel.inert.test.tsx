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
 * more than one, wraps them in `HeroRotator`. The rotator does not use the
 * client `Carousel`'s `inert` attribute or its pagination buttons. It sets
 * `hidden` (`display: none`) on every wrapper but the active one, and
 * `aria-hidden="true"` on the same wrapper. `display: none` removes the
 * inactive slide from the tab order, which is what closed the
 * `aria-hidden-focus` finding the opacity fade used to leave open.
 *
 * These tests drive the real `MainCarousel` → `HeroRotator` chain in a DOM
 * and assert BOTH directions — hiding every slide would pass the audit and
 * break the hero — at the initial index and after one 5000 ms interval tick.
 *
 * What this does NOT cover: whether a browser actually skips a
 * `display: none` subtree. jsdom applies the class but implements no focus
 * model, so the keyboard proof is a browser tab-through.
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
    (node): node is HTMLElement => node instanceof HTMLElement,
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

describe("hero carousel slides leave the focus order when they are hidden", () => {
  it("hides every slide but the active one, and each slide really does hold a focusable link", () => {
    const { container, root } = renderCarousel();
    try {
      const wrappers = slideWrappers(container);
      expect(wrappers).toHaveLength(SLIDES.length);

      expect(wrappers[0]!.classList.contains("block")).toBe(true);
      expect(wrappers[0]!.getAttribute("aria-hidden")).not.toBe("true");
      expect(
        wrappers[0]!.querySelectorAll("a[href], button").length,
      ).toBeGreaterThan(0);

      for (const index of [1, 2, 3]) {
        const slide = wrappers[index]!;
        // Without this the assertion below would be vacuous: a slide with
        // nothing focusable in it could not fail the audit either way.
        expect(
          slide.querySelectorAll("a[href], button").length,
        ).toBeGreaterThan(0);
        expect(slide.classList.contains("hidden")).toBe(true);
        expect(slide.getAttribute("aria-hidden")).toBe("true");
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

      const wrappers = slideWrappers(container);
      expect(wrappers[1]!.classList.contains("block")).toBe(true);
      expect(wrappers[1]!.getAttribute("aria-hidden")).not.toBe("true");
      for (const index of [0, 2, 3]) {
        expect(wrappers[index]!.classList.contains("hidden")).toBe(true);
        expect(wrappers[index]!.getAttribute("aria-hidden")).toBe("true");
      }
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });
});

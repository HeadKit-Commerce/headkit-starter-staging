// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductSummaryFieldsFragment } from "@headkit/sdk";

/**
 * The filter bar's OPEN-PANEL OVERLAY: it closes, it fills the bar, and it
 * out-ranks page content.
 *
 * All three were reported together against the one `Filter` that `/shop`,
 * `/sale` and every collection route render. `./filter-overlay.ts` carries the
 * layer table; this file is the executable half.
 *
 * WHAT IT EXERCISES. The real `Filter`, mounted under the real
 * `CollectionProvider`, with the real Base UI navigation menu underneath — so
 * the open/close assertions run through the same controlled `value` the browser
 * does, and a revert to the uncontrolled `onValueChange` + local boolean fails
 * them. The width assertion reads what the real `FilterMenuItem` and `SortMenu`
 * hand `NavigationMenuContent`, not a hand-written string, because a constant
 * that is correct and never applied is exactly the shape this defect had.
 *
 * WHAT IT CANNOT SEE: jsdom resolves no Tailwind class, performs no layout and
 * paints nothing, so the panel's measured width, the computed `z-index` and
 * which element `elementFromPoint` returns over a dimmed card are browser
 * claims recorded in the PR. The ORDERING assertion below compares the two
 * numbers this repo writes — it cannot know what any OTHER element on the page
 * computes to, which is the half that made `z-9` wrong.
 */

// React 19 needs this before `act` will flush updates synchronously.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/collections/bike-components",
  useRouter: (): { push: () => void; replace: () => void } => ({
    push: (): void => {},
    replace: (): void => {},
  }),
}));

vi.mock("@/lib/collection-actions", () => ({
  listCollectionProducts: (): Promise<{
    products: ProductSummaryFieldsFragment[];
    total: number;
  }> => Promise.resolve({ products: [], total: 0 }),
}));

import { CollectionProvider } from "@/components/headkit-ui/collection/collection-context";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import { Filter } from "@/components/headkit-ui/collection/filter";
import {
  FILTER_BACKDROP_Z_CLASS,
  FILTER_BAR_Z_CLASS,
  FILTER_PANEL_WIDTH_CLASS,
} from "@/components/headkit-ui/collection/filter-overlay";

const PREFS = {
  showVariants: false,
  showSwatches: false,
  imageRollover: false,
  defaultCollectionSort: "CREATED_AT",
};

const PRODUCT_FILTER = {
  categories: [
    { slug: "frame-bags", name: "Frame Bags" },
    { slug: "seat-bags", name: "Seat Bags" },
  ],
  attributes: [],
  // Non-empty on purpose: the Brand trigger is guarded on this list (it is the
  // route's SCOPED brand set), so an empty one renders no Brand trigger and the
  // panel cases below would have nothing to open.
  brands: [{ slug: "abus", name: "ABUS", count: 2 }],
} as never;

let host: HTMLElement;
let root: Root;

function mount(): void {
  act(() => {
    root.render(
      <CatalogDisplayProvider prefs={PREFS}>
        <CollectionProvider
          initialProducts={[]}
          initialTotal={0}
          productFilter={PRODUCT_FILTER}
          categorySlug="bike-components"
          categoryBasePath="/collections/bike-components"
        >
          <Filter />
        </CollectionProvider>
      </CatalogDisplayProvider>,
    );
  });
}

/** The bar's facet triggers, by visible label. */
function trigger(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no "${label}" trigger rendered`);
  return found;
}

function backdrop(): HTMLElement | null {
  return host.querySelector<HTMLElement>(
    `div.${CSS.escape(FILTER_BACKDROP_Z_CLASS)}`,
  );
}

function isOpen(label: string): boolean {
  return trigger(label).getAttribute("aria-expanded") === "true";
}

/** Open a facet panel and let Base UI's own open delay elapse. */
function open(label: string): void {
  act(() => {
    trigger(label).click();
  });
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the open panel can be dismissed", () => {
  it("has no backdrop at all until a panel opens", () => {
    mount();
    expect(isOpen("Category")).toBe(false);
    // The dim is rendered only while a panel is open — `{menuOpen && …}`, no
    // wrapper and no timer — so a bar nobody has opened renders none. That is
    // the whole of what this asserts: it says nothing about the dim going away
    // again, which the close cases below cover through `aria-expanded`.
    expect(backdrop()).toBeNull();
  });

  it("closes when the backdrop is clicked", () => {
    mount();
    open("Category");
    expect(isOpen("Category")).toBe(true);

    const dim = backdrop();
    expect(dim).not.toBeNull();
    act(() => {
      dim?.click();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(isOpen("Category")).toBe(false);
    // And the dim leaves WITH the panel, in the same commit — nothing defers its
    // unmount. WHAT THIS CATCHES, falsified in both directions before being
    // kept: a helper that holds the dim mounted past the close fails it (tried
    // with a 300 ms `setTimeout`-deferred unmount, the shape a fade-out would
    // need — red, because `open()` advances only 200 ms). What it does NOT catch
    // is the `@headlessui/react` `<Transition>` this replaced: that also
    // unmounts synchronously under jsdom, because Headless UI polyfills
    // `getAnimations()` to `[]` in tests and its enter/leave then completes
    // immediately. So this is a claim about deferral, not about the mechanism,
    // and it is a claim about the React tree only — jsdom runs no CSS
    // transition. That the dim and the panel actually disappear in ONE frame in
    // a browser is measured in the PR that removed the dependency.
    expect(backdrop()).toBeNull();
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    mount();
    open("Category");
    expect(isOpen("Category")).toBe(true);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(isOpen("Category")).toBe(false);
    // Not `<body>`: the panel unmounts, so an Escape pressed from inside it
    // would otherwise strand focus.
    expect(document.activeElement).toBe(trigger("Category"));
  });

  it("leaves the backdrop out of the accessibility tree and out of the tab order", () => {
    mount();
    open("Category");

    const dim = backdrop();
    expect(dim?.getAttribute("aria-hidden")).toBe("true");
    // Pointer dismissal here, keyboard dismissal via Escape — the split
    // `components/ui/sheet.tsx` already uses, where Base UI's own
    // `Dialog.Backdrop` is an inert `<div>`. A focusable overlay would put a
    // nameless stop in the tab order instead.
    expect(dim?.hasAttribute("tabindex")).toBe(false);
    expect(dim?.getAttribute("role")).toBeNull();
  });
});

describe("the open panel fills the bar", () => {
  // SORT IS IN THIS LIST ON PURPOSE. Production's Sort panel measures x=10 /
  // 1420 at 1440 — the same box as its facet panels — and its inner list is
  // `p-4 flex flex-col gap-2 items-end`, class for class what this repo already
  // renders. Only the width differed, and a facet panel that fills the bar
  // beside a Sort panel that shrink-wraps is the same inconsistency the report
  // is about, one menu over.
  it.each(["Category", "Brand", "Sort"])(
    "is what the real %s panel asks for",
    (label) => {
      mount();
      open(label);

      // Base UI mounts only the OPEN item's content — there is no
      // `keepMounted` here — so exactly one panel is in the DOM at a time.
      const panels = [...host.querySelectorAll("[class]")].filter((el) =>
        el.className.toString().includes(FILTER_PANEL_WIDTH_CLASS),
      );
      expect(panels.length).toBe(1);
      // And it must survive `cn()`/twMerge against the primitive's own
      // `md:w-max`, which lives in the same group at the same breakpoint —
      // the two cannot both be present or the panel keeps its content width.
      expect(panels[0]?.className.toString()).not.toContain("md:w-max");
    },
  );
});

describe("the layer order", () => {
  it("puts the bar one layer above its own backdrop", () => {
    const z = (cls: string): number => Number(cls.replace(/^z-/, ""));
    expect(Number.isFinite(z(FILTER_BACKDROP_Z_CLASS))).toBe(true);
    expect(z(FILTER_BAR_Z_CLASS)).toBeGreaterThan(z(FILTER_BACKDROP_Z_CLASS));
    // Under the site header's own mega-menu scrim (`z-[15]` in
    // `navigation-bar.tsx`), so opening the header menu still dims this bar.
    expect(z(FILTER_BAR_Z_CLASS)).toBeLessThan(15);
    // And above everything measured inside `<main>`, which tops out at 10.
    expect(z(FILTER_BACKDROP_Z_CLASS)).toBeGreaterThan(10);
  });

  it("is what the rendered bar and backdrop actually carry", () => {
    mount();
    open("Category");

    const bar = host.querySelector("nav");
    expect(bar).not.toBeNull();
    expect(bar?.className.toString().split(/\s+/)).toContain(
      FILTER_BAR_Z_CLASS,
    );
    expect(backdrop()?.className.toString().split(/\s+/)).toContain(
      FILTER_BACKDROP_Z_CLASS,
    );
  });
});

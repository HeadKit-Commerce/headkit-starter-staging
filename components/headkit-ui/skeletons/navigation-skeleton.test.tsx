// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { PostCard } from "@/components/headkit-ui/post/post-card";
import { NAVIGATION_SKELETON_DELAY_MS } from "@/components/headkit-ui/skeletons/navigation-skeleton";
import {
  NavigationSkeletonHost,
  NAVIGATION_SKELETON_MAX_MS,
} from "@/components/headkit-ui/skeletons/navigation-skeleton-host";
import {
  getNavigationSkeletonRequest,
  requestNavigationSkeleton,
  resetNavigationSkeletonStore,
} from "@/lib/navigation-skeleton-store";
import type { NavigationSkeletonKind } from "@/lib/navigation-skeleton-target";
import {
  DEFAULT_HEADER_BOTTOM_PX,
  HEADER_BOTTOM_CSS_VAR,
  HEADER_REGION_ATTRIBUTE,
  headerBottomCssValue,
} from "@/lib/header-bottom";

/**
 * Two claims, and they are no longer one chain.
 *
 * A CLICKED LINK does not paint a skeleton. `InstantLink` accepts `skeleton` and
 * `pendingVariant` so existing call sites keep typechecking, and it does not
 * read them. Catalogue routes have no route-level `loading.tsx` (#601): the
 * static shell is the first paint. A press — click or mouse-down, skeleton
 * prop set or not — opens no request and paints no overlay and no pulse.
 *
 * THE OVERLAY HOST is still the full-page cover for a request something else
 * opens. Filter navigations in `collection-context.tsx` are that caller. Those
 * cases drive `requestNavigationSkeleton` directly, because going through
 * `InstantLink` would assert a call the component no longer makes. The host is
 * mounted BESIDE the page rather than around it, which is how the root layout
 * mounts it.
 *
 * WHERE IT STOPS.
 *  - `next/link` is mocked, so `pending` here is a value this file sets. That a real
 *    navigation reports `pending` for as long as it runs is Next's.
 *  - jsdom has no layout, so nothing here can see that the skeleton MATCHES the
 *    PDP, that it starts flush under the sticky nav, or that `position: fixed`
 *    escapes a transformed carousel ancestor. Those are browser claims, measured on
 *    the fork this is ported from — and, for the header offset, re-measured in
 *    Chrome for the geometry cases at the foot of this file.
 *  - It says nothing about the direct-load path. That one is load-bearing and is
 *    proved where it is observable: over HTTP, with JavaScript off.
 *
 * jsdom is opted into per file; the global vitest environment stays `node`.
 */

const { linkStatus } = vi.hoisted(() => ({
  linkStatus: { pending: false },
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        // jsdom cannot navigate, and a real <a> click would log through the
        // virtual console on every test.
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => linkStatus,
}));

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactElement | null): void {
  act(() => {
    root.render(
      <>
        <NavigationSkeletonHost />
        {node}
      </>,
    );
  });
}

function skeleton(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(
    '[data-testid="navigation-skeleton"]',
  );
}

function skeletonKind(): string | null {
  return skeleton()?.getAttribute("data-skeleton-kind") ?? null;
}

/**
 * The navigation lands: the router's path becomes the destination.
 *
 * This is the only way a request ends short of the ceiling, so it is the only way a
 * test can take the skeleton down.
 */
function land(href: string): void {
  window.history.replaceState(null, "", href);
  // One frame for the host's watcher to notice; it polls `location`.
  advance(50);
}

/**
 * Put an undrawn, in-viewport image inside `<main>`, the way a just-committed
 * product grid does.
 *
 * Here so the cases below can prove the host IGNORES it: a request must end at the
 * route change whether or not the destination's pictures have arrived, and must not
 * be held open by one when the route landed inside the delay.
 *
 * jsdom loads nothing and lays nothing out, so both halves are faked — `complete` is
 * false and the rect is stubbed to something on screen.
 */
function undrawnImageInViewport(): HTMLImageElement {
  const main = document.querySelector("main") ?? document.createElement("main");
  if (!main.isConnected) document.body.appendChild(main);
  const img = document.createElement("img");
  Object.defineProperty(img, "complete", { value: false, configurable: true });
  img.getBoundingClientRect = () =>
    ({ width: 300, height: 300, top: 10, bottom: 310 }) as DOMRect;
  main.appendChild(img);
  return img;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * A press of the rendered link. `InstantLink` must not turn this into a skeleton
 * request; the cases that still cover the host call `openRequest` instead.
 */
function press(type: "click" | "mousedown" = "click", selector = "a"): void {
  const anchor = container.querySelector<HTMLAnchorElement>(selector);
  if (!anchor) throw new Error(`no anchor matching ${selector} to press`);
  act(() => {
    anchor.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
      }),
    );
  });
}

/** What a filter navigation does: ask the host, without going through a link. */
function openRequest(kind: NavigationSkeletonKind, href: string): void {
  act(() => {
    requestNavigationSkeleton(kind, href);
  });
}

beforeEach(() => {
  // React 19 wants this flag before `act` will flush without warning.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  linkStatus.pending = false;
  // The host reads `location.pathname` directly — it may not use `usePathname()`,
  // which Next treats as URL data and which fails the production build from the
  // root layout. So a test navigates the way the browser does.
  window.history.replaceState(null, "", "/");
  // DECLARE the state this file exercises. The whole file is about what the skeleton
  // does when a store has switched it ON; inheriting the process's value would make
  // every assertion here depend on how the suite was launched.
  // `lib/nav-interaction-flags.test.ts` owns the OFF state.
  vi.stubEnv("NEXT_PUBLIC_NAVIGATION_SKELETON", "true");
  vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", undefined);
  resetNavigationSkeletonStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  // `undrawnImageInViewport` appends a <main> to the body, and the host looks the
  // DOM up globally rather than through the render tree — so leaving one behind
  // couples the next test to this one.
  document.querySelectorAll("main").forEach((el) => el.remove());
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const PRODUCT_HREF = "/shop/clothing/jackets/alpine-jacket";

const CARD_ROUTE_LOADING = [
  "app/shop/loading.tsx",
  "app/products/[...slug]/loading.tsx",
  "app/collections/[...slug]/loading.tsx",
  "app/brand/[...slug]/loading.tsx",
  "app/news/[...slug]/loading.tsx",
  "app/projects/[...slug]/loading.tsx",
] as const;

describe("a clicked link does not paint a skeleton", () => {
  it("does not call requestNavigationSkeleton", () => {
    const source = readFileSync(
      "components/headkit-ui/instant-link.tsx",
      "utf8",
    );
    expect(source).not.toContain("requestNavigationSkeleton");
    expect(source).toContain("loading.tsx");
  });

  it.each(CARD_ROUTE_LOADING)(
    "keeps %s absent so the static shell paints",
    (file) => {
      expect(
        existsSync(file),
        `${file} would put a Suspense boundary above the page and stream a 200 instead of letting the static shell paint.`,
      ).toBe(false);
    },
  );

  it.each([
    ["a product", PRODUCT_HREF, undefined],
    ["a category", "/collections/clothing", "collection" as const],
    [
      "a facet listing",
      "/collections/jackets/f/colour.black",
      "collection" as const,
    ],
    ["a brand PLP", "/brand/acme", "collection" as const],
    ["a CMS page", "/wholesale", "page" as const],
    ["the catalogue index", "/shop", "collection" as const],
    ["the quote cart", "/quote", null],
    ["checkout", "/checkout", null],
    ["an account page", "/account", null],
    ["the home page", "/", null],
    ["a tel: link", "tel:1300883919", null],
  ])(
    "opens no request for %s, skeleton prop included",
    (_label, href, skeletonProp) => {
      linkStatus.pending = true;
      render(
        <InstantLink href={href} skeleton={skeletonProp}>
          Elsewhere
        </InstantLink>,
      );
      press();
      advance(NAVIGATION_SKELETON_DELAY_MS * 3);
      expect(getNavigationSkeletonRequest()).toBeNull();
      expect(skeleton()).toBeNull();
    },
  );

  it("opens no request from a mousedown when that switch is on", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
    linkStatus.pending = true;
    render(
      <InstantLink href={PRODUCT_HREF} skeleton="product">
        Product
      </InstantLink>,
    );
    press("mousedown");
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(getNavigationSkeletonRequest()).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it('opens no request from PostCard, which still passes skeleton="post"', () => {
    linkStatus.pending = true;
    render(
      <PostCard
        post={{
          id: "1",
          slug: "autumn-sale",
          uri: "/journal/autumn-sale",
          title: "Autumn sale",
          excerpt: "",
          date: "2026-04-01T00:00:00",
        }}
        postsBasePath="journal"
      />,
    );
    press();
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(
      getNavigationSkeletonRequest(),
      'The card may still pass skeleton="post". InstantLink does not read it, and the news route has no loading.tsx — the static shell is the first paint.',
    ).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it("paints no pulse on the link", () => {
    linkStatus.pending = true;
    render(<InstantLink href="/collections/jackets">Jackets</InstantLink>);
    press();
    expect(container.querySelector("span.animate-pulse")).toBeNull();
  });
});

describe("the overlay host, given a request", () => {
  it("stays hidden for the whole delay, then appears", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);

    advance(NAVIGATION_SKELETON_DELAY_MS - 1);
    expect(
      skeleton(),
      "A warm PDP arrives in 0.22-0.39 s. Showing the skeleton inside that window is the flash the delay exists to prevent.",
    ).toBeNull();

    advance(1);
    expect(skeleton()).not.toBeNull();
  });

  it("never appears at all when the navigation lands before the delay", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);

    advance(200);
    land(PRODUCT_HREF);

    // Past the threshold in absolute time: the timer from the first navigation must
    // have been torn down, not merely ignored.
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(skeleton()).toBeNull();
  });

  it("survives the requester being unmounted", () => {
    // Filter UI can leave the tree while its navigation is still running. The
    // request lives in the module store, so the host — mounted beside the page —
    // still raises the cover.
    render(<InstantLink href={PRODUCT_HREF}>Product</InstantLink>);
    openRequest("product", PRODUCT_HREF);

    advance(160);
    render(null);
    expect(
      skeleton(),
      "Still inside the delay — nothing should be up yet, unmounted or not.",
    ).toBeNull();

    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(skeleton()).not.toBeNull();
    expect(skeletonKind()).toBe("product");
  });

  it("gives up on a request nothing ever reported back on", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(skeleton()).not.toBeNull();

    advance(NAVIGATION_SKELETON_MAX_MS);
    expect(skeleton()).toBeNull();
  });

  it("is torn down as soon as the destination route commits", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(skeleton()).not.toBeNull();

    land(PRODUCT_HREF);
    expect(
      skeleton(),
      "The real page has arrived. Holding the skeleton over it to protect the animation would delay the content the shopper asked for.",
    ).toBeNull();
  });

  it("never appears when the navigation lands before the delay, however slow the pictures are", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);

    advance(50);
    undrawnImageInViewport();
    land(PRODUCT_HREF);

    advance(NAVIGATION_SKELETON_DELAY_MS + 100);
    expect(
      skeleton(),
      "The page arrived before the threshold; nothing may raise a skeleton over it afterwards.",
    ).toBeNull();
  });

  it("comes down at the route change even with the pictures still undrawn", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);

    const img = undrawnImageInViewport();
    expect(skeleton()).not.toBeNull();

    land(PRODUCT_HREF);
    expect(
      skeleton(),
      "The destination has committed. Waiting for its images again is a ~1.9 s hold over a page the shopper could be reading.",
    ).toBeNull();
    expect(
      img.complete,
      "The picture is still arriving, which is the whole point of the case.",
    ).toBe(false);
  });

  it.each([
    ["collection", "collection"],
    ["post", "post"],
    ["page", "page"],
    ["product", "product"],
  ] as const)("renders the %s body it was asked for", (_label, kind) => {
    render(null);
    openRequest(kind, PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);
    expect(skeletonKind()).toBe(kind);
  });

  it("hides the skeleton from assistive technology and announces instead", () => {
    render(null);
    openRequest("product", PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);

    expect(skeleton()?.getAttribute("aria-hidden")).toBe("true");

    const status = document.body.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    // Mounted empty, filled on a later commit: assistive technology watches an
    // EXISTING region for changes, so the sentence has to arrive as a change.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(status?.textContent).toBe("Loading product page");
  });
});

/**
 * The geometry contract, added 2026-09-25 after the client reported the header
 * "reloading" on every link press.
 *
 * Nothing reloaded — the overlay was `top: 0` and full-viewport, so it painted over
 * a header that in the App Router is a layout element and never unmounts. These
 * cases pin the two halves of the fix that a unit test can reach: the overlay's top
 * is BOUND to the published header-bottom measurement rather than to 0, and the
 * document-level press swallow lets the now-visible header stay clickable.
 *
 * WHERE IT STOPS. jsdom has no layout engine, so it cannot resolve
 * `var(--headkit-header-bottom, 80px)` to a pixel, and it cannot see that the
 * skeleton body starts flush under the header with no gap and no overlap. Those are
 * browser claims and were measured in Chrome at 1180 and 390 CSS px, with and
 * without a preheader, before and after scrolling past it. What IS assertable here
 * is the binding — that the host reads the property the header publishes, and never
 * renders a `top` of 0 — plus the press behaviour, whose rects are stubbed.
 */
describe("navigation skeleton geometry", () => {
  /** Raise a skeleton and hand back the overlay element. */
  function raise(): HTMLElement {
    render(null);
    openRequest("product", PRODUCT_HREF);
    advance(NAVIGATION_SKELETON_DELAY_MS);
    const el = skeleton();
    if (!el) throw new Error("expected a skeleton to be up");
    return el;
  }

  /** Pretend the overlay resolved to a top of `top` CSS px. */
  function overlayTop(el: HTMLElement, top: number): void {
    el.getBoundingClientRect = () =>
      ({
        top,
        bottom: 900,
        left: 0,
        right: 1180,
        width: 1180,
        height: 900 - top,
      }) as DOMRect;
  }

  const hosts: HTMLElement[] = [];
  afterEach(() => {
    while (hosts.length) hosts.pop()?.remove();
  });

  /** A node at a known vertical band, optionally inside the marked header. */
  function nodeAt(bottom: number, inHeader: boolean): HTMLElement {
    const host = document.createElement("div");
    if (inHeader) host.setAttribute(HEADER_REGION_ATTRIBUTE, "");
    const node = document.createElement("button");
    node.getBoundingClientRect = () =>
      ({
        top: bottom - 20,
        bottom,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
      }) as DOMRect;
    host.appendChild(node);
    document.body.appendChild(host);
    hosts.push(host);
    return node;
  }

  /** Press `node` and report whether the swallow stopped it. */
  function swallowed(node: HTMLElement): boolean {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    });
    act(() => {
      node.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  it("binds its top to the header-bottom property, never to 0", () => {
    const el = raise();
    expect(
      el.style.top,
      "The client's complaint was a full-viewport overlay painting over a header that never unmounts. The top must come from the header's own live measurement.",
    ).toBe(headerBottomCssValue());
    expect(el.style.top).not.toBe("0px");
    expect(el.style.top).toContain(HEADER_BOTTOM_CSS_VAR);
    // The fallback matters as much as the property: a consumer that renders before
    // the first publish must start under a header-sized strip, not over the header.
    expect(el.style.top).toContain(`${DEFAULT_HEADER_BOTTOM_PX}px`);
  });

  it("lets a press through in the header the overlay no longer covers", () => {
    const el = raise();
    overlayTop(el, 110);
    expect(
      swallowed(nodeAt(110, true)),
      "A visible but dead header is a worse lie than a hidden one — the cart button and nav links have to keep working during a pending navigation.",
    ).toBe(false);
  });

  it("still swallows a press on the page under the overlay", () => {
    const el = raise();
    overlayTop(el, 110);
    expect(
      swallowed(nodeAt(400, false)),
      "The overlay is pointer-events-none, so an unswallowed press lands on the old page and starts a second navigation to something the shopper cannot see.",
    ).toBe(true);
  });

  it("swallows a press on a mega-menu panel, which hangs below the header", () => {
    const el = raise();
    overlayTop(el, 110);
    expect(
      swallowed(nodeAt(300, true)),
      "Radix renders the menu viewport inside the nav root, so containment alone would exempt a panel that is under the overlay and invisible.",
    ).toBe(true);
  });
});

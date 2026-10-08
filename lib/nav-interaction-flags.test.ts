// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  isFlagOptedIn,
  navMouseDownEnabled,
  navigationSkeletonEnabled,
} from "@/lib/nav-interaction-flags";
import {
  getNavigationSkeletonRequest,
  resetNavigationSkeletonStore,
} from "@/lib/navigation-skeleton-store";
import { InstantLink } from "@/components/headkit-ui/instant-link";

/**
 * The OFF state of the three navigation-interaction switches, which is the state
 * every storefront on the platform is in until its operator sets a variable.
 *
 * Three claims, in three layers, because a guard on any one of them stays green
 * while the others are broken:
 *
 *  1. THE RULE. Which raw values mean on, and — the half that actually matters —
 *     that everything else means OFF. A flag whose typo silently enables an
 *     interaction change is the failure this table exists to prevent, so the
 *     unrecognised cases are asserted as loudly as the recognised ones.
 *  2. THE REQUESTER. A real `InstantLink`, pressed the way a shopper presses it,
 *     opens NO skeleton request whether the skeleton switch is off or on. The
 *     clicked link does not paint a skeleton; the destination route's
 *     `loading.tsx` does, and only when that page is not ready. The `skeleton`
 *     prop is accepted and unused. With no request there is no rAF watcher and
 *     no 400 ms timer, because both live on the host's reaction to a request
 *     (filter navigations still open one; a link press does not).
 *  3. THE MOUNT. `app/layout.tsx` renders the host behind the same switch, so an
 *     "off" store paints no overlay element at all, and `next.config.ts` reads the
 *     prefetch variable for its own half of that decision.
 *
 * WHERE IT STOPS, and claim 3 is the weak one. It is a SOURCE assertion: the root
 * layout is an async server component that awaits branding, footer menus, branding
 * assets and email-marketing status, so rendering it in a unit test would prove a
 * mock rather than a mount. What it can say is that the host's one render site is
 * inside the gate — precisely the thing a later edit would break by accident. That
 * the switch really removes the element from a served page, and that navigation
 * still works without it, are browser claims over a production build.
 *
 * The ON states of the prefetch and mouse-down switches are the other suites':
 * `instant-link.test.tsx` and `instant-link.mouse-down.test.tsx`. The skeleton
 * switch still gates the overlay host and filter navigations
 * (`skeletons/navigation-skeleton.test.tsx`); it does not make a link press
 * paint one. Each suite DECLARES the variable it tests rather than inheriting
 * the process's.
 */

describe("the value table", () => {
  it("treats an absent variable as OFF, so a store that sets nothing is unchanged", () => {
    expect(isFlagOptedIn(undefined)).toBe(false);
  });

  it("treats an empty string as OFF — Vercel stores a cleared variable that way", () => {
    expect(isFlagOptedIn("")).toBe(false);
    expect(isFlagOptedIn("   ")).toBe(false);
  });

  it.each(["true", "1", "on", "yes", "TRUE", " True ", "ON"])(
    "turns on for %o",
    (raw) => {
      expect(isFlagOptedIn(raw)).toBe(true);
    },
  );

  it.each(["false", "0", "off", "no", "FALSE"])("stays off for %o", (raw) => {
    expect(isFlagOptedIn(raw)).toBe(false);
  });

  // The point of the whole design: an unrecognised value must fail AWAY from the
  // interaction change, so a typo can never hand every shopper new behaviour.
  it.each(["ture", "enabled", "yep", "t", "null", "undefined", "2"])(
    "stays OFF for the unrecognised value %o rather than silently enabling",
    (raw) => {
      expect(isFlagOptedIn(raw)).toBe(false);
    },
  );

  it.each([
    ["NEXT_PUBLIC_NAV_MOUSEDOWN", navMouseDownEnabled],
    ["NEXT_PUBLIC_NAVIGATION_SKELETON", navigationSkeletonEnabled],
  ] as const)(
    "%s is read per call, so a change is observed without re-importing",
    (name, read) => {
      vi.stubEnv(name, "true");
      expect(read()).toBe(true);
      vi.stubEnv(name, "false");
      expect(read()).toBe(false);
      // Absent, stated as a value rather than left to `unstubAllEnvs` — that
      // restores whatever the PROCESS carried, and an absence-means-OFF claim must
      // not depend on how the suite was launched.
      vi.stubEnv(name, undefined);
      expect(read()).toBe(false);
    },
  );

  it("keeps the switches independent", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
    vi.stubEnv("NEXT_PUBLIC_NAVIGATION_SKELETON", undefined);

    expect(navMouseDownEnabled()).toBe(true);
    expect(navigationSkeletonEnabled()).toBe(false);
  });
});

// `InstantLink` renders `next/link`, which needs neither a router nor an app
// context for the press path under test — with the mouse-down switch on, the
// component dispatches a click on its own anchor rather than calling
// `useRouter().push()`, deliberately (see `instant-link.mouse-down.test.tsx`).
// `useLinkStatus` is stubbed because it throws outside a navigation context.
vi.mock("next/link", async () => {
  const actual = await vi.importActual<typeof import("next/link")>("next/link");
  return {
    ...actual,
    useLinkStatus: () => ({ pending: false }),
  };
});

describe("a link press opens no skeleton request", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resetNavigationSkeletonStore();
    window.history.replaceState(null, "", "/");
    // The press has to reach a handler at all, so the mouse-down switch is ON for
    // this describe. It is the SKELETON switch under test here.
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
  });

  const PRODUCT_HREF = "/shop/clothing/jackets/alpine-jacket";

  function pressTheLink(): void {
    act(() => {
      root.render(
        createElement(InstantLink, { href: PRODUCT_HREF }, "Alpine Jacket"),
      );
    });
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    act(() => {
      anchor?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
  }

  it("opens no request, so nothing downstream of it can run", () => {
    vi.stubEnv("NEXT_PUBLIC_NAVIGATION_SKELETON", undefined);
    pressTheLink();
    expect(getNavigationSkeletonRequest()).toBeNull();
  });

  // The control. Without it the test above passes for any reason at all — a broken
  // press, a missing anchor, a mock that swallowed the event. Opting in must
  // still start the navigation (mouse-down dispatches the click) and must still
  // open nothing: `loading.tsx` is the skeleton, and the prop is unused.
  it("still presses the link when the store opts in, and opens no skeleton request", () => {
    vi.stubEnv("NEXT_PUBLIC_NAVIGATION_SKELETON", "true");
    act(() => {
      root.render(
        createElement(
          InstantLink,
          { href: PRODUCT_HREF, skeleton: "product" },
          "Alpine Jacket",
        ),
      );
    });
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    let clicks = 0;
    anchor?.addEventListener("click", () => {
      clicks += 1;
    });
    act(() => {
      anchor?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(
      clicks,
      "mouse-down navigation dispatches the click that starts the route",
    ).toBe(1);
    expect(getNavigationSkeletonRequest()).toBeNull();
  });
});

describe("the gates in source", () => {
  it("renders the skeleton host only behind its switch", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    // Matched as a SHAPE, not as a literal: Prettier decides how the ternary wraps,
    // and a guard that fails on a reformat is a guard people delete.
    expect(layout).toMatch(
      /\{\s*navigationSkeletonEnabled\(\)\s*\?\s*\(?\s*<NavigationSkeletonHost\s*\/>\s*\)?\s*:\s*null\s*\}/,
    );
    // One render site, so the gate above covers all of them.
    expect(layout.match(/<NavigationSkeletonHost \/>/g)).toHaveLength(1);
  });

  it("turns Partial Prefetching on for every store", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/^\s*partialPrefetching: true,\s*$/m);
    expect(config).not.toContain("navPrefetchBudget");
  });

  it("sets images.minimumCacheTTL only from an env value", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain("NEXT_IMAGE_MINIMUM_CACHE_TTL");
    // No hard-coded lifetime: unset must mean Next's own 4 h default, because a
    // merchant who swaps a dashboard logo has no purge path for whatever is set.
    expect(config).not.toMatch(/minimumCacheTTL:\s*\d/);
  });
});

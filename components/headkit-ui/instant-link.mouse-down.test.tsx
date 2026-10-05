// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InstantLink } from "@/components/headkit-ui/instant-link";

/**
 * Mouse-down navigation, in the two states the platform ships it in.
 *
 * THE DEFAULT (`NEXT_PUBLIC_NAV_MOUSEDOWN` unset) is the first describe below and
 * is the state every storefront is in today: a press starts nothing, and the
 * browser's own click drives the navigation. That guard is the one that protects
 * every other store on the platform from an interaction change nobody asked for.
 *
 * WITH THE SWITCH ON, the claim a pure predicate cannot make: starting the
 * navigation at `mousedown` must not leave the `click` that follows the same
 * gesture navigating a SECOND time. The refusal rule itself (left button, modifier
 * keys, target, download) is exhaustively covered in `instant-link.test.tsx`
 * without a DOM. This file exists for the ordering, which is a real-DOM property:
 * the handler dispatches a click on the anchor, React routes that click to
 * `next/link`'s own handler, and the shopper's own click must then arrive and do
 * nothing.
 *
 * WHERE IT STOPS. The `next/link` mock below reproduces the ONE behaviour these
 * tests depend on — calling `props.onClick` first and navigating only if the event
 * was not default-prevented — and nothing else. So this proves the suppression
 * protocol, not that Next's real router behaves this way, and it cannot see a
 * browser's own default action at all: whether cmd-click really opens a tab and
 * right-click really opens a context menu was verified in a browser on the fork
 * this is ported from, recorded in its PR #40. jsdom is opted into per-file here;
 * the global vitest environment stays `node`.
 */

const { navigated } = vi.hoisted(() => ({
  navigated: vi.fn<(href: string) => void>(),
}));

// Mirrors next/link's compose order: the caller's onClick runs first, and the
// navigation happens only if nothing prevented the default.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    replace: _replace,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    replace?: boolean;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigated(href);
      }}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactElement): HTMLAnchorElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(node);
  });
  const anchor = container.querySelector("a");
  if (!anchor) throw new Error("InstantLink rendered no anchor");
  return anchor;
}

function fire(
  anchor: HTMLAnchorElement,
  type: "mousedown" | "click",
  init: MouseEventInit = {},
): void {
  act(() => {
    anchor.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        ...init,
      }),
    );
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  navigated.mockClear();
  // A previous example may have committed an optimistic URL. Every example
  // starts from the page the shopper is leaving.
  window.history.replaceState(null, "", "/");
  // Both switches declared, never inherited: a suite that reads the process's
  // value passes or fails on how it was launched.
  vi.stubEnv("NEXT_PUBLIC_NAVIGATION_SKELETON", undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("InstantLink with NEXT_PUBLIC_NAV_MOUSEDOWN off (the platform default)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", undefined);
  });

  it("starts nothing on mousedown, and the click navigates exactly once", () => {
    const anchor = mount(<InstantLink href="/shop/foo">Product</InstantLink>);

    fire(anchor, "mousedown");
    expect(
      navigated,
      "Navigating on mousedown is an interaction change every store would inherit. Unset must mean today's behaviour: the press does nothing.",
    ).not.toHaveBeenCalled();

    fire(anchor, "click");
    expect(navigated).toHaveBeenCalledTimes(1);
  });

  it("still calls a caller's own onMouseDown, which is not part of the switch", () => {
    const onMouseDown = vi.fn();
    const anchor = mount(
      <InstantLink href="/shop/foo" onMouseDown={onMouseDown}>
        Product
      </InstantLink>,
    );

    fire(anchor, "mousedown");

    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(navigated).not.toHaveBeenCalled();
  });

  it.each(["", "  ", "ture", "enabled", "2", "false"])(
    "stays off for the unrecognised or negative value %o",
    (raw) => {
      vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", raw);
      const anchor = mount(<InstantLink href="/shop/foo">Product</InstantLink>);

      fire(anchor, "mousedown");

      expect(navigated).not.toHaveBeenCalled();
    },
  );
});

describe("InstantLink with NEXT_PUBLIC_NAV_MOUSEDOWN on", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
  });

  it("navigates on mousedown and swallows the click that follows, so the shopper navigates ONCE", () => {
    const anchor = mount(<InstantLink href="/shop/foo">Product</InstantLink>);

    fire(anchor, "mousedown");
    expect(
      navigated,
      "The whole point of the adoption: the navigation starts at mousedown, not at click.",
    ).toHaveBeenCalledTimes(1);

    fire(anchor, "click");
    expect(
      navigated,
      "The real click must be swallowed. Without that, every click navigates twice — one wasted RSC fetch and a duplicate history entry.",
    ).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cmd-click (macOS new tab)", { metaKey: true }],
    ["ctrl-click (Windows/Linux new tab)", { ctrlKey: true }],
    ["shift-click (new window)", { shiftKey: true }],
    ["middle-click (new tab)", { button: 1 }],
    ["right-click (context menu)", { button: 2 }],
  ] as const)(
    "does not navigate on mousedown for %s, and leaves the click untouched",
    (_label, init) => {
      const anchor = mount(<InstantLink href="/shop/foo">Product</InstantLink>);

      fire(anchor, "mousedown", init);
      expect(
        navigated,
        "A refused gesture must reach the browser as itself. Navigating here replaces the shopper's new tab with a same-tab navigation.",
      ).not.toHaveBeenCalled();

      // A plain left-click afterwards proves the refused mousedown left no stale
      // suppression flag behind. (The gesture's own click is not replayed here: a
      // browser delivers no `click` for middle or right button — it fires
      // `auxclick` / `contextmenu` — and React does not route one to `onClick`.)
      fire(anchor, "click");
      expect(navigated).toHaveBeenCalledTimes(1);
    },
  );

  it("lets a KEYBOARD activation through even after a mousedown left a suppression flag set", () => {
    // mousedown, then drag off and release: no click ever arrives to clear the
    // flag. A later Enter on the focused link fires a click with detail === 0 and
    // must still navigate.
    const anchor = mount(<InstantLink href="/shop/foo">Product</InstantLink>);

    fire(anchor, "mousedown");
    expect(navigated).toHaveBeenCalledTimes(1);

    fire(anchor, "click", { detail: 0 });
    expect(
      navigated,
      "Enter on a focused link fires a click with detail 0 and no preceding mousedown; suppressing it would make the link keyboard-inert.",
    ).toHaveBeenCalledTimes(2);
  });

  it("still runs a caller's onClick exactly once across the whole gesture", () => {
    // Radix's dismiss handler and the mobile sheet's close both arrive this way,
    // and both are wrong if they fire twice or not at all.
    const onClick = vi.fn();
    const anchor = mount(
      <InstantLink href="/shop/foo" onClick={onClick}>
        Product
      </InstantLink>,
    );

    fire(anchor, "mousedown");
    fire(anchor, "click");

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(navigated).toHaveBeenCalledTimes(1);
  });

  it("still calls a caller's own onMouseDown", () => {
    const onMouseDown = vi.fn();
    const anchor = mount(
      <InstantLink href="/shop/foo" onMouseDown={onMouseDown}>
        Product
      </InstantLink>,
    );

    fire(anchor, "mousedown");

    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it("does not hijack the plain <a> branch: a tel: link navigates nowhere on mousedown", () => {
    const anchor = mount(<InstantLink href="tel:1300883919">Call</InstantLink>);

    fire(anchor, "mousedown");
    fire(anchor, "click");

    expect(
      navigated,
      "Non-app hrefs never reach next/link at all; they must keep pure browser default behaviour.",
    ).not.toHaveBeenCalled();
  });
});

describe("optimistic address bar", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", undefined);
  });

  it("pushStates the destination on click and still lets next/link navigate", () => {
    const prior = { __NA: true, tree: "current-page" };
    window.history.replaceState(prior, "", "/collections/road");
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(
      <InstantLink href="/products/bike?color=red">Bike</InstantLink>,
    );

    fire(anchor, "click");

    expect(navigated).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[0]).toBe(prior);
    expect(pushState.mock.calls[0]?.[2]).toBe("/products/bike?color=red");
    expect(window.location.pathname + window.location.search).toBe(
      "/products/bike?color=red",
    );
  });

  it("replaceStates when the link asks to replace", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(
      <InstantLink href="/products/bike" replace>
        Bike
      </InstantLink>,
    );

    fire(anchor, "click");

    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/products/bike");
  });

  it.each([
    ["cmd-click", { metaKey: true }],
    ["ctrl-click", { ctrlKey: true }],
    ["shift-click", { shiftKey: true }],
    ["alt-click", { altKey: true }],
  ] as const)("does not move this tab on %s", (_label, init) => {
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(<InstantLink href="/products/bike">Bike</InstantLink>);

    fire(anchor, "click", init);

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("does not move this tab when the link opens elsewhere or downloads", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const blank = mount(
      <InstantLink href="/products/bike" target="_blank">
        Bike
      </InstantLink>,
    );
    fire(blank, "click");
    act(() => root.unmount());
    blank.remove();

    const download = mount(
      <InstantLink href="/products/bike" download>
        Bike
      </InstantLink>,
    );
    fire(download, "click");

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("does not move this tab when the caller already handled the click", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(
      <InstantLink
        href="/products/bike"
        onClick={(event) => event.preventDefault()}
      >
        Bike
      </InstantLink>,
    );

    fire(anchor, "click");

    expect(navigated).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not add a history entry when the click is already this address", () => {
    window.history.replaceState(null, "", "/products/bike");
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(<InstantLink href="/products/bike">Bike</InstantLink>);

    fire(anchor, "click");

    expect(navigated).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("commits the address once when mouse-down navigation dispatches the click", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
    const pushState = vi.spyOn(window.history, "pushState");
    const anchor = mount(<InstantLink href="/products/bike">Bike</InstantLink>);

    fire(anchor, "mousedown");
    fire(anchor, "click");

    expect(navigated).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/products/bike");
  });
});

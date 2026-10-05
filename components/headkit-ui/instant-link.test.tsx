import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  InstantLink,
  mouseDownNavigationRefusal,
  optimisticHistoryUrl,
} from "@/components/headkit-ui/instant-link";

const { observedPrefetch } = vi.hoisted(() => ({
  observedPrefetch: vi.fn<(prefetch: boolean | undefined) => void>(),
}));

/**
 * Regression cover for `InstantLink`'s prop-forwarding contract.
 *
 * `InstantLink` routes every non-app href (`#`, `tel:`, `mailto:`, absolute
 * http(s)) down a plain `<a>` branch, and that branch used to render
 * `<a href className>` and nothing else — every other prop it was handed was
 * silently dropped.
 *
 * That forwarding is load-bearing wherever `InstantLink` is an `asChild` target
 * or receives handlers for a non-app href, because the parent injects its wiring
 * through the child's props:
 *   - `MegaMenu`'s `NavigationMenuLink asChild > InstantLink` for `#` / `tel:`
 *     CHILD links (navigation-bar.tsx), which dropped Radix's dismiss handler.
 *   - `MobileMenuItem`'s `onClick={onSelect}` on non-app-href links, which
 *     closes the mobile sheet.
 *
 * A top-level `#` dropdown PARENT is no longer this shape: `DesktopMenuSection`
 * renders those as a plain Radix `<button>` with no href, and
 * `navigation-bar.test.tsx` owns that path. The `NavigationMenuTrigger asChild`
 * tree below is kept as a direct test of the forwarding contract itself — the
 * strictest `asChild` consumer, and the shape the original defect was found in.
 *
 * These assert the prop plumbing rather than a click, because the defect was
 * visible in server-rendered markup: on the live storefront the broken item
 * carried neither `data-state` nor `data-radix-collection-item`, while every
 * working sibling carried both.
 */

// next/link is only reached on the in-app branch; a passthrough keeps this a
// node-environment render with no router.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    observedPrefetch(prefetch);
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderTrigger(href: string): string {
  return renderToStaticMarkup(
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger asChild>
            <InstantLink href={href} pendingVariant="text">
              Events
            </InstantLink>
          </NavigationMenuTrigger>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>,
  );
}

/**
 * The prefetch-resolution contract, in BOTH states of the prefetch budget.
 *
 * `InstantLink` defaults `prefetch` to `true`, which is what the starter's 50-odd
 * call sites were written against. With `NEXT_PUBLIC_NAV_PREFETCH_BUDGET` on it
 * defaults to UNSET instead, and only the two surfaces that ask explicitly keep a
 * full prefetch. The measurement behind the budget is on the Bike Society fork: 63
 * product links on one home page, a sweep whose last prefetch landed at 33,084 ms
 * having covered 31 of 213 links, and a click made during it costing 4.0-5.8 s MORE
 * than the same click with prefetching blocked.
 *
 * WHAT THESE COVER: what `InstantLink` hands `next/link` — `true` by default,
 * `undefined` under the budget, and whatever the caller said when the caller was
 * explicit. That is the prop plumbing and nothing else.
 *
 * WHERE THEY STOP, and it is a wide stop:
 *   - They do NOT exercise Next's own prefetch behaviour. What `undefined`
 *     ('auto' → `FetchStrategy.PPR`) versus `true` ('full' → `FetchStrategy.Full`)
 *     actually puts on the wire is Next's code, observable only over HTTP.
 *   - They do NOT cover the 50-odd other `InstantLink` call sites. Only the two
 *     surfaces that pass an explicit `true` are covered, in
 *     `prefetch-budget.test.tsx`, and only for the shapes named there.
 *   - They say nothing about hover/touch prefetch, which `prefetch={false}`
 *     disables and an unset value keeps.
 */
describe("InstantLink prefetch resolution", () => {
  it("defaults to prefetch={true} with the budget OFF, which is today's platform behaviour", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_PREFETCH_BUDGET", undefined);
    observedPrefetch.mockClear();

    renderToStaticMarkup(<InstantLink href="/shop/foo">Product</InstantLink>);

    expect(
      observedPrefetch,
      "Removing the default is a platform-wide change to perceived navigation speed. Unset must keep it.",
    ).toHaveBeenCalledWith(true);
  });

  it("passes prefetch through UNSET with the budget ON", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_PREFETCH_BUDGET", "true");
    observedPrefetch.mockClear();

    renderToStaticMarkup(<InstantLink href="/shop/foo">Product</InstantLink>);

    expect(
      observedPrefetch,
      "Under the budget an unset prop is next/link's 'auto' intent; defaulting it to true is what produced the 63-link prefetch storm.",
    ).toHaveBeenCalledWith(undefined);
  });

  it.each(["", "ture", "2"])(
    "keeps the default for the unrecognised budget value %o",
    (raw) => {
      vi.stubEnv("NEXT_PUBLIC_NAV_PREFETCH_BUDGET", raw);
      observedPrefetch.mockClear();

      renderToStaticMarkup(<InstantLink href="/shop/foo">Product</InstantLink>);

      expect(observedPrefetch).toHaveBeenCalledWith(true);
    },
  );

  it("forwards an explicit prefetch={true} in either state", () => {
    for (const budget of [undefined, "true"]) {
      vi.stubEnv("NEXT_PUBLIC_NAV_PREFETCH_BUDGET", budget);
      observedPrefetch.mockClear();

      renderToStaticMarkup(
        <InstantLink href="/shop/foo" prefetch>
          Product
        </InstantLink>,
      );

      expect(
        observedPrefetch,
        "The warm-link opt-in is the whole point of the budget: an explicit prefetch={true} must still reach next/link.",
      ).toHaveBeenCalledWith(true);
    }
  });

  it("forwards an explicit prefetch={false} rather than swallowing it", () => {
    // `false` is a real, different mode ('none': no viewport prefetch AND no
    // hover/touch prefetch), so it must not be collapsed into the default.
    vi.stubEnv("NEXT_PUBLIC_NAV_PREFETCH_BUDGET", "true");
    observedPrefetch.mockClear();

    renderToStaticMarkup(
      <InstantLink href="/shop/foo" prefetch={false}>
        Product
      </InstantLink>,
    );

    expect(observedPrefetch).toHaveBeenCalledWith(false);
  });
});

describe("InstantLink as a Radix asChild target", () => {
  it("forwards injected asChild wiring for a '#' href", () => {
    const html = renderTrigger("#");

    // The wiring Radix injects through props. Without prop forwarding the
    // anchor rendered bare and every injected handler was lost.
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("data-radix-collection-item");
    expect(html).toContain('href="#"');
  });

  it("forwards the same wiring for an in-app href", () => {
    // Guards the assertion above against being trivially true: the in-app
    // branch ('/booths') must produce the same injected markup.
    const html = renderTrigger("/booths");

    expect(html).toContain('data-state="closed"');
    expect(html).toContain("data-radix-collection-item");
  });

  it("forwards handlers and ARIA to a tel: link", () => {
    const html = renderToStaticMarkup(
      <InstantLink
        href="tel:1300883919"
        aria-label="Call us"
        data-testid="phone"
      >
        Call
      </InstantLink>,
    );

    expect(html).toContain('href="tel:1300883919"');
    expect(html).toContain('aria-label="Call us"');
    expect(html).toContain('data-testid="phone"');
  });

  it("does not leak next/link-only props onto the DOM anchor", () => {
    const html = renderToStaticMarkup(
      <InstantLink href="#" replace scroll={false} prefetch={false}>
        Events
      </InstantLink>,
    );

    // React would warn (and the attribute would ship) if these reached <a>.
    expect(html).not.toContain("replace");
    expect(html).not.toContain("scroll");
    expect(html).not.toContain("prefetch");
  });

  it("normalizes absolute storefront URLs to in-app Link paths", () => {
    const html = renderToStaticMarkup(
      <InstantLink href="https://velvet.headkit.app/shop">Shop</InstantLink>,
    );

    expect(html).toContain('href="/shop"');
    expect(html).not.toContain("velvet.headkit.app");
  });

  it("keeps Instagram absolute and opens in a new tab", () => {
    const html = renderToStaticMarkup(
      <InstantLink href="https://www.instagram.com/velvetmuse/">
        Instagram
      </InstantLink>,
    );

    expect(html).toContain('href="https://www.instagram.com/velvetmuse/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

/**
 * The mouse-down navigation guard (NextFaster technique 1), which is the rule
 * whether or not a store has switched the behaviour on.
 *
 * WHAT THESE COVER: the refusal rule itself, exhaustively, for the five gestures
 * that must keep their browser default — middle-click, ctrl-click, cmd-click,
 * shift-click, right-click — plus alt-click, a `target` that opens elsewhere, a
 * `download` anchor, and an event some ancestor already claimed.
 *
 * WHERE THEY STOP: this is a pure predicate, so it says nothing about what
 * `InstantLink` then does with the answer. That the plain left-click actually
 * navigates, that the click following it does NOT navigate a second time, and that
 * the whole behaviour is off until a store opts in, are in
 * `instant-link.mouse-down.test.tsx`. That a real browser honours the refusals — a
 * new tab genuinely opening on cmd-click, a context menu genuinely appearing — is
 * only observable in a browser, and the fork's PR #40 measured all five.
 */
describe("mouseDownNavigationRefusal", () => {
  const plainLeftClick = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("allows a plain left-click", () => {
    expect(mouseDownNavigationRefusal(plainLeftClick)).toBeNull();
  });

  it("refuses middle-click, which is open-in-new-tab", () => {
    expect(
      mouseDownNavigationRefusal({ ...plainLeftClick, button: 1 }),
      "Middle-click opens a product in a new tab. Hijacking it into a same-tab navigation loses the page the shopper was comparing from.",
    ).toBe("not-left-button");
  });

  it("refuses right-click, which opens the context menu and navigates nowhere", () => {
    expect(mouseDownNavigationRefusal({ ...plainLeftClick, button: 2 })).toBe(
      "not-left-button",
    );
  });

  it.each([
    ["ctrl-click (Windows/Linux new tab)", "ctrlKey"],
    ["cmd-click (macOS new tab)", "metaKey"],
    ["shift-click (new window)", "shiftKey"],
    ["alt-click (download the target)", "altKey"],
  ] as const)("refuses %s", (_label, key) => {
    expect(mouseDownNavigationRefusal({ ...plainLeftClick, [key]: true })).toBe(
      "modifier-key",
    );
  });

  it("refuses an event an ancestor already claimed", () => {
    expect(
      mouseDownNavigationRefusal({
        ...plainLeftClick,
        defaultPrevented: true,
      }),
    ).toBe("already-handled");
  });

  it("refuses an anchor that targets another tab, and allows _self / unset", () => {
    expect(
      mouseDownNavigationRefusal({
        ...plainLeftClick,
        anchorTarget: "_blank",
      }),
    ).toBe("opens-elsewhere");
    expect(
      mouseDownNavigationRefusal({ ...plainLeftClick, anchorTarget: "_self" }),
    ).toBeNull();
    expect(
      mouseDownNavigationRefusal({ ...plainLeftClick, anchorTarget: "" }),
    ).toBeNull();
    expect(
      mouseDownNavigationRefusal({ ...plainLeftClick, anchorTarget: null }),
    ).toBeNull();
  });

  it("refuses a download anchor", () => {
    expect(
      mouseDownNavigationRefusal({ ...plainLeftClick, anchorDownload: true }),
    ).toBe("download");
  });
});

const here = {
  origin: "https://shop.example",
  pathname: "/collections/road",
  search: "",
  hash: "",
};

describe("optimisticHistoryUrl", () => {
  it("returns the destination path, search, and hash for an in-app href", () => {
    expect(
      optimisticHistoryUrl("/products/bike?color=red#gallery", here),
    ).toBe("/products/bike?color=red#gallery");
  });

  it("resolves a relative href against the current page", () => {
    expect(optimisticHistoryUrl("bike", here)).toBe("/collections/bike");
  });

  it("returns null when the address is already showing that href", () => {
    expect(optimisticHistoryUrl("/collections/road", here)).toBeNull();
    expect(
      optimisticHistoryUrl("/collections/road?page=2", {
        ...here,
        search: "?page=2",
      }),
    ).toBeNull();
  });

  it("returns null for another origin, a bad href, and a non-url", () => {
    expect(
      optimisticHistoryUrl("https://other.example/products/bike", here),
    ).toBeNull();
    expect(optimisticHistoryUrl("http://[bad", here)).toBeNull();
  });
});

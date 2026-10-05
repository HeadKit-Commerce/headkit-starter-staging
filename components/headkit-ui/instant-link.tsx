"use client";

import Link from "next/link";
import { useRef, type ComponentProps, type ReactNode } from "react";
import { convertToRelativePath, isAppNavigationHref } from "@/lib/convert-uri";
import type { NavigationSkeletonKind } from "@/lib/navigation-skeleton-target";
import {
  navMouseDownEnabled,
  navPrefetchBudgetEnabled,
} from "@/lib/nav-interaction-flags";
import { cn } from "@/lib/utils";

type PendingVariant = "card" | "text";

type InstantLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  /**
   * Accepted so existing call sites keep typechecking. The clicked link does
   * not paint a pending state. The destination route's `loading.tsx` is the
   * skeleton, and only when that page is not ready.
   */
  pendingVariant?: PendingVariant;
  /**
   * Accepted so existing call sites keep typechecking. The destination
   * route's `loading.tsx` chooses the skeleton. This prop is not a second
   * overlay on the page the shopper is leaving.
   */
  skeleton?: NavigationSkeletonKind | null | undefined;
  /**
   * Widened from `next/link`'s own `boolean | 'auto' | null`, which under this
   * repo's `exactOptionalPropertyTypes` rejects an explicit `undefined`. Callers
   * that decide per item (`ProductCarousel`'s `prefetchCount`, the nav's threaded
   * flag) need to say "unset" as a VALUE, so `undefined` is allowed here and is
   * resolved by `resolvePrefetch` below rather than forwarded blindly.
   */
  prefetch?: ComponentProps<typeof Link>["prefetch"] | undefined;
};

/**
 * What a link with no explicit `prefetch` asks `next/link` for.
 *
 * WITHOUT the prefetch budget (the platform default), `true` — every in-app link
 * full-prefetches, which is what the starter has always done and what its 50-odd
 * call sites were written against.
 *
 * WITH the budget on, unset — `next/link`'s own `'auto'` intent. Under
 * `cacheComponents` that maps to `FetchStrategy.PPR`
 * (`next/dist/client/app-dir/link.js`, `getFetchStrategyFromPrefetchIntent`): a
 * `/_tree` request plus the route's static per-segment bundles, and NO runtime
 * request. `prefetch={true}` maps to `FetchStrategy.Full`, which downloads the
 * whole per-URL payload so `'use cache'` content keyed on `params` resolves before
 * the click.
 *
 * Why the budget exists at all: `true` per link wins once it lands (78-90 ms vs
 * ~3,000 ms to navigate, measured on the Bike Society fork) and loses until it
 * does. That storefront's home page carries 63 product links at ~250-275 KB
 * decoded each, so the sweep never finished — measured live 2026-09-15, the last
 * prefetch completed at 33,084 ms having covered 31 of 213 links, and a
 * product-card click made during that window cost 4.0-5.8 s MORE than the same
 * click with every prefetch blocked. Next's own scheduler is what orders a
 * page of `prefetch={true}` links: viewport first, the hovered link in front,
 * and that hover is not cancelled when the pointer leaves
 * (https://nextjs.org/docs/app/guides/prefetching#prefetch-scheduling).
 * Product cards pass `prefetch={true}` so the current page's products are in
 * that queue. With the budget on, an unset non-product link stays on `'auto'`.
 *
 * The budget also turns on `partialPrefetching` in `next.config.ts`, from the same
 * variable — that is what makes an unset `prefetch` cheap. See
 * `lib/nav-interaction-flags.ts`.
 *
 * Do NOT reach for `prefetch={false}` to quieten a link: that is `'none'`, and
 * `link.js`'s hover handler returns early on it, so it disables hover and touch
 * prefetch too. Unset keeps those.
 */
function resolvePrefetch(
  explicit: ComponentProps<typeof Link>["prefetch"] | undefined,
): ComponentProps<typeof Link>["prefetch"] | undefined {
  if (explicit !== undefined) return explicit;
  return navPrefetchBudgetEnabled() ? undefined : true;
}

function hrefToString(href: ComponentProps<typeof Link>["href"]): string {
  if (typeof href === "string") return href;
  if (href != null && typeof href === "object" && "pathname" in href) {
    return href.pathname ?? "";
  }
  return "";
}

function normalizeLinkHref(
  href: ComponentProps<typeof Link>["href"],
): ComponentProps<typeof Link>["href"] {
  if (typeof href === "string") {
    const normalized = convertToRelativePath(href);
    return normalized || href;
  }
  if (
    href != null &&
    typeof href === "object" &&
    "pathname" in href &&
    typeof href.pathname === "string"
  ) {
    const normalized = convertToRelativePath(href.pathname);
    if (normalized && normalized !== href.pathname) {
      return { ...href, pathname: normalized };
    }
  }
  return href;
}

/**
 * Why a mouse-down navigation must refuse most of the presses it sees.
 *
 * Only reached when a store opts into `NEXT_PUBLIC_NAV_MOUSEDOWN`; the predicate
 * itself is always exported, because it is the rule and it is tested as one.
 *
 * Adopted from NextFaster (`src/components/ui/link.tsx`): a click is 80-150 ms of
 * `mousedown` → `mouseup` → `click` that the navigation does not have to wait
 * for, and starting it at `mousedown` costs the origin nothing. Measured on the
 * fork against a 120 ms press, the target route's first request leaves at 28-33 ms
 * after the press instead of 175-180 ms.
 *
 * The whole risk is in what it must NOT hijack. A shopper comparing products
 * opens several in tabs, and every one of those gestures arrives as a `mousedown`
 * on a product link:
 *
 *   - middle-click (`button === 1`) — open in a new tab
 *   - ctrl-click (Windows/Linux) and cmd-click (macOS) — open in a new tab
 *   - shift-click — open in a new window
 *   - right-click (`button === 2`) — context menu, navigating nowhere
 *   - alt-click — the browser's download-the-target gesture
 *
 * Hijacking any of them replaces the shopper's gesture with a same-tab navigation
 * and loses the page they were on. So this returns a REASON for every refusal
 * rather than a bare boolean, and `null` only for the plain left-click with no
 * modifier on an anchor that targets this tab.
 *
 * It is a pure function of the fields it reads so the refusals are testable
 * without a DOM (`instant-link.test.tsx`, node environment); the DOM-level claim
 * it cannot make — that mouse-down navigating does not leave the following click
 * navigating a SECOND time — is covered separately, in jsdom
 * (`instant-link.mouse-down.test.tsx`).
 */
export type MouseDownNavigationRefusal =
  | "not-left-button"
  | "modifier-key"
  | "already-handled"
  | "opens-elsewhere"
  | "download";

export function mouseDownNavigationRefusal(event: {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The anchor's own `target`; `""`/absent means this tab. */
  anchorTarget?: string | null | undefined;
  /** Whether the anchor carries a `download` attribute. */
  anchorDownload?: boolean | undefined;
}): MouseDownNavigationRefusal | null {
  // Something upstream (a Radix trigger, a caller's own handler) already claimed
  // this gesture.
  if (event.defaultPrevented) return "already-handled";
  // 0 = primary. 1 = middle (new tab), 2 = secondary (context menu).
  if (event.button !== 0) return "not-left-button";
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return "modifier-key";
  }
  if (event.anchorDownload) return "download";
  const target = event.anchorTarget ?? "";
  if (target !== "" && target !== "_self") return "opens-elsewhere";
  return null;
}

/**
 * Next.js 16.3 Instant Navigation link.
 *
 * Prefetch-on-intent and mouse-down navigation stay. The clicked link does
 * not paint its own skeleton: the destination route's `loading.tsx` is shown
 * only when that page is not already ready. `lib/nav-interaction-flags.ts`
 * owns the prefetch and mouse-down switches; `resolvePrefetch` above owns
 * the prefetch half.
 *
 * Absolute http(s) storefront URLs from WooCommerce/Shopify CMS fields are
 * normalized to relative paths (same as nav menus) so carousel CTAs and block
 * buttons get Next.js prefetch instead of a full document load.
 *
 * Non-app hrefs (`tel:`, `mailto:`, `#`, off-origin http(s), …) render a plain
 * `<a>` so special-scheme Custom Links from WordPress menus keep working. That
 * branch gets none of the three behaviours above: off-origin, `tel:`, `mailto:`
 * and `#` hrefs keep pure browser default behaviour.
 *
 * WITH `NEXT_PUBLIC_NAV_MOUSEDOWN` ON, an in-app navigation is started by
 * dispatching a click on the anchor (`anchor.click()`) rather than by calling
 * `useRouter().push()`, for two reasons. It reuses `next/link`'s own click
 * handler, so `replace`, `scroll`, `onNavigate`, and any injected `onClick` (Radix's dismiss, the mobile sheet's close) all
 * behave exactly as they do on a real click. And it adds no router-context
 * dependency: this component is server-rendered bare by a dozen test files, and
 * `useRouter()` throws without an app-router context.
 *
 * The real `click` that follows is then swallowed, or the shopper navigates twice.
 * `event.detail > 0` is what separates it from a KEYBOARD activation — Enter on a
 * focused link fires a click with `detail === 0` and no preceding `mousedown`, so
 * it must always pass through even if a stale suppression flag is set (mouse-down
 * on a link, drag off, release: no click ever arrives to clear it).
 *
 * That plain `<a>` MUST still forward every prop it was handed. InstantLink is
 * used as a Radix `asChild` target (see NavigationBar), and Radix injects the
 * trigger wiring — `ref`, `onPointerEnter`/`onClick`, `id`, `aria-expanded`,
 * `data-state`, `data-radix-collection-item` — through the child's props. Dropping
 * them turned a WordPress mega-menu parent whose Custom Link URL is `#` (the
 * conventional "opens a dropdown, navigates nowhere" parent) into an inert anchor:
 * the trigger never mounted, so its children were unreachable and the item looked
 * like a plain top-level link. Only `next/link`-specific props are stripped — they
 * are not valid DOM attributes on `<a>`.
 */
/**
 * The address a click should show immediately, or null when it should not
 * touch the history entry.
 *
 * Catalogue pages await their cached read before returning UI, so Next does
 * not call `pushState` until that read finishes and the address bar stays on
 * the page being left. Committing the destination here moves the bar on the
 * click. The state written is the one Next already stored (`history.state`,
 * which carries `__NA`). Next patches `pushState`, and a state without
 * `__NA` is treated as an external navigation. When the payload arrives,
 * Next `replaceState`s this same entry because the URL already matches, and
 * Back still returns to the page that was left.
 *
 * A page-level `<Suspense>` would also move the URL, which is the Instant
 * Navigation guide's shape. It is not how these routes are built. On Next.js
 * 16.3.8, `notFound()` inside that boundary answers 200, and a completed
 * boundary larger than 500 bytes is outlined into `<div hidden id="S:…">`
 * once the document has passed 12 KB, so the prerendered product would not
 * be in the first paint.
 */
export function optimisticHistoryUrl(
  href: string,
  location: { origin: string; pathname: string; search: string; hash: string },
): string | null {
  let url: URL;
  try {
    // Resolve the way the browser does: `bike` on `/collections/road` is
    // `/collections/bike`, not `/bike`.
    url = new URL(
      href,
      `${location.origin}${location.pathname}${location.search}`,
    );
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  return next === current ? null : next;
}

function commitOptimisticUrl(
  href: ComponentProps<typeof Link>["href"],
  replace: boolean | undefined,
): void {
  if (typeof window === "undefined") return;
  const hrefStr = typeof href === "string" ? href : hrefToString(href);
  if (!hrefStr) return;
  const next = optimisticHistoryUrl(hrefStr, window.location);
  if (!next) return;
  const state = window.history.state;
  try {
    if (replace) window.history.replaceState(state, "", next);
    else window.history.pushState(state, "", next);
  } catch {
    // A URL the history API rejects must not swallow the navigation.
  }
}

export function InstantLink({
  prefetch,
  pendingVariant: _pendingVariant = "card",
  skeleton: _skeleton,
  className,
  children,
  href,
  ...rest
}: InstantLinkProps): React.JSX.Element {
  // Set while a mouse-down-initiated navigation is in flight, so the real `click`
  // that follows the same gesture is swallowed instead of navigating a second
  // time. A ref, not state: nothing renders from it.
  const suppressNextClickRef = useRef(false);

  const normalizedHref = normalizeLinkHref(href);
  const hrefStr = hrefToString(normalizedHref);

  if (hrefStr && !isAppNavigationHref(hrefStr)) {
    // Destructured (not deleted by key) so a future next/link rename fails the
    // typecheck here instead of silently leaking a prop onto the DOM.
    const {
      as: _as,
      replace: _replace,
      scroll: _scroll,
      shallow: _shallow,
      passHref: _passHref,
      locale: _locale,
      legacyBehavior: _legacyBehavior,
      onNavigate: _onNavigate,
      ...anchorProps
    } = rest;
    const isHttpExternal =
      hrefStr.startsWith("http://") || hrefStr.startsWith("https://");
    return (
      <a
        {...anchorProps}
        href={hrefStr}
        className={cn("relative cursor-pointer", className)}
        {...(isHttpExternal
          ? {
              target: anchorProps.target ?? "_blank",
              rel: anchorProps.rel ?? "noopener noreferrer",
            }
          : {})}
      >
        {children as ReactNode}
      </a>
    );
  }

  const {
    onMouseDown: callerOnMouseDown,
    onClick: callerOnClick,
    replace,
    ...linkRest
  } = rest;

  const resolvedPrefetch = resolvePrefetch(prefetch);

  const handleMouseDown = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ): void => {
    callerOnMouseDown?.(event);
    if (!navMouseDownEnabled()) return;
    suppressNextClickRef.current = false;
    const anchor = event.currentTarget;
    if (
      mouseDownNavigationRefusal({
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        anchorTarget: anchor.getAttribute("target"),
        anchorDownload: anchor.hasAttribute("download"),
      }) !== null
    ) {
      return;
    }
    // Dispatched BEFORE the flag is raised, so this click is the one that
    // navigates and only the shopper's own click is swallowed.
    anchor.click();
    suppressNextClickRef.current = true;
  };

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (suppressNextClickRef.current && event.detail > 0) {
      suppressNextClickRef.current = false;
      // stopPropagation as well as preventDefault: the dispatched click has
      // already bubbled to every ancestor handler once.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    suppressNextClickRef.current = false;
    callerOnClick?.(event);
    if (event.defaultPrevented) return;
    // next/link runs after this handler and ignores a modified click. Moving
    // the address bar first would change this tab while the browser opens
    // another one.
    const anchor = event.currentTarget;
    if (
      mouseDownNavigationRefusal({
        button: event.button,
        defaultPrevented: false,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        anchorTarget: anchor.getAttribute("target"),
        anchorDownload: anchor.hasAttribute("download"),
      }) !== null ||
      event.nativeEvent.which === 2
    ) {
      return;
    }
    commitOptimisticUrl(normalizedHref, replace);
  };

  return (
    <Link
      {...linkRest}
      {...(replace === undefined ? {} : { replace })}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      href={normalizedHref}
      // Omitted, not passed as `undefined`: `next/link`'s own prop type is
      // `boolean | 'auto' | null` and this repo runs `exactOptionalPropertyTypes`,
      // so an explicit `undefined` does not typecheck. An absent prop is what
      // 'auto' means.
      {...(resolvedPrefetch === undefined
        ? {}
        : { prefetch: resolvedPrefetch })}
      className={cn("relative cursor-pointer", className)}
    >
      {children}
    </Link>
  );
}

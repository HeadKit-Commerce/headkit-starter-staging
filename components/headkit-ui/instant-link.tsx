"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { convertToRelativePath, isAppNavigationHref } from "@/lib/convert-uri";
import { navMouseDownEnabled } from "@/lib/nav-interaction-flags";
import { cn } from "@/lib/utils";

type PendingVariant = "card" | "text";

type NextPrefetch = ComponentProps<typeof Link>["prefetch"];

type InstantLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  /**
   * Accepted so existing call sites keep typechecking. The clicked link does
   * not paint a pending state. The destination route's `loading.tsx` is shown
   * when that page is not ready.
   */
  pendingVariant?: PendingVariant;
  /**
   * Widened from `next/link`'s own `boolean | 'auto' | null`, which under this
   * repo's `exactOptionalPropertyTypes` rejects an explicit `undefined`. Callers
   * that decide per item (`ProductCarousel`'s `prefetchCount`, the nav's threaded
   * flag) need to say "unset" as a VALUE, so `undefined` is allowed here and is
   * forwarded only when the caller set it. An omitted prop is Next's `'auto'`.
   *
   * `"intent"` (vercel/shop pattern): stay on `'auto'` (App Shell only under
   * Partial Prefetching) until hover/focus-visible or a settled viewport
   * intersection upgrades to a full per-link prefetch. Dense PLP grids pass
   * this so every card does not join the prefetch queue at once.
   */
  prefetch?: NextPrefetch | "intent" | undefined;
};

const HOVER_INTENT_DELAY_MS = 100;
const SETTLE_INTENT_DELAY_MS = 300;
const SETTLE_INTENT_LIMIT = 4;

interface Connection {
  effectiveType?: string;
  saveData?: boolean;
}

const settleCandidates = new Set<HTMLAnchorElement>();
const settleUpgrades = new Map<HTMLAnchorElement, () => void>();
let settleObserver: IntersectionObserver | undefined;
let settleTimer: number | undefined;
let touchPrimary: MediaQueryList | undefined;

function canUpgrade(anchor: HTMLAnchorElement): boolean {
  const connection = (navigator as Navigator & { connection?: Connection })
    .connection;

  if (
    !anchor.isConnected ||
    document.visibilityState !== "visible" ||
    !navigator.onLine ||
    connection?.saveData ||
    connection?.effectiveType?.endsWith("2g") ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target.toLowerCase() !== "_self") ||
    anchor.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  try {
    const current = new URL(window.location.href);
    const destination = new URL(anchor.href);

    // Root ensureStatic="prefetch" keeps per-link prefetches static, so search
    // params resolve only on navigation and a same-path upgrade adds nothing.
    return (
      (destination.protocol === "http:" || destination.protocol === "https:") &&
      destination.origin === current.origin &&
      destination.pathname !== current.pathname
    );
  } catch {
    return false;
  }
}

function isTouchPrimary(): boolean {
  touchPrimary ??= window.matchMedia("(hover: none)");
  return touchPrimary.matches;
}

function scheduleSettleIntent() {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(upgradeSettledLinks, SETTLE_INTENT_DELAY_MS);
}

function cancelSettleIntent() {
  window.clearTimeout(settleTimer);
}

function upgradeSettledLinks() {
  const center = window.innerHeight / 2;
  const destinations = new Map<
    string,
    { anchors: HTMLAnchorElement[]; distance: number }
  >();

  for (const anchor of settleCandidates) {
    if (!canUpgrade(anchor)) continue;
    const rect = anchor.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - center);
    const destination = destinations.get(anchor.href);
    if (destination) {
      destination.anchors.push(anchor);
      destination.distance = Math.min(destination.distance, distance);
    } else {
      destinations.set(anchor.href, { anchors: [anchor], distance });
    }
  }

  const nearest = [...destinations.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, SETTLE_INTENT_LIMIT);
  for (const { anchors } of nearest) {
    for (const anchor of anchors) settleUpgrades.get(anchor)?.();
  }
}

function observeSettleIntent(
  anchor: HTMLAnchorElement,
  upgrade: () => void,
): () => void {
  if (!settleObserver) {
    window.addEventListener("scroll", scheduleSettleIntent, {
      capture: true,
      passive: true,
    });
    settleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLAnchorElement;
          if (entry.isIntersecting) settleCandidates.add(target);
          else settleCandidates.delete(target);
        }
        scheduleSettleIntent();
      },
      { rootMargin: "-25% 0px" },
    );
  }

  settleUpgrades.set(anchor, upgrade);
  settleObserver.observe(anchor);

  return () => {
    settleCandidates.delete(anchor);
    settleUpgrades.delete(anchor);
    settleObserver?.unobserve(anchor);
  };
}

function assignRef(
  ref: Ref<HTMLAnchorElement> | undefined,
  anchor: HTMLAnchorElement | null,
) {
  if (typeof ref === "function") ref(anchor);
  else if (ref) ref.current = anchor;
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
 * Next.js Instant Navigation link.
 *
 * Prefetch-on-intent and mouse-down navigation stay. The clicked link does
 * not paint its own pending state — the destination route's `loading.tsx` is shown
 * only when that page is not already ready. `lib/nav-interaction-flags.ts`
 * owns the mouse-down switch. Prefetch is whatever the caller passed;
 * an omitted prop is Next's `'auto'`. `"intent"` upgrades to a full per-link
 * prefetch on hover / focus-visible / settled viewport (max 4), matching
 * vercel/shop's dense-grid budget.
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
 * handler, so `replace`, `scroll`, `onNavigate`, and any injected `onClick` (the menu's dismiss, the mobile sheet's close) all
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
 * used as a Base UI `render` target (see NavigationBar), and Base UI injects the
 * trigger wiring — `ref`, `onPointerEnter`/`onClick`, `id`, `aria-expanded` —
 * through the child's props. Dropping
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
  className,
  children,
  href,
  ref,
  ...rest
}: InstantLinkProps): React.JSX.Element {
  // Set while a mouse-down-initiated navigation is in flight, so the real `click`
  // that follows the same gesture is swallowed instead of navigating a second
  // time. A ref, not state: nothing renders from it.
  const suppressNextClickRef = useRef(false);
  const destinationKey = JSON.stringify([href, rest.as]);
  const [intentDestination, setIntentDestination] = useState<string | null>(
    null,
  );
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const focused = useRef(false);
  const hovered = useRef(false);
  const intentTimer = useRef<number | undefined>(undefined);
  const intentMode = prefetch === "intent";
  const upgraded = intentMode && intentDestination === destinationKey;

  const normalizedHref = normalizeLinkHref(href);
  const hrefStr = hrefToString(normalizedHref);

  function cancelPendingIntent() {
    if (intentTimer.current !== undefined) window.clearTimeout(intentTimer.current);
    intentTimer.current = undefined;
  }

  function scheduleIntent(anchor: HTMLAnchorElement) {
    cancelPendingIntent();
    if (!intentMode || upgraded || !canUpgrade(anchor)) return;

    const destination = anchor.href;
    intentTimer.current = window.setTimeout(() => {
      intentTimer.current = undefined;
      if (anchor.href === destination && canUpgrade(anchor)) {
        setIntentDestination(destinationKey);
      }
    }, HOVER_INTENT_DELAY_MS);
  }

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!intentMode || upgraded || !anchor || !isTouchPrimary()) return;
    return observeSettleIntent(anchor, () =>
      setIntentDestination(destinationKey),
    );
  }, [destinationKey, intentMode, upgraded]);

  useEffect(
    () => () => {
      if (intentTimer.current !== undefined) {
        window.clearTimeout(intentTimer.current);
      }
    },
    [],
  );

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
    onBlur: callerOnBlur,
    onFocus: callerOnFocus,
    onPointerCancel: callerOnPointerCancel,
    onPointerDown: callerOnPointerDown,
    onPointerEnter: callerOnPointerEnter,
    onPointerLeave: callerOnPointerLeave,
    replace,
    ...linkRest
  } = rest;

  const resolvedPrefetch: NextPrefetch | undefined = intentMode
    ? upgraded
      ? true
      : "auto"
    : prefetch === undefined
      ? undefined
      : (prefetch as NextPrefetch);

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
      onBlur={(event) => {
        callerOnBlur?.(event);
        focused.current = false;
        if (!hovered.current) cancelPendingIntent();
      }}
      onFocus={(event) => {
        callerOnFocus?.(event);
        if (event.defaultPrevented || !event.currentTarget.matches(":focus-visible"))
          return;
        focused.current = true;
        scheduleIntent(event.currentTarget);
      }}
      onPointerCancel={(event) => {
        callerOnPointerCancel?.(event);
        hovered.current = false;
        cancelPendingIntent();
      }}
      onPointerDown={(event) => {
        callerOnPointerDown?.(event);
        // Navigation renders the cached shell instead of waiting on an
        // in-flight per-link prefetch, so an upgrade after a press only
        // duplicates the request.
        cancelPendingIntent();
        cancelSettleIntent();
      }}
      onPointerEnter={(event) => {
        callerOnPointerEnter?.(event);
        if (
          event.defaultPrevented ||
          event.pointerType === "touch" ||
          event.buttons !== 0 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        ) {
          return;
        }
        hovered.current = true;
        scheduleIntent(event.currentTarget);
      }}
      onPointerLeave={(event) => {
        callerOnPointerLeave?.(event);
        hovered.current = false;
        if (!focused.current) cancelPendingIntent();
      }}
      href={normalizedHref}
      // Omitted, not passed as `undefined`: `next/link`'s own prop type is
      // `boolean | 'auto' | null` and this repo runs `exactOptionalPropertyTypes`,
      // so an explicit `undefined` does not typecheck. An absent prop is what
      // 'auto' means. Intent mode always passes a concrete value.
      {...(resolvedPrefetch === undefined ? {} : { prefetch: resolvedPrefetch })}
      className={cn("relative cursor-pointer", className)}
      ref={(anchor) => {
        anchorRef.current = anchor;
        assignRef(ref, anchor);
        return () => {
          anchorRef.current = null;
          assignRef(ref, null);
        };
      }}
    >
      {children}
    </Link>
  );
}

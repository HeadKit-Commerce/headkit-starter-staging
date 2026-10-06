"use client";

import React, { useEffect, useRef, useState } from "react";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { ChevronDownIcon, MenuIcon, XIcon } from "@/components/icon";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { isAppNavigationHref } from "@/lib/convert-uri";
import { normalizeMenuTree, toMegaMenuColumns } from "@/lib/menu-columns";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { HeaderActions } from "@/components/headkit-ui/header-actions";
import { CartTriggerButton } from "@/components/headkit-ui/cart-trigger-button";
import {
  HEADER_REGION_ATTRIBUTE,
  publishHeaderBottom,
} from "@/lib/header-bottom";
import type { NavLayout, NavStyle } from "@/lib/store-theme";

/** A navigation tree node returned by headkit.menu.get(). */
export interface NavMenuItem {
  id: string;
  label: string;
  uri: string;
  description?: string | null;
  /** Provider CSS classes (e.g. "highlighted", "hidden", "preheader-title"). */
  cssClasses?: string[];
  children: NavMenuItem[];
}

interface NavigationBarProps {
  primaryMenuItems: NavMenuItem[];
  secondaryMenuItems?: NavMenuItem[];
  logo: React.ReactNode;
  /** Right-side icons for desktop (Search, Wishlist, Account, Cart). */
  actions?: React.ReactNode;
  /** Pre-fetched cart count for HeaderActions when actions is not provided. */
  initialCartCount?: number;
  /** Icons shown in the mobile sheet nav footer. */
  mobileActions?: React.ReactNode;
  preheader?: {
    title?: string;
    message?: string;
    links?: { label: string; uri: string }[];
  } | null;
  /** Links whose href should receive sale/highlighted styling. */
  highlightedLinks?: string[];
  /** Logo placement — from overrides/theme.json via NavigationWrapper. */
  navLayout?: NavLayout;
  /** Desktop action presentation — icons (default) or text labels. */
  navStyle?: NavStyle;
}

function removeTrailingSlash(url: string): string {
  return url.length > 1 ? url.replace(/\/$/, "") : url;
}

function isHighlightedItem(
  item: NavMenuItem,
  highlightedLinks: string[],
): boolean {
  return highlightedLinks.some(
    (h) => removeTrailingSlash(h) === removeTrailingSlash(item.uri),
  );
}

export function NavigationBar({
  primaryMenuItems,
  secondaryMenuItems,
  logo,
  actions,
  initialCartCount,
  mobileActions,
  preheader,
  highlightedLinks = [],
  navLayout = "left-logo",
  navStyle = "icons",
}: NavigationBarProps) {
  const centeredLogo = navLayout === "centered-logo";
  const desktopActions = actions ?? (
    <HeaderActions
      initialCartCount={initialCartCount ?? 0}
      navStyle={navStyle}
    />
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<React.ElementRef<typeof NavigationMenu>>(null);
  const [mobileMenuTop, setMobileMenuTop] = useState(80);

  // Keep the mobile drawer/overlay flush under the sticky logo bar (and any
  // visible preheader) so the panel never covers the brand mark or hamburger.
  //
  // The same reading is PUBLISHED as a CSS custom property, because the mobile
  // sheet is no longer its only consumer: the pending-navigation skeleton starts
  // at the header's bottom edge too, and a second measurement taken in that
  // component would drift from this one the first time the header gains a row.
  // See `lib/header-bottom.ts` for why it travels as a custom property rather
  // than as state — in short, this runs on every scroll frame.
  //
  // The publish is deliberately NOT behind the `bottom > 0` guard below. That
  // guard exists so the sheet keeps its last usable offset; a header measured at
  // or above the viewport top is a header with nothing left to uncover, and an
  // overlay should then start at 0 rather than hold a stale strip open.
  useEffect(() => {
    const updateMenuTop = () => {
      const bottom = navRef.current?.getBoundingClientRect().bottom;
      if (typeof bottom !== "number") return;
      publishHeaderBottom(bottom);
      if (bottom > 0) {
        setMobileMenuTop(Math.round(bottom));
      }
    };
    updateMenuTop();
    window.addEventListener("scroll", updateMenuTop, { passive: true });
    window.addEventListener("resize", updateMenuTop);
    return () => {
      window.removeEventListener("scroll", updateMenuTop);
      window.removeEventListener("resize", updateMenuTop);
    };
  }, [mobileOpen, preheader]);

  return (
    <>
      {preheader && (
        <Preheader
          {...(preheader.title !== undefined ? { title: preheader.title } : {})}
          {...(preheader.message !== undefined
            ? { message: preheader.message }
            : {})}
          {...(preheader.links !== undefined ? { links: preheader.links } : {})}
        />
      )}

      {/* Backdrop overlay when desktop mega menu is open */}
      <div
        className={cn(
          "fixed inset-0 z-[15] top-[130px] bg-black/50 backdrop-blur-xs transition-opacity duration-300",
          menuOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />

      <NavigationMenu
        ref={navRef}
        {...{ [HEADER_REGION_ATTRIBUTE]: "" }}
        onValueChange={(val) => setMenuOpen(!!val)}
        className={cn(
          "headkit-nav sticky top-0 flex items-center justify-between h-20 w-full max-w-full px-5 md:px-10 font-body text-primary backdrop-blur-xs transition-colors",
          centeredLogo && "headkit-nav--centered relative",
          // Stay above the mobile sheet/overlay so logo + hamburger remain usable.
          mobileOpen ? "z-[60]" : "z-20",
          // Solid only while mega-menu / mobile sheet is open, or on hover.
          // Scrolled alone keeps translucency so content shows through.
          menuOpen || mobileOpen
            ? "bg-brand-bg"
            : "bg-brand-bg/75 hover:bg-brand-bg",
        )}
      >
        {centeredLogo ? (
          <NavigationMenuLink asChild>
            <InstantLink
        prefetch={true}
              href="/"
              aria-label="Home"
              className="headkit-nav-logo absolute left-1/2 z-[1] cursor-pointer hover:opacity-75"
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {logo as any}
            </InstantLink>
          </NavigationMenuLink>
        ) : null}

        {/* Left: logo + primary menu */}
        <NavigationMenuList
          className={cn("space-x-0", centeredLogo && "flex-1 justify-start")}
        >
          {!centeredLogo ? (
            <NavigationMenuItem className="mr-4 hover:opacity-75">
              <NavigationMenuLink asChild>
                <InstantLink
        prefetch={true}
                  href="/"
                  aria-label="Home"
                  className="cursor-pointer"
                >
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {logo as any}
                </InstantLink>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ) : null}

          {/* No wrapper element: <ul> children must be <li> (a11y list/listitem).
              Desktop-only visibility lives on each NavigationMenuItem. */}
          {primaryMenuItems.length > 0 && (
            <DesktopMenuSection
              items={primaryMenuItems}
              highlightedLinks={highlightedLinks}
              // Full inline menus from xl up; below that use the sheet so
              // header actions never get pushed off on tablet / small laptop.
              itemClassName="hidden xl:flex"
              prefetch
            />
          )}
        </NavigationMenuList>

        {/* Right: secondary menu + actions + mobile toggle */}
        <NavigationMenuList
          className={cn(
            "headkit-nav-secondary space-x-0",
            centeredLogo && "flex-1 justify-end",
          )}
        >
          {secondaryMenuItems && secondaryMenuItems.length > 0 && (
            <DesktopMenuSection
              items={secondaryMenuItems}
              highlightedLinks={highlightedLinks}
              itemClassName="hidden xl:flex"
              prefetch
            />
          )}

          {desktopActions && (
            <NavigationMenuItem className="hidden md:flex items-center shrink-0">
              {desktopActions}
            </NavigationMenuItem>
          )}

          {/* Mobile sticky cart — outside the sheet; desktop uses HeaderActions */}
          <NavigationMenuItem className="headkit-nav-bag md:hidden">
            <CartTriggerButton initialCartCount={initialCartCount ?? 0} />
          </NavigationMenuItem>

          {/* Hamburger through tablet / below-xl (secondary only from xl) */}
          <NavigationMenuItem className="headkit-nav-hamburger xl:hidden">
            <Sheet
              open={mobileOpen}
              onOpenChange={(open) => {
                if (open && navRef.current) {
                  setMobileMenuTop(
                    Math.round(navRef.current.getBoundingClientRect().bottom),
                  );
                }
                setMobileOpen(open);
              }}
              modal={false}
            >
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  className="pr-0"
                >
                  {mobileOpen ? (
                    <XIcon className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
                  ) : (
                    <MenuIcon className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                style={{ top: mobileMenuTop }}
                overlayStyle={{ top: mobileMenuTop }}
                overlayClassName="bg-black/40"
                // Panel starts under the measured nav bottom so the logo bar
                // stays visible; brand background fills the drawer.
                className="inset-y-auto bottom-0 h-auto max-h-none px-0 py-0 w-full max-w-full sm:max-w-full rounded-none border-none bg-brand-bg [&>button]:hidden"
              >
                <SheetTitle hidden />
                <SheetDescription hidden />
                <nav className="flex flex-col gap-4 overflow-y-auto max-h-full pb-20 px-7 pt-6">
                  {primaryMenuItems.length > 0 && (
                    <MobileMenuSection
                      items={primaryMenuItems}
                      onSelect={() => setMobileOpen(false)}
                      highlightedLinks={highlightedLinks}
                    />
                  )}
                  {secondaryMenuItems && secondaryMenuItems.length > 0 && (
                    <MobileMenuSection
                      items={secondaryMenuItems}
                      onSelect={() => setMobileOpen(false)}
                      highlightedLinks={highlightedLinks}
                    />
                  )}
                  {mobileActions && (
                    <div
                      className="flex gap-4 pt-4 border-t border-neutral-100"
                      onClick={(event) => {
                        const target = event.target;
                        if (!(target instanceof Element)) return;
                        // Account, wishlist, and customer extras are links.
                        // Search stays a button and leaves the sheet open.
                        if (target.closest("a")) setMobileOpen(false);
                      }}
                    >
                      {mobileActions}
                    </div>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </>
  );
}

// ---------------------------------------------------------------------------
// Preheader
// ---------------------------------------------------------------------------

function Preheader({
  title,
  message,
  links,
}: {
  title?: string;
  message?: string;
  links?: { label: string; uri: string }[];
}) {
  return (
    <div
      {...{ [HEADER_REGION_ATTRIBUTE]: "" }}
      className="headkit-preheader flex h-[30px] items-center justify-end sm:justify-between bg-primary px-5 text-sm text-brand-bg md:px-10"
    >
      {title ? (
        <div className="hidden sm:block text-brand-bg">
          {decodeHtmlEntities(title)}
        </div>
      ) : null}
      {(message ?? (links && links.length > 0)) && (
        <div className="flex items-center gap-5 text-brand-bg">
          {message ? (
            <span className="text-brand-bg">{decodeHtmlEntities(message)}</span>
          ) : null}
          {links?.map(({ label, uri }, i) => (
            <InstantLink
        prefetch={true}
              key={i}
              href={uri}
              className="underline text-brand-bg"
              pendingVariant="text"
            >
              {decodeHtmlEntities(label)}
            </InstantLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop – DesktopMenuSection
// ---------------------------------------------------------------------------

function DesktopMenuSection({
  items,
  highlightedLinks,
  itemClassName = "hidden xl:flex",
  prefetch,
}: {
  items: NavMenuItem[];
  highlightedLinks: string[];
  /** Visibility classes for each top-level item (responsive collapse). */
  itemClassName?: string;
  /**
   * Forwarded to each top-level link's `InstantLink`. Under the prefetch budget
   * (`NEXT_PUBLIC_NAV_PREFETCH_BUDGET`, off by default) the top-level nav is one of
   * the two surfaces that keeps an explicit `prefetch={true}`, because it is a
   * handful of links and the most likely next click. Mega-menu CHILD links
   * deliberately do NOT get it — a WordPress menu can carry dozens of them, which
   * is the storm the budget exists to stop.
   */
  prefetch?: boolean | undefined;
}) {
  return (
    <>
      {items.map((item) => {
        const href = removeTrailingSlash(item.uri);
        const label = decodeHtmlEntities(item.label);
        const triggerClassName = cn(
          "font-body font-semibold text-primary hover:text-primary",
          isHighlightedItem(item, highlightedLinks) &&
            "text-pink-500 hover:!text-pink-600",
        );
        return (
          <NavigationMenuItem key={item.id} className={itemClassName}>
            {item.children.length > 0 ? (
              <>
                {/*
                  A parent that HAS a panel only opens the panel. Radix renders
                  its own <button> here (no `asChild`), so there is no href for
                  a click, Enter or a tap to follow — which is what the v1 site
                  did, and what stopped a WordPress mega-menu parent whose
                  Custom Link URI is `/` from throwing the shopper back to the
                  home page mid-hover.

                  The parent's own destination is not lost: when it is a real
                  in-app path, MegaMenu renders it as the panel's first entry
                  (see `viewAll`), where it is clickable, focusable and read out
                  in the panel's own list.
                */}
                <NavigationMenuTrigger className={triggerClassName}>
                  {label}
                </NavigationMenuTrigger>
                <NavigationMenuContent className="w-screen! rounded-none! bg-brand-bg">
                  <MegaMenu
                    items={item.children}
                    {...(hasOwnDestination(href)
                      ? { viewAll: { href, label } }
                      : {})}
                  />
                </NavigationMenuContent>
              </>
            ) : (
              <NavigationMenuLink asChild>
                <InstantLink
                  href={href}
                  prefetch={prefetch}
                  pendingVariant="text"
                  className={cn(
                    navigationMenuTriggerStyle(),
                    "font-body font-semibold text-primary hover:text-primary",
                    isHighlightedItem(item, highlightedLinks) &&
                      "text-pink-500 hover:!text-pink-600",
                  )}
                >
                  {label}
                </InstantLink>
              </NavigationMenuLink>
            )}
          </NavigationMenuItem>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop – MegaMenu
// ---------------------------------------------------------------------------

/**
 * A dropdown parent's URI is worth surfacing only when it is a real in-app
 * destination. `#`, `tel:` and `mailto:` are not navigable at all, and `/` is
 * what WordPress collapses a destination-less Custom Link to — a "View all"
 * pointing at the home page is noise, not a link.
 */
function hasOwnDestination(href: string): boolean {
  return isAppNavigationHref(href) && href !== "/";
}

/**
 * Collapses a run of consecutive childless items into one array "group", while
 * an item with children stays its own group. Order is preserved.
 *
 * This is what keeps a childless item's vertical rhythm matching its sibling
 * child links (`gap-1`, packed) instead of the wider spacing between headings
 * (`gap-5`, one per `<div>`) — grouping runs together is what makes several
 * childless items in a row read as one list rather than a stack of
 * individually-spaced headings with the bold stripped off.
 */
function groupMegaMenuColumnItems(
  column: readonly NavMenuItem[],
): (NavMenuItem | NavMenuItem[])[] {
  const groups: (NavMenuItem | NavMenuItem[])[] = [];
  let run: NavMenuItem[] = [];
  for (const item of column) {
    if (item.children.length > 0) {
      if (run.length > 0) {
        groups.push(run);
        run = [];
      }
      groups.push(item);
    } else {
      run.push(item);
    }
  }
  if (run.length > 0) groups.push(run);
  return groups;
}

/**
 * The desktop panel.
 *
 * Exported for `navigation-bar.test.tsx`: Radix keeps panel content unmounted
 * until the menu opens, so server markup of the whole bar cannot show what a
 * panel renders.
 *
 * `items` are the parent's raw children, so they may still contain WordPress
 * column containers; `toMegaMenuColumns` turns them into the columns to render
 * and drops any that would be empty (see `lib/menu-columns.ts`).
 */
export function MegaMenu({
  items,
  viewAll,
}: {
  items: NavMenuItem[];
  /** The parent's own destination, moved off the trigger into the panel. */
  viewAll?: { href: string; label: string };
}) {
  const columns = toMegaMenuColumns(items);
  return (
    <ul className="grid gap-5 w-full px-5 md:px-10 py-6 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
      {viewAll && (
        <li className="col-span-full">
          <NavigationMenuLink asChild>
            <InstantLink
        prefetch={true}
              href={viewAll.href}
              pendingVariant="text"
              className="font-semibold text-primary hover:opacity-80 underline block"
            >
              View all {viewAll.label}
            </InstantLink>
          </NavigationMenuLink>
        </li>
      )}
      {columns.map((column, index) => (
        <li key={column[0]?.id ?? index} className="flex flex-col gap-5">
          {groupMegaMenuColumnItems(column).map((group, groupIndex) =>
            Array.isArray(group) ? (
              // A run of childless items: one `gap-1` list, same rhythm as the
              // child links under a heading — not a heading each.
              <ul
                key={group[0]?.id ?? groupIndex}
                className="flex flex-col gap-1"
              >
                {group.map((item) => (
                  <MegaMenuChild key={item.id} item={item} depth={0} />
                ))}
              </ul>
            ) : (
              <div key={group.id}>
                <NavigationMenuLink asChild>
                  <InstantLink
        prefetch={true}
                    href={removeTrailingSlash(group.uri)}
                    pendingVariant="text"
                    className="font-semibold text-primary hover:opacity-80 uppercase block mb-2"
                  >
                    {decodeHtmlEntities(group.label)}
                  </InstantLink>
                </NavigationMenuLink>
                <ul className="flex flex-col gap-1">
                  {group.children.map((child) => (
                    <MegaMenuChild key={child.id} item={child} depth={0} />
                  ))}
                </ul>
              </div>
            ),
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One link inside a column, under its column heading, plus anything beneath it.
 *
 * Recursive: Bike Society's menu is four levels deep
 * (`EQUIPMENT → column → category → subcategory`), so a category heading in a
 * column carries its own subcategory list. Sub-levels indent and lighten rather
 * than repeating the heading treatment.
 */
function MegaMenuChild({ item, depth }: { item: NavMenuItem; depth: number }) {
  return (
    <li>
      <NavigationMenuLink asChild>
        <InstantLink
        prefetch={true}
          href={removeTrailingSlash(item.uri)}
          pendingVariant="text"
          className={cn(
            "hover:opacity-80 text-[15px] block py-0.5",
            depth === 0 ? "text-primary/70" : "text-primary/50",
          )}
        >
          {decodeHtmlEntities(item.label)}
        </InstantLink>
      </NavigationMenuLink>
      {item.children.length > 0 && (
        <ul className="flex flex-col gap-1 pl-3">
          {item.children.map((child) => (
            <MegaMenuChild key={child.id} item={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mobile – MobileMenuSection
// ---------------------------------------------------------------------------

/**
 * The mobile sheet's list. Exported for `navigation-bar.test.tsx`: the sheet is
 * a Radix dialog and stays unmounted until it opens.
 */
export function MobileMenuSection({
  items,
  onSelect,
  highlightedLinks,
}: {
  items: NavMenuItem[];
  onSelect?: (() => void) | undefined;
  highlightedLinks: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <MobileMenuItem
          key={item.id}
          item={item}
          onSelect={onSelect}
          highlightedLinks={highlightedLinks}
        />
      ))}
    </div>
  );
}

/**
 * One row inside an open mobile section, plus everything under it.
 *
 * Recursive, so the sheet carries however many levels the menu has — Bike
 * Society's is four (`EQUIPMENT → column → category → subcategory`), and the
 * columns are already spliced out by the time this renders. `depth` only drives
 * indentation and weight: the first row under a section stands out, everything
 * below it is a sub-link.
 *
 * Exported for `navigation-bar.test.tsx`: a closed Radix collapsible renders no
 * content, so the sheet's rows are not reachable through `MobileMenuSection`.
 */
export function MobileMenuBranch({
  item,
  depth,
  onSelect,
}: {
  item: NavMenuItem;
  depth: number;
  onSelect?: (() => void) | undefined;
}) {
  const hasChildren = item.children.length > 0;
  return (
    <div>
      <InstantLink
        prefetch={true}
        href={removeTrailingSlash(item.uri)}
        pendingVariant="text"
        className={cn(
          "block text-[15px]",
          depth === 0 && hasChildren
            ? "font-medium text-primary hover:opacity-70 py-1"
            : "text-primary/70 hover:opacity-70",
          depth === 0 && !hasChildren ? "py-1" : "py-0.5",
        )}
        {...(onSelect ? { onClick: onSelect } : {})}
      >
        {decodeHtmlEntities(item.label)}
      </InstantLink>
      {hasChildren && (
        <div className="flex flex-col gap-1 pl-3">
          {item.children.map((child) => (
            <MobileMenuBranch
              key={child.id}
              item={child}
              depth={depth + 1}
              {...(onSelect ? { onSelect } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileMenuItem({
  item,
  onSelect,
  highlightedLinks,
}: {
  item: NavMenuItem;
  onSelect?: (() => void) | undefined;
  highlightedLinks: string[];
}) {
  // The sheet is a flat list, so a WordPress column container has no meaning
  // here at all: splice it away at every depth and show the real links.
  const children = normalizeMenuTree(item.children);

  if (children.length > 0) {
    return (
      <Collapsible>
        <CollapsibleTrigger className="text-xl font-semibold font-body text-primary flex w-full justify-between items-center group focus-visible:outline-none">
          <span className="group-data-[state=open]:opacity-70">
            {decodeHtmlEntities(item.label)}
          </span>
          <span className="group-data-[state=open]:hidden text-primary">
            <ChevronDownIcon size={20} />
          </span>
          <span className="hidden group-data-[state=open]:block rotate-180 text-primary">
            <ChevronDownIcon size={20} />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          {children.map((child) => (
            <MobileMenuBranch
              key={child.id}
              item={child}
              depth={0}
              {...(onSelect ? { onSelect } : {})}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <InstantLink
        prefetch={true}
      href={removeTrailingSlash(item.uri)}
      pendingVariant="text"
      className={cn(
        "text-xl font-semibold font-body text-primary hover:opacity-70",
        isHighlightedItem(item, highlightedLinks) &&
          "text-pink-500 hover:!text-pink-600",
      )}
      {...(onSelect ? { onClick: onSelect } : {})}
    >
      {decodeHtmlEntities(item.label)}
    </InstantLink>
  );
}

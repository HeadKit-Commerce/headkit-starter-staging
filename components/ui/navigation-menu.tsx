"use client";

import * as React from "react";
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Base UI writes `aria-controls` from `NavigationMenu.Popup` only. This shell
// has no Popup: a Positioner would anchor the panel to the trigger. The
// viewport is the element the open links are portaled into, so the trigger
// names that instead.
const NavigationMenuPanelIdContext = React.createContext<string | null>(null);

function navigationMenuPanelId(reactId: string): string {
  return `headkit-nav-panel-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

const NavigationMenu = React.forwardRef<
  HTMLElement,
  NavigationMenuPrimitive.Root.Props
>(({ className, children, ...props }, ref) => {
  const panelId = navigationMenuPanelId(React.useId());
  return (
    <NavigationMenuPanelIdContext.Provider value={panelId}>
      <NavigationMenuPrimitive.Root
        ref={ref}
        className={cn(
          "relative z-10 flex flex-1 items-center justify-center",
          className,
        )}
        {...props}
      >
        {children}
        {/*
          In the nav, not portaled. A body portal anchors to the trigger, so the
          panel starts mid-header and runs off the right. `left-0` is the nav's
          padding edge. Width lives on the content (`w-screen`, or the header's
          `w-screen!`); this shell is `w-max` so it follows that box instead of
          clipping it to the nav.
        */}
        <div className="absolute left-0 top-full z-30 w-max">
          <NavigationMenuViewport id={panelId} />
        </div>
      </NavigationMenuPrimitive.Root>
    </NavigationMenuPanelIdContext.Provider>
  );
});
NavigationMenu.displayName = "NavigationMenu";

const NavigationMenuList = React.forwardRef<
  HTMLUListElement,
  NavigationMenuPrimitive.List.Props
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn(
      // Shrink-wrap. Radix wrapped this <ul> in a relative div, so flex-1
      // never made the list a flex item of the bar — justify-between on the
      // nav pinned each group to the 40px padding edge. Base UI renders the
      // <ul> as that flex item; flex-1 grows each list to half the bar and
      // justify-center pulls the links into a central band.
      "group flex list-none items-center justify-center space-x-1",
      className,
    )}
    {...props}
  />
));
NavigationMenuList.displayName = "NavigationMenuList";

const NavigationMenuItem = NavigationMenuPrimitive.Item;

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-10 w-max items-center justify-center rounded-md bg-transparent !px-2.5 py-2 text-sm font-semibold transition-colors hover:bg-transparent hover:opacity-80 focus:bg-transparent focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-transparent data-[popup-open]:bg-transparent cursor-pointer",
);

const NavigationMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  NavigationMenuPrimitive.Trigger.Props
>(({ className, children, ...props }, ref) => {
  const panelId = React.useContext(NavigationMenuPanelIdContext);
  return (
    <NavigationMenuPrimitive.Trigger
      ref={ref}
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      {...props}
      {...(panelId != null ? { "aria-controls": panelId } : {})}
    >
      {children}
    </NavigationMenuPrimitive.Trigger>
  );
});
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";

const NavigationMenuContent = React.forwardRef<
  HTMLDivElement,
  NavigationMenuPrimitive.Content.Props
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content
    ref={ref}
    className={cn(
      // In flow while open. Taking this box out of flow collapses the open
      // panel to 0 height and clicks fall through to the page overlay.
      // Width is the content's own: full viewport, and `md:w-max` so a
      // caller that does not pass `w-screen!` (facet and sort panels)
      // shrinks to its children. The header mega menu passes `w-screen!`,
      // which wins over `md:w-max`. Inactive keepMounted content is
      // positioned by Base UI itself.
      "w-screen md:w-max z-30",
      className,
    )}
    {...props}
  />
));
NavigationMenuContent.displayName = "NavigationMenuContent";

const NavigationMenuLink = React.forwardRef<
  HTMLAnchorElement,
  NavigationMenuPrimitive.Link.Props
>(({ closeOnClick = true, ...props }, ref) => (
  // Base UI leaves the menu open on click. The header stays mounted across
  // client navigations, so an open value would survive the click.
  <NavigationMenuPrimitive.Link
    ref={ref}
    closeOnClick={closeOnClick}
    {...props}
  />
));
NavigationMenuLink.displayName = "NavigationMenuLink";

const NavigationMenuViewport = React.forwardRef<
  HTMLDivElement,
  NavigationMenuPrimitive.Viewport.Props
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Viewport
    className={cn(
      "origin-top-center relative w-max overflow-hidden bg-brand-bg text-primary",
      className,
    )}
    ref={ref}
    {...props}
  />
));
NavigationMenuViewport.displayName = "NavigationMenuViewport";

export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuViewport,
};

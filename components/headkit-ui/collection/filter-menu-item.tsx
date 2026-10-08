"use client";

import { cn } from "@/lib/utils";
import {
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
} from "@/components/ui/navigation-menu";
import { FACET_PANEL_SCROLL_CLASS } from "./facet-panel";

interface FilterMenuItemProps {
  label: string;
  count?: number;
  children: React.ReactNode;
}

export function FilterMenuItem({
  label,
  count = 0,
  children,
}: FilterMenuItemProps) {
  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger>
        <div
          className={cn("relative cursor-pointer whitespace-nowrap", {
            "font-bold": count > 0,
          })}
        >
          <span>{label}</span>
          {count > 0 && (
            <div className="absolute right-[-12px] top-[-2px] h-[14px] w-[14px] rounded-full bg-primary text-center text-[10px] font-medium text-white">
              {count}
            </div>
          )}
        </div>
      </NavigationMenuTrigger>
      <NavigationMenuContent className="rounded-none! p-4">
        {/* The scroll container is INSIDE the panel, not on the Radix
            viewport: the viewport's height is measured from this content, so
            capping here clamps both at once and leaves the shared
            NavigationMenuViewport (also used by the site mega-menu)
            untouched. See facet-panel.ts for the measurements. */}
        <div className={FACET_PANEL_SCROLL_CLASS}>{children}</div>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
}

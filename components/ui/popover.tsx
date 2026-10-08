"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const popupMotion =
  "transition-[opacity,transform] duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95 data-[side=bottom]:data-[starting-style]:-translate-y-2 data-[side=bottom]:data-[ending-style]:-translate-y-2 data-[side=left]:data-[starting-style]:translate-x-2 data-[side=left]:data-[ending-style]:translate-x-2 data-[side=right]:data-[starting-style]:-translate-x-2 data-[side=right]:data-[ending-style]:-translate-x-2 data-[side=top]:data-[starting-style]:translate-y-2 data-[side=top]:data-[ending-style]:translate-y-2";

type PopoverContentProps = PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"];
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  collisionPadding?: PopoverPrimitive.Positioner.Props["collisionPadding"];
};

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className,
      align = "center",
      side = "bottom",
      sideOffset = 4,
      alignOffset,
      collisionPadding,
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="isolate z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        {...(alignOffset !== undefined ? { alignOffset } : {})}
        {...(collisionPadding !== undefined ? { collisionPadding } : {})}
      >
        <PopoverPrimitive.Popup
          ref={ref}
          className={cn(
            "z-50 w-72 rounded-md border border-neutral-200 bg-white p-4 text-neutral-950 shadow-md outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50",
            popupMotion,
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };

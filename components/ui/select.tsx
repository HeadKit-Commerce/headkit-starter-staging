"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "@/components/icon";

import { cn } from "@/lib/utils";
import { FORM_CONTROL_SURFACE_FOCUS_WITHIN } from "./form-control-surface";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const popupMotion =
  "transition-[opacity,transform] duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95 data-[side=bottom]:data-[starting-style]:-translate-y-2 data-[side=bottom]:data-[ending-style]:-translate-y-2 data-[side=left]:data-[starting-style]:translate-x-2 data-[side=left]:data-[ending-style]:translate-x-2 data-[side=right]:data-[starting-style]:-translate-x-2 data-[side=right]:data-[ending-style]:-translate-x-2 data-[side=top]:data-[starting-style]:translate-y-2 data-[side=top]:data-[ending-style]:translate-y-2";

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  SelectPrimitive.Trigger.Props
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // The primitive focuses the trigger on a pointer open, so this one uses
      // `focus:` rather than `focus-visible:` — otherwise an opened select shows
      // no ring. `data-[placeholder]` is the trigger's equivalent of
      // `::placeholder`, so it takes the surface's placeholder colour.
      "flex h-10 w-full items-center justify-between px-3 py-2 text-sm data-[placeholder]:text-gray-700 [&>span]:line-clamp-1",
      FORM_CONTROL_SURFACE_FOCUS_WITHIN,
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon>
      <ChevronDownIcon className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectScrollUpButton = React.forwardRef<
  HTMLDivElement,
  SelectPrimitive.ScrollUpArrow.Props
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpArrow
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronUpIcon className="h-4 w-4" />
  </SelectPrimitive.ScrollUpArrow>
));
SelectScrollUpButton.displayName = "SelectScrollUpButton";

const SelectScrollDownButton = React.forwardRef<
  HTMLDivElement,
  SelectPrimitive.ScrollDownArrow.Props
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownArrow
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronDownIcon className="h-4 w-4" />
  </SelectPrimitive.ScrollDownArrow>
));
SelectScrollDownButton.displayName = "SelectScrollDownButton";

const SelectContent = React.forwardRef<
  HTMLDivElement,
  SelectPrimitive.Popup.Props
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner
      className="isolate z-50 outline-none"
      align="start"
      alignItemWithTrigger={false}
      sideOffset={4}
    >
      <SelectPrimitive.Popup
        ref={ref}
        className={cn(
          "z-50 flex max-h-[min(24rem,var(--available-height))] min-w-[max(8rem,var(--anchor-width))] flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-neutral-950 shadow-md outline-none",
          popupMotion,
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.List className="min-h-0 flex-1 overflow-y-auto p-1">
          {children}
        </SelectPrimitive.List>
        <SelectScrollDownButton />
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

const SelectLabel = React.forwardRef<
  HTMLDivElement,
  SelectPrimitive.GroupLabel.Props
>(({ className, ...props }, ref) => (
  <SelectPrimitive.GroupLabel
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

const SelectItem = React.forwardRef<HTMLElement, SelectPrimitive.Item.Props>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-hidden data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  SelectPrimitive.Separator.Props
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-neutral-100", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};

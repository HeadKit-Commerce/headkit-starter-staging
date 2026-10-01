"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { CircleIcon } from "@/components/icon";

import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  );
});
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        // The dot is drawn by the indicator below in `currentColor`, so this
        // control keeps a WHITE fill and `text-primary` when checked rather
        // than taking the boolean surface's filled `data-[state=checked]:bg-*`
        // — a filled circle would swallow its own dot. Everything else is the
        // surface vocabulary: see `form-control-surface.ts`.
        "aspect-square h-4 w-4 rounded-full border border-primary bg-white text-primary",
        "focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[checked]:border-primary",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <CircleIcon className="h-2.5 w-2.5 fill-current text-current" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };

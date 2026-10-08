"use client";

import * as React from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { CircleIcon } from "@/components/icon";

import { cn } from "@/lib/utils";

type RadioGroupProps = Omit<
  RadioGroupPrimitive.Props<string | null>,
  "onValueChange" | "value" | "defaultValue"
> & {
  /** Selected item. `null` is an explicit empty selection. */
  value?: string | null;
  defaultValue?: string;
  /** Fires with the selected item value. Empty selections are ignored. */
  onValueChange?: (value: string) => void;
};

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, onValueChange, value, defaultValue, ...props }, ref) => {
    return (
      <RadioGroupPrimitive<string | null>
        className={cn("grid gap-2", className)}
        {...props}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange
          ? {
              onValueChange: (next: string | null) => {
                if (typeof next === "string") onValueChange(next);
              },
            }
          : {})}
        ref={ref}
      />
    );
  },
);
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef<HTMLButtonElement, Radio.Root.Props>(
  ({ className, ...props }, ref) => {
    return (
      <Radio.Root
        ref={ref}
        className={cn(
          // The dot is drawn by the indicator below in `currentColor`, so this
          // control keeps a WHITE fill and `text-primary` when checked rather
          // than taking the boolean surface's filled `data-[state=checked]:bg-*`
          // — a filled circle would swallow its own dot. Everything else is the
          // surface vocabulary: see `form-control-surface.ts`.
          "aspect-square h-4 w-4 rounded-full border border-primary bg-white text-primary",
          "focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary",
          className,
        )}
        {...props}
      >
        <Radio.Indicator className="flex items-center justify-center">
          <CircleIcon className="h-2.5 w-2.5 fill-current text-current" />
        </Radio.Indicator>
      </Radio.Root>
    );
  },
);
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };

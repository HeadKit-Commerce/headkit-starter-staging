"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "@/components/icon";

import { cn } from "@/lib/utils";
import { FORM_CONTROL_BOOLEAN_SURFACE } from "./form-control-surface";

/**
 * Brand checkbox, on {@link FORM_CONTROL_BOOLEAN_SURFACE} — the HTML twin of
 * Stripe's `.CheckboxInput` family, which is what the shopper sees one step
 * later at checkout.
 *
 * `rounded-sm` (= `calc(var(--radius) * 0.5)`) is kept rather than the full
 * `--radius` Stripe applies: at 16px square an 8px radius reads as a circle,
 * i.e. as a radio button. The two controls must stay tellable apart.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm",
      FORM_CONTROL_BOOLEAN_SURFACE,
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <CheckIcon className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

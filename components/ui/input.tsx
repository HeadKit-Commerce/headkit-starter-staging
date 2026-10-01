import * as React from "react";

import { cn } from "@/lib/utils";
import { FORM_CONTROL_SURFACE } from "./form-control-surface";

/**
 * The storefront's one text input. Colour/radius/state come from
 * {@link FORM_CONTROL_SURFACE} — read its header before changing any of them.
 *
 * `text-base md:text-sm` is deliberate and `lib/stripe-appearance.ts` mirrors
 * it (`SITE_TYPE.inputFontSize*`) so Stripe's fields size with ours: 16px on a
 * phone, because anything smaller makes iOS Safari zoom on focus, and 14px from
 * `md` up. Change the pair together or checkout's fields drift from the site's.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-neutral-950 md:text-sm",
          FORM_CONTROL_SURFACE,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

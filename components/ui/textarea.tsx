import * as React from "react";

import { cn } from "@/lib/utils";
import { FORM_CONTROL_SURFACE } from "./form-control-surface";

/**
 * Multi-line sibling of `Input`, on the same {@link FORM_CONTROL_SURFACE}.
 *
 * The `dark:` variants this carried are gone on purpose — they were live under
 * `@media (prefers-color-scheme: dark)` and pinned the old neutral placeholder
 * and focus ring for dark-mode visitors. See the surface module's header.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full px-3 py-2 text-base md:text-sm",
        FORM_CONTROL_SURFACE,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };

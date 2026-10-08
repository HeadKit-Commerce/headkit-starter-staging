"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "@/components/icon";

import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  HTMLDivElement,
  SheetPrimitive.Backdrop.Props
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Backdrop
    className={cn(
      "fixed inset-0 z-50 bg-black/80 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-brand-bg p-6 shadow-lg transition-[transform] ease-in-out data-[starting-style]:duration-500 data-[ending-style]:duration-300",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full",
        bottom:
          "inset-x-0 bottom-0 border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-[90vw] md:w-full border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full sm:max-w-md",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends SheetPrimitive.Popup.Props, VariantProps<typeof sheetVariants> {
  /** Optional className for the dimmed backdrop (e.g. start below a sticky nav). */
  overlayClassName?: string;
  /** Optional inline styles for the dimmed backdrop. */
  overlayStyle?: React.CSSProperties;
}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  (
    {
      side = "right",
      className,
      overlayClassName,
      overlayStyle,
      children,
      ...props
    },
    ref,
  ) => (
    <SheetPortal>
      <SheetOverlay
        className={overlayClassName}
        {...(overlayStyle !== undefined ? { style: overlayStyle } : {})}
      />
      <SheetPrimitive.Popup
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        <SheetPrimitive.Close className="absolute right-5 top-10 cursor-pointer border-none bg-transparent p-0 shadow-none outline-none ring-0 appearance-none opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none">
          <XIcon className="h-6 w-6 text-primary" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Popup>
    </SheetPortal>
  ),
);
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  SheetPrimitive.Title.Props
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-neutral-950", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  SheetPrimitive.Description.Props
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-neutral-500", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};

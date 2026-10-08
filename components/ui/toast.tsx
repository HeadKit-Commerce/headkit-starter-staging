"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { XIcon } from "@/components/icon";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitive.Provider;

const ToastPortal = ToastPrimitive.Portal;

const ToastViewport = React.forwardRef<
  HTMLDivElement,
  ToastPrimitive.Viewport.Props
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      // The `sm:` TRANSLATE rides the consent banner's published height for
      // the same reason the PDP sticky bar does
      // (`lib/consent-banner-offset.ts`): the viewport is bottom-right at
      // `sm+` and `z-100`, so a toast fired while the banner is up lands
      // squarely on its Decline / Accept row. A transform rather than
      // `bottom`, because moving a fixed box by its position IS a layout
      // shift; the variable is absent once a choice is made, so the fallback
      // is `translateY(0)` and the `bottom: 0` this always had.
      "fixed top-0 z-100 flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col sm:translate-y-[calc(var(--headkit-consent-banner-height,0px)_*_-1)] md:max-w-[420px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

const Toast = React.forwardRef<HTMLDivElement, ToastPrimitive.Root.Props>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(
        "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border border-neutral-200 bg-white p-6 pr-8 text-neutral-950 shadow-lg transition-[opacity,transform] duration-200 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[swiping]:scale-100 data-[swiping]:transition-none data-[ending-style]:data-[swipe-direction=right]:translate-x-[var(--toast-swipe-movement-x)] data-[ending-style]:data-[swipe-direction=down]:translate-y-[var(--toast-swipe-movement-y)] data-[limited]:hidden data-[type=destructive]:border-red-500 data-[type=destructive]:bg-red-500 data-[type=destructive]:text-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:data-[type=destructive]:border-red-900 dark:data-[type=destructive]:bg-red-900 dark:data-[type=destructive]:text-neutral-50",
        className,
      )}
      {...props}
    />
  ),
);
Toast.displayName = "Toast";

const ToastAction = React.forwardRef<
  HTMLButtonElement,
  ToastPrimitive.Action.Props
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-transparent px-3 text-sm font-medium ring-offset-white transition-colors hover:bg-neutral-100 focus:outline-hidden focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-data-[type=destructive]:border-neutral-100/40 group-data-[type=destructive]:hover:border-red-500/30 group-data-[type=destructive]:hover:bg-red-500 group-data-[type=destructive]:hover:text-neutral-50 group-data-[type=destructive]:focus:ring-red-500 dark:border-neutral-800 dark:ring-offset-neutral-950 dark:hover:bg-neutral-800 dark:focus:ring-neutral-300 dark:group-data-[type=destructive]:border-neutral-800/40 dark:group-data-[type=destructive]:hover:border-red-900/30 dark:group-data-[type=destructive]:hover:bg-red-900 dark:group-data-[type=destructive]:hover:text-neutral-50 dark:group-data-[type=destructive]:focus:ring-red-900",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = "ToastAction";

const ToastClose = React.forwardRef<
  HTMLButtonElement,
  ToastPrimitive.Close.Props
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    data-base-ui-swipe-ignore=""
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-neutral-950/50 opacity-0 transition-opacity hover:text-neutral-950 focus:opacity-100 focus:outline-hidden focus:ring-2 group-hover:opacity-100 group-data-[type=destructive]:text-red-300 group-data-[type=destructive]:hover:text-red-50 group-data-[type=destructive]:focus:ring-red-400 dark:text-neutral-50/50 dark:hover:text-neutral-50",
      className,
    )}
    {...props}
  >
    <XIcon className="h-4 w-4" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";

const ToastTitle = React.forwardRef<
  HTMLHeadingElement,
  ToastPrimitive.Title.Props
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

const ToastDescription = React.forwardRef<
  HTMLParagraphElement,
  ToastPrimitive.Description.Props
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastPortal,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};

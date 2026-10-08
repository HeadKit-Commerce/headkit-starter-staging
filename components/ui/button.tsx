"use client";

import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  ShoppingBagIcon,
} from "@/components/icon";

import { cn } from "@/lib/utils";

// Inlined rather than imported from `@/components/icon` (react-icons/fa6):
// Turbopack groups every referenced `react-icons/fa6` module into ONE chunk, so a
// single client reference here pulled the whole group — the payment marks and the
// fa6 brand pack included — onto every page that renders a Button. Path data and
// attributes are react-icons' own (`FaSpinner`, node_modules/react-icons/fa6),
// so the artwork is unchanged.
const SpinnerIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    stroke="currentColor"
    fill="currentColor"
    strokeWidth="0"
    viewBox="0 0 512 512"
    height="1em"
    width="1em"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M304 48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zm0 416a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM48 304a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm464-48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM142.9 437A48 48 0 1 0 75 369.1 48 48 0 1 0 142.9 437zm0-294.2A48 48 0 1 0 75 75a48 48 0 1 0 67.9 67.9zM369.1 437A48 48 0 1 0 437 369.1 48 48 0 1 0 369.1 437z" />
  </svg>
);

const buttonVariants = cva(
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 rounded-[var(--radius-button)]",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary/70",
        destructive: "bg-red-500 text-white shadow-sm hover:bg-red-500/90",
        outline:
          "border border-primary bg-transparent text-primary shadow-none hover:bg-transparent hover:opacity-80",
        secondary:
          "border border-primary bg-transparent text-primary shadow-none hover:bg-transparent hover:opacity-80",
        ghost: "",
        link: "text-primary underline-offset-4 hover:underline hover:opacity-80 rounded-none",
      },
      size: {
        default: "h-10 px-4 py-2 text-base",
        sm: "h-8 px-3 text-sm",
        lg: "h-11 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type RightIconType =
  | "arrowRight"
  | "chevronLeft"
  | "chevronRight"
  | "shoppingBag"
  | "plus";

const RightIconMap: Record<RightIconType, React.ElementType> = {
  arrowRight: ArrowRightIcon,
  chevronLeft: ChevronLeftIcon,
  chevronRight: ChevronRightIcon,
  shoppingBag: ShoppingBagIcon,
  plus: PlusIcon,
};

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  rightIcon?: RightIconType;
  fullWidth?: boolean;
  loading?: boolean;
  loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      rightIcon,
      fullWidth,
      loading,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    // asChild merges the button styling/props onto the single child element
    // (e.g. <Button asChild><Link/></Button> renders ONE <a class="...">).
    // Previously the prop was silently dropped, producing a nested
    // <button><a/></button> — invalid nested interactive controls that also
    // failed the a11y target-size audit (the inner link obscured the button).
    const IconComponent = rightIcon ? RightIconMap[rightIcon] : null;
    return useRender({
      defaultTagName: "button",
      ...(asChild
        ? { render: React.Children.only(children) as React.ReactElement }
        : {}),
      ref: ref as React.Ref<HTMLElement>,
      props: {
        className: cn(
          buttonVariants({ variant, size, className }),
          fullWidth && "w-full",
        ),
        disabled: disabled ?? !!loading,
        ...props,
        ...(asChild
          ? {}
          : {
              children: (
                <>
                  {loading ? (loadingText ?? "Processing...") : children}
                  {loading ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : IconComponent ? (
                    <IconComponent className="h-4 w-4" />
                  ) : null}
                </>
              ),
            }),
      },
    });
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

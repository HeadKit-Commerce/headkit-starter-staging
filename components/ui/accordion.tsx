"use client";

import * as React from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDownIcon, MinusIcon, PlusIcon } from "@/components/icon";

import { cn } from "@/lib/utils";

type AccordionShared = {
  className?: string;
  children?: React.ReactNode;
};

type AccordionSingleProps = AccordionShared & {
  type?: "single";
  collapsible?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type AccordionMultipleProps = AccordionShared & {
  type: "multiple";
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

type AccordionProps = AccordionSingleProps | AccordionMultipleProps;

function Accordion(props: AccordionProps): React.ReactElement {
  const { className, children } = props;

  if (props.type === "multiple") {
    return (
      <AccordionPrimitive.Root
        multiple
        className={className}
        {...(props.value !== undefined ? { value: props.value } : {})}
        {...(props.defaultValue !== undefined
          ? { defaultValue: props.defaultValue }
          : {})}
        {...(props.onValueChange
          ? {
              onValueChange: (next: string[]) => {
                props.onValueChange?.(next);
              },
            }
          : {})}
      >
        {children}
      </AccordionPrimitive.Root>
    );
  }

  const { value, defaultValue, onValueChange } = props;
  return (
    <AccordionPrimitive.Root
      className={className}
      {...(value !== undefined ? { value: value === "" ? [] : [value] } : {})}
      {...(defaultValue !== undefined
        ? { defaultValue: defaultValue === "" ? [] : [defaultValue] }
        : {})}
      {...(onValueChange
        ? {
            onValueChange: (next: string[]) => {
              onValueChange(next[0] ?? "");
            },
          }
        : {})}
    >
      {children}
    </AccordionPrimitive.Root>
  );
}

const AccordionItem = React.forwardRef<
  HTMLDivElement,
  AccordionPrimitive.Item.Props
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

type AccordionTriggerProps = AccordionPrimitive.Trigger.Props & {
  /** Chevron (default) or plus/minus for minimalist FAQ-style lists. */
  icon?: "chevron" | "plus-minus";
};

const AccordionTrigger = React.forwardRef<
  HTMLButtonElement,
  AccordionTriggerProps
>(({ className, children, icon = "chevron", ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "group flex flex-1 cursor-pointer items-center justify-between py-4 font-medium transition-all hover:underline",
        icon === "chevron" && "[&[data-panel-open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children}
      {icon === "plus-minus" ? (
        <>
          <PlusIcon className="h-6 w-6 shrink-0 text-primary group-data-[panel-open]:hidden" />
          <MinusIcon className="hidden h-6 w-6 shrink-0 text-primary group-data-[panel-open]:block" />
        </>
      ) : (
        <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform duration-200" />
      )}
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

const AccordionContent = React.forwardRef<
  HTMLDivElement,
  AccordionPrimitive.Panel.Props
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Panel
    ref={ref}
    className="overflow-hidden text-sm transition-all data-[starting-style]:animate-accordion-down data-[ending-style]:animate-accordion-up"
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Panel>
));

AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

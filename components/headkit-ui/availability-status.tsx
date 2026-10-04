"use client";

import { cn } from "@/lib/utils";
import {
  isBackorderStockStatus,
  isVariationOutOfStock,
} from "@/lib/variation-stock";

/**
 * The PDP availability line.
 *
 * The status is derived SYNCHRONOUSLY. It used to live in a
 * `useState`/`useEffect` pair seeded with `IN_STOCK`, so the server render — and
 * the first client paint after it — said "In Stock" for every product,
 * including one that is out of stock, until hydration corrected it. Nothing
 * here needs the browser: both predicates are pure functions of the props.
 */

export type AvailabilityStatusKind =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "ON_BACKORDER";

interface Props {
  stockStatus: string;
  stockQuantity?: number | null;
  /** Optional brand term. Stores without brand-specific copy ignore it. */
  brandSlug?: string | null;
}

export interface ResolvedAvailability {
  status: AvailabilityStatusKind;
  label: string;
}

/** The pure rule the component renders; exported for the test. */
export function resolveAvailability({
  stockStatus,
  stockQuantity,
}: Props): ResolvedAvailability {
  if (isVariationOutOfStock({ stockStatus, stockQuantity })) {
    return { status: "OUT_OF_STOCK", label: "Out of Stock" };
  }
  if (isBackorderStockStatus(stockStatus)) {
    return { status: "ON_BACKORDER", label: "Available on backorder" };
  }
  if (
    stockQuantity !== null &&
    stockQuantity !== undefined &&
    stockQuantity > 0 &&
    stockQuantity <= 3
  ) {
    return { status: "LOW_STOCK", label: `Only ${stockQuantity} in Stock` };
  }
  return { status: "IN_STOCK", label: "In Stock" };
}

const DOT_COLOR: Record<AvailabilityStatusKind, string> = {
  IN_STOCK: "bg-lime-800",
  LOW_STOCK: "bg-orange-500",
  OUT_OF_STOCK: "bg-pink-800",
  ON_BACKORDER: "bg-orange-500",
};

const TEXT_COLOR: Record<AvailabilityStatusKind, string> = {
  // lime-900: lime-800 text is 2.4:1 on white and fails WCAG AA (the dot
  // keeps lime-800 — non-text indicator next to its label).
  IN_STOCK: "text-lime-900",
  LOW_STOCK: "text-orange-500",
  OUT_OF_STOCK: "text-pink-800",
  ON_BACKORDER: "text-orange-500",
};

const AvailabilityStatus = (props: Props) => {
  const { status, label } = resolveAvailability(props);
  const dotColor = DOT_COLOR[status];
  const textColor = TEXT_COLOR[status];

  return (
    <div
      className={cn(
        "headkit-availability-status flex items-baseline font-medium",
        textColor,
      )}
      data-status={status}
    >
      <span className="relative mr-2 flex h-3 w-3">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            dotColor,
          )}
        />
        <span
          className={cn("relative inline-flex h-3 w-3 rounded-full", dotColor)}
        />
      </span>
      {label}
    </div>
  );
};

export { AvailabilityStatus };

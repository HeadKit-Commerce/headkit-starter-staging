"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { AvailabilityStatus } from "@/components/headkit-ui/availability-status";

/**
 * The selected variation, published by `ProductDetail`, and the setter the
 * streamed availability line uses so the Add to Bag button reads the same
 * stock the line just rendered.
 */
export type PublishedStock = {
  variationId: string | null;
  stockStatus: string;
  stockQuantity: number | null;
};

type SelectionContextValue = {
  variationId: string | null;
  publish: (next: PublishedStock) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function ProductSelectionProvider({
  variationId,
  publish,
  children,
}: SelectionContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ variationId, publish }),
    [variationId, publish],
  );
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export type StockVariationSnapshot = {
  id: number | string;
  stockStatus: string | null;
  stockQuantity: number | null;
  attributes: ReadonlyArray<{ key: string; value: string }>;
};

export type StockSnapshot = {
  stockStatus: string;
  stockQuantity: number | null;
  variations: ReadonlyArray<StockVariationSnapshot>;
  brandSlug?: string | null;
};

/**
 * Placeholder kept for a stock line that has to stream. The PDP does not
 * mount it: `getProductStock` expires at five minutes and is part of the
 * stored document.
 */
export function AvailabilityLineFallback() {
  return (
    <div
      className="headkit-availability-fallback flex h-5 items-center text-sm text-muted-foreground"
      aria-busy="true"
    >
      Checking availability
    </div>
  );
}

/**
 * Availability for the variation `ProductDetail` has selected. The snapshot
 * is the five-minute stock read; the selection comes from context, so a size
 * click moves the line and the button together.
 */
export function LiveAvailability({ snapshot }: { snapshot: StockSnapshot }) {
  const selection = useContext(SelectionContext);
  const variationId = selection?.variationId ?? null;
  const variation =
    variationId == null
      ? null
      : (snapshot.variations.find((v) => String(v.id) === variationId) ?? null);
  const stockStatus = variation?.stockStatus ?? snapshot.stockStatus;
  const stockQuantity = variation?.stockQuantity ?? snapshot.stockQuantity;

  const publish = selection?.publish;
  useLayoutEffect(() => {
    publish?.({ variationId, stockStatus, stockQuantity });
  }, [publish, variationId, stockStatus, stockQuantity]);

  return (
    <AvailabilityStatus
      stockStatus={stockStatus}
      stockQuantity={stockQuantity}
      {...(snapshot.brandSlug != null ? { brandSlug: snapshot.brandSlug } : {})}
    />
  );
}

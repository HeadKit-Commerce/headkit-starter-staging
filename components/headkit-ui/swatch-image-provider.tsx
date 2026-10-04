"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SwatchImageStream } from "@/lib/swatch-image";

export interface SwatchImageContextValue {
  /** Server-read `HEADKIT_EXPERIMENTAL_SWATCH_IMAGES`. Off means no WordPress. */
  enabled: boolean;
  /** Unawaited term lookup for this page. Null when the flag is off. */
  promise: Promise<SwatchImageStream> | null;
}

const SwatchImageContext = createContext<SwatchImageContextValue>({
  enabled: false,
  promise: null,
});

export function SwatchImageProvider({
  enabled,
  promise = null,
  children,
}: {
  enabled: boolean;
  promise?: Promise<SwatchImageStream> | null;
  children: ReactNode;
}) {
  return (
    <SwatchImageContext.Provider
      value={{ enabled, promise: enabled ? promise : null }}
    >
      {children}
    </SwatchImageContext.Provider>
  );
}

export function useSwatchImageContext(): SwatchImageContextValue {
  return useContext(SwatchImageContext);
}

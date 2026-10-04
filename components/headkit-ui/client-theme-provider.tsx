"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ClientThemeSlice } from "@/lib/client-theme";

const EMPTY: ClientThemeSlice = {};

const ClientThemeContext = createContext<ClientThemeSlice>(EMPTY);

interface Props {
  value: ClientThemeSlice;
  children: ReactNode;
}

/**
 * Validated theme slice from the server layout. Defaults match a starter
 * theme.json that sets none of these fields.
 */
export function ClientThemeProvider({
  value,
  children,
}: Props): React.JSX.Element {
  return (
    <ClientThemeContext.Provider value={value}>
      {children}
    </ClientThemeContext.Provider>
  );
}

export function useClientTheme(): ClientThemeSlice {
  return useContext(ClientThemeContext);
}

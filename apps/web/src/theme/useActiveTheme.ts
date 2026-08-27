import { createContext, useContext } from "react";
import type { ThemeSectionVisibility, ThemeTokens } from "@restaurant/types";
import type { ThemeDefinition } from "./types";

export interface ActiveTheme {
  definition: ThemeDefinition;
  tokens: ThemeTokens;
  sections: ThemeSectionVisibility;
}

/** Provided by ThemeProvider (mounted once, above <App>, inside RestaurantProvider — see
 *  main.tsx) so Layout/MenuPage never re-derive the active theme themselves. */
export const ActiveThemeContext = createContext<ActiveTheme | undefined>(undefined);

export function useActiveTheme(): ActiveTheme {
  const ctx = useContext(ActiveThemeContext);
  if (!ctx) throw new Error("useActiveTheme must be used within ThemeProvider");
  return ctx;
}

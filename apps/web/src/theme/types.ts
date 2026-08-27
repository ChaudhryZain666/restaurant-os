import type { ComponentType } from "react";
import type { MenuItem, ModifierGroup, Restaurant, RestaurantAvailability, ThemeKey, ThemeTokens } from "@restaurant/types";

/**
 * Phase 31 — the storefront runtime's component contract. A ThemeDefinition (registry.tsx) supplies
 * one implementation of each interface below; MenuPage/Layout own ALL data fetching, cart/ordering
 * state, and business logic, and only ever hand themes fully-computed props + plain callbacks. A
 * theme component never imports CartContext, never calls the API, and never makes an ordering
 * decision — it only renders what it's given. This is what keeps three structurally different
 * storefronts from ever risking cart/checkout/ordering correctness (see docs/theme-architecture.md).
 */

export interface ThemeNavLink {
  to: string;
  label: string;
  end?: boolean;
}

export interface HeaderProps {
  restaurant: Restaurant | null;
  restaurantLoading: boolean;
  menuHref: string;
  cartHref: string;
  links: ThemeNavLink[];
  itemCount: number;
  cartPopping: boolean;
  userName: string | null;
  onLogout: () => void;
}

export interface FooterProps {
  restaurant: Restaurant | null;
  /** True when resolved via an active custom domain (Phase 22/28) — the footer must never expose
   *  platform branding on a white-labeled storefront. */
  hideBranding: boolean;
}

export interface HeroProps {
  restaurant: Restaurant | null;
  availability: RestaurantAvailability | null;
  orderingOpen: boolean;
  directionsQuery: string;
  hasCategories: boolean;
  onStartOrder: () => void;
}

export interface CategoryNavProps {
  categories: { id: string; name: string }[];
  activeCategoryId: string | null;
  onSelect: (id: string) => void;
}

/** Everything one category's product grid/list needs to render itself AND drive the shared
 *  add-to-cart / modifier-selection flow that MenuPage owns. */
export interface MenuSectionProps {
  category: { id: string; name: string };
  items: MenuItem[];
  currency: string;
  orderingOpen: boolean;
  expandedItemId: string | null;
  justAddedId: string | null;
  groupsByItem: Map<string, ModifierGroup[]>;
  selections: Record<string, string[]>;
  instructionsDraft: string;
  onStartAdding: (item: MenuItem) => void;
  onToggleOption: (group: ModifierGroup, optionId: string) => void;
  onInstructionsChange: (value: string) => void;
  onConfirmAdd: (item: MenuItem) => void;
  onCancelAdd: () => void;
  registerSectionRef: (id: string, el: HTMLElement | null) => void;
}

/** Optional storefront sections (see @restaurant/types ThemeSectionKey) — rendered only when the
 *  active theme declares support AND the restaurant has it enabled. Every section degrades to
 *  rendering nothing when the underlying restaurant data it needs isn't present (never placeholder/
 *  fake content). */
export interface FeaturedProps {
  restaurant: Restaurant | null;
  items: MenuItem[];
  currency: string;
}

export interface AboutProps {
  restaurant: Restaurant | null;
}

export interface GalleryProps {
  restaurant: Restaurant | null;
}

export interface CtaProps {
  restaurant: Restaurant | null;
  orderingOpen: boolean;
  hasCategories: boolean;
  onStartOrder: () => void;
}

export interface ThemeComponents {
  Header: ComponentType<HeaderProps>;
  Footer: ComponentType<FooterProps>;
  Hero: ComponentType<HeroProps>;
  CategoryNav: ComponentType<CategoryNavProps>;
  MenuSection: ComponentType<MenuSectionProps>;
  Featured: ComponentType<FeaturedProps>;
  About: ComponentType<AboutProps>;
  Gallery: ComponentType<GalleryProps>;
  Cta: ComponentType<CtaProps>;
}

export interface ThemeDefinition {
  key: ThemeKey;
  /** Plain-language name/description — surfaced in the admin Theme Studio's picker. */
  name: string;
  description: string;
  /** Defaults for every restaurant-overridable token (colors/radius/density) — see
   *  resolveThemeTokens. */
  defaultTokens: ThemeTokens;
  /** System font stacks only — no network font loading (see index.css's own note). Not
   *  restaurant-customizable in v1: each theme's typographic personality is part of its identity. */
  fonts: { heading: string; body: string };
  components: ThemeComponents;
}

/**
 * Phase 21 — DTOs for the sparse per-location override rows introduced in Phase 20
 * (apps/api/src/models/{Category,MenuItem,ModifierGroup}LocationOverride.ts). A row only exists
 * when a location's effective value for an overridable field actually diverges from the
 * business's canonical default — see docs/multi-tenant-storefront-architecture.md's Phase 20
 * section for the full field-ownership scope matrix (name/description/etc. are never
 * overridable, only price/availability/sortOrder and modifier option price/availability are).
 */

export interface CategoryLocationOverride {
  id: string;
  businessId: string;
  locationId: string;
  categoryId: string;
  isActive?: boolean;
  sortOrderOverride?: number;
}

export interface MenuItemLocationOverride {
  id: string;
  businessId: string;
  locationId: string;
  menuItemId: string;
  isAvailable?: boolean;
  priceOverride?: number;
  sortOrderOverride?: number;
}

export interface ModifierOptionOverride {
  optionId: string;
  isActive?: boolean;
  priceAdjustmentOverride?: number;
}

export interface ModifierGroupLocationOverride {
  id: string;
  businessId: string;
  locationId: string;
  modifierGroupId: string;
  isActive?: boolean;
  optionOverrides: ModifierOptionOverride[];
}

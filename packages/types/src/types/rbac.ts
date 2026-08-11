// USER_ROLES is the source of truth (as const, so Mongoose's InferSchemaType can narrow
// `enum: USER_ROLES` to this literal union — a widened `readonly UserRole[]` type here would
// make every role field infer as `unknown` instead).
export const USER_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "restaurant_manager",
  "restaurant_staff",
  "kitchen_staff",
  "customer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Roles that belong to exactly one restaurant (tenant-scoped staff, not the platform or customers). */
export const RESTAURANT_SCOPED_ROLES: readonly UserRole[] = [
  "restaurant_owner",
  "restaurant_manager",
  "restaurant_staff",
  "kitchen_staff",
];

export type Permission =
  | "restaurant.manage"
  | "restaurant.settings.manage"
  | "restaurant.staff.manage"
  | "restaurant.menu.read"
  | "restaurant.menu.write"
  | "restaurant.categories.write"
  | "restaurant.modifiers.write"
  | "restaurant.orders.read"
  | "restaurant.orders.manage"
  | "restaurant.analytics.read"
  | "platform.restaurants.manage"
  | "platform.users.manage";

/**
 * Static role → permission grants. The source of truth for both API enforcement and UI gating.
 *
 * There is no separate "ADMIN" role — Phase 1 maps that tier onto restaurant_manager, which
 * already has broad operational access short of restaurant.settings.manage (owner-only, the
 * "OWNER has full restaurant access" boundary).
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  platform_admin: ["platform.restaurants.manage", "platform.users.manage"],
  restaurant_owner: [
    "restaurant.manage",
    "restaurant.settings.manage",
    "restaurant.staff.manage",
    "restaurant.menu.read",
    "restaurant.menu.write",
    "restaurant.categories.write",
    "restaurant.modifiers.write",
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.analytics.read",
  ],
  restaurant_manager: [
    "restaurant.menu.read",
    "restaurant.menu.write",
    "restaurant.categories.write",
    "restaurant.modifiers.write",
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.analytics.read",
  ],
  restaurant_staff: ["restaurant.menu.read", "restaurant.orders.read", "restaurant.orders.manage"],
  kitchen_staff: ["restaurant.orders.read", "restaurant.orders.manage"],
  customer: [],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

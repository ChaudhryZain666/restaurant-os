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
  "agency_member",
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
  | "restaurant.promotions.manage"
  | "restaurant.loyalty.manage"
  | "restaurant.orders.read"
  | "restaurant.orders.manage"
  | "restaurant.payments.manage"
  | "restaurant.audit.read"
  | "restaurant.analytics.read"
  | "restaurant.tables.manage"
  | "restaurant.pos.operate"
  | "billing.read"
  | "billing.manage"
  | "platform.restaurants.manage"
  | "platform.users.manage"
  | "support.knowledgebase.write"
  | "support.tickets.read"
  | "support.tickets.write"
  | "support.tickets.assign"
  | "support.tickets.internal_notes"
  | "support.analytics.read";

/**
 * Static role → permission grants. The source of truth for both API enforcement and UI gating.
 *
 * There is no separate "ADMIN" role — Phase 1 maps that tier onto restaurant_manager, which
 * already has broad operational access short of restaurant.settings.manage (owner-only, the
 * "OWNER has full restaurant access" boundary).
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  platform_admin: [
    "platform.restaurants.manage",
    "platform.users.manage",
    "support.knowledgebase.write",
    "support.tickets.read",
    "support.tickets.write",
    "support.tickets.assign",
    "support.tickets.internal_notes",
    "support.analytics.read",
  ],
  restaurant_owner: [
    "restaurant.manage",
    "restaurant.settings.manage",
    "restaurant.staff.manage",
    "restaurant.menu.read",
    "restaurant.menu.write",
    "restaurant.categories.write",
    "restaurant.modifiers.write",
    "restaurant.promotions.manage",
    "restaurant.loyalty.manage",
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.payments.manage",
    "restaurant.audit.read",
    "restaurant.analytics.read",
    "restaurant.tables.manage",
    "restaurant.pos.operate",
    "billing.read",
    "billing.manage",
    "support.tickets.read",
  ],
  restaurant_manager: [
    "restaurant.menu.read",
    "restaurant.menu.write",
    "restaurant.categories.write",
    "restaurant.modifiers.write",
    "restaurant.promotions.manage",
    "restaurant.loyalty.manage",
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.payments.manage",
    "restaurant.audit.read",
    "restaurant.analytics.read",
    "restaurant.tables.manage",
    "restaurant.pos.operate",
    "billing.read",
    "support.tickets.read",
  ],
  // Front-of-house staff — the role that actually runs a register, unlike kitchen_staff below.
  restaurant_staff: ["restaurant.menu.read", "restaurant.orders.read", "restaurant.orders.manage", "restaurant.pos.operate"],
  kitchen_staff: ["restaurant.orders.read", "restaurant.orders.manage"],
  customer: [],
  // Phase 25 — a coarse top-level identity only (person whose primary identity is agency
  // affiliation, no business of their own). Deliberately empty: every real capability an agency
  // member has flows through their per-agency AgencyMembership role (agencyRoleHasPermission /
  // agencyRoleGrantsPermission in agencyRbac.ts), never a flat global grant here — a person
  // can be agency_owner in one agency and agency_staff in another, which a single global role value
  // can't express. See middleware/agency.ts and businessLocation.ts's requireBusinessPermission.
  agency_member: [],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

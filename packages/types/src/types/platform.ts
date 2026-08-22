import type { UserRole } from "./rbac.js";
import type { Restaurant, RestaurantReadiness } from "./restaurant.js";
import type { RestaurantAnalytics } from "./analytics.js";
import type { AuditLogEntry } from "./auditLog.js";

export interface PlatformRestaurantSummary {
  id: string;
  name: string;
  slug: string;
  status: "pending" | "active" | "suspended";
  city?: string;
  state?: string;
  country?: string;
  ownerName?: string;
  ownerEmail?: string;
  /** True while the owner account created alongside this restaurant hasn't accepted their
   *  invitation yet (still has an unexpired/expired invite token, no password set). Lets the
   *  platform-admin Restaurants page offer "Resend invite" only when it's actually meaningful. */
  ownerInvitePending?: boolean;
  orderCount: number;
  createdAt: string;
}

export interface PlatformUserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  restaurantName?: string;
  isActive: boolean;
  createdAt: string;
}

export interface PlatformRestaurantOwnerDetail {
  id: string;
  name: string;
  email: string;
  phone?: string;
  invitePending: boolean;
  inviteExpiresAt?: string;
  isActive: boolean;
}

/** GET /platform/restaurants/:id — the single-restaurant overview page (Phase 16), read-only and
 *  assembled without granting platform_admin any owner-level restaurant permission. */
export interface PlatformRestaurantDetail {
  restaurant: Restaurant;
  owner: PlatformRestaurantOwnerDetail | null;
  readiness: RestaurantReadiness;
  analytics: RestaurantAnalytics;
  orderCountLifetime: number;
  recentAuditLog: AuditLogEntry[];
  /** Phase 19 — how many Restaurant (location) documents share this one's businessId, including
   *  itself. 1 for the still-overwhelmingly-common single-location case. */
  businessLocationCount: number;
}

export interface PlatformOverview {
  totalRestaurants: number;
  activeRestaurants: number;
  totalUsers: number;
  totalOrders: number;
  openSupportTickets: number;
  recentRestaurants: Pick<PlatformRestaurantSummary, "id" | "name" | "status" | "createdAt">[];
}

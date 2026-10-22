import type { UserRole } from "./rbac.js";
import type { Restaurant, RestaurantReadiness } from "./restaurant.js";
import type { RestaurantAnalytics } from "./analytics.js";
import type { AuditLogEntry } from "./auditLog.js";
import type { RestaurantPaymentAccount } from "./restaurantPaymentAccount.js";
import type { RestaurantMarketplaceIntegration } from "./marketplace.js";
import type { BillingInterval, PlanType } from "./plan.js";
import type { SubscriptionProvider, SubscriptionStatus } from "./subscription.js";

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
  /** Phase 78 — read-only diagnostic visibility, same rationale as the fields above: platform_admin
   *  has neither restaurant.payments.manage nor restaurant.marketplace.* (see rbac.ts), so this is
   *  never a write path. encryptedCredentials is never present (each model's own toJSON transform
   *  strips it unconditionally) — everything else here was never a secret. */
  paymentAccount: RestaurantPaymentAccount | null;
  marketplaceIntegrations: RestaurantMarketplaceIntegration[];
  /** Phase 24 — the business's most recent subscription (any status), provider ids stripped. */
  subscription: PlatformSubscriptionSummary | null;
}

export interface PlatformSubscriptionSummary {
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodEnd: string;
  trialEnd: string | null;
  cancelAt: string | null;
  provider: SubscriptionProvider;
  planCode: string | null;
  planName: string | null;
}

/** GET /platform/plans — every ACTIVE plan, including private (isPubliclyListed:false) ones made
 *  for a specific client. Provider price ids are reduced to a hasCheckoutPrice flag. */
export interface PlatformPlanOption {
  code: string;
  name: string;
  type: PlanType;
  isPubliclyListed: boolean;
  trialDays: number | null;
  /** Only plans with a trial can be assigned by a platform admin — a no-trial plan needs checkout. */
  assignable: boolean;
  pricing: { interval: BillingInterval; amountCents?: number; currency?: string; hasCheckoutPrice: boolean }[];
}

export interface PlatformOverview {
  totalRestaurants: number;
  activeRestaurants: number;
  totalUsers: number;
  totalOrders: number;
  openSupportTickets: number;
  recentRestaurants: Pick<PlatformRestaurantSummary, "id" | "name" | "status" | "createdAt">[];
}

import mongoose, { type HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User, type UserDoc } from "../models/User.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Table } from "../models/Table.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { signAccessToken } from "../services/token.service.js";
import { generateTableToken } from "../services/tableToken.service.js";
import { redis } from "../config/redis.js";
import { queueConnection } from "../queues/connection.js";

/**
 * ioredis's `quit()` resolves once the QUIT command is acknowledged, but the underlying socket
 * can still emit a trailing ECONNRESET after that (observed locally on Windows) — which fires the
 * shared client's "error" listener (console.error) after Jest has already torn down the test
 * file's environment, surfacing as a spurious "Cannot log after tests are done" suite failure
 * even though every assertion passed. Dropping the listener right before quitting is safe here:
 * it only removes it at teardown, after all real test assertions have already run.
 *
 * queueConnection (BullMQ's own separate Redis connection — see queues/connection.ts) needs the
 * exact same treatment: any test that imports something which transitively touches
 * notification.queue.ts (order status changes, since Phase 40's delivery dispatch trigger — see
 * orderTransition.service.ts) opens this connection too, and leaving it open is what Jest's own
 * "did not exit one second after the test run has completed" warning is about.
 */
export async function closeTestConnections(): Promise<void> {
  await mongoose.disconnect();
  redis.removeAllListeners("error");
  await redis.quit();
  queueConnection.removeAllListeners("error");
  await queueConnection.quit();
}

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createTestRestaurant(overrides: Partial<Record<string, unknown>> = {}) {
  return Restaurant.create({
    name: "Test Restaurant",
    slug: unique("test-restaurant"),
    ownerId: new mongoose.Types.ObjectId(),
    status: "active",
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      cashEnabled: true,
      // Permissive by default so existing online-payment tests don't need to know about this
      // Phase 15 toggle unless they're specifically testing it — mirrors pickupEnabled/
      // deliveryEnabled already being enabled-by-default here for the same reason.
      onlinePaymentEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 5,
    },
    ...overrides,
  });
}

export async function createTestBusiness(overrides: Partial<Record<string, unknown>> = {}) {
  return Business.create({
    name: "Test Business",
    slug: unique("test-business"),
    ownerId: new mongoose.Types.ObjectId(),
    status: "active",
    ...overrides,
  });
}

export async function createTestUser(
  role: UserRole,
  restaurantId?: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return User.create({
    name: `Test ${role}`,
    email: unique(role) + "@test.local",
    passwordHash: await bcrypt.hash("Password123!", 4),
    role,
    restaurantId,
    ...overrides,
  });
}

export function tokenFor(
  user: HydratedDocument<UserDoc>,
  agencyMemberships: Array<{ agencyId: string; role: "agency_owner" | "agency_admin" | "agency_staff" }> = []
) {
  return signAccessToken({
    sub: user.id as string,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
    // Phase 18, additive — mirrors auth.controller.ts's issueSession exactly, so tests exercising
    // the new Business/Location authorization path can use this same established helper.
    businessId: user.businessId?.toString(),
    locationIds: user.locationIds?.map((id) => id.toString()),
    // Phase 25 — same reasoning; tests pass this explicitly rather than querying AgencyMembership,
    // since a test's fixture setup already knows exactly what it created.
    agencyMemberships,
  });
}

export async function createTestCategory(restaurantId: mongoose.Types.ObjectId, overrides: Partial<Record<string, unknown>> = {}) {
  return Category.create({
    restaurantId,
    name: unique("Category"),
    sortOrder: 0,
    ...overrides,
  });
}

export async function createTestMenuItem(
  restaurantId: mongoose.Types.ObjectId,
  categoryId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return MenuItem.create({
    restaurantId,
    categoryId,
    name: unique("Item"),
    price: 10,
    ...overrides,
  });
}

export async function createTestOrder(
  restaurantId: mongoose.Types.ObjectId,
  customerId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return Order.create({
    restaurantId,
    customerId,
    orderNumber: unique("ORD"),
    items: [
      { menuItemId: new mongoose.Types.ObjectId(), name: "Test Item", unitPrice: 10, quantity: 1, lineTotal: 10 },
    ],
    orderType: "pickup",
    paymentMethod: "cash",
    subtotal: 10,
    total: 10,
    statusHistory: [{ status: "pending", at: new Date() }],
    ...overrides,
  });
}

export async function createTestPayment(
  restaurantId: mongoose.Types.ObjectId,
  orderId: mongoose.Types.ObjectId,
  customerId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return Payment.create({
    restaurantId,
    orderId,
    customerId,
    method: "online",
    provider: "mock",
    providerRef: `mock_pi_${unique("ref")}`,
    currency: "USD",
    amount: 10,
    status: "pending",
    ...overrides,
  });
}

export async function createTestTable(restaurantId: mongoose.Types.ObjectId, overrides: Partial<Record<string, unknown>> = {}) {
  return Table.create({
    restaurantId,
    name: unique("Table"),
    capacity: 2,
    qrToken: generateTableToken(),
    ...overrides,
  });
}

export async function createTestPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return Plan.create({
    code: unique("plan"),
    name: "Test Plan",
    type: "OWNER",
    pricing: [],
    entitlements: [
      { key: "custom_domains", value: true },
      { key: "business_analytics", value: true },
      { key: "business_promotions", value: true },
    ],
    isActive: true,
    ...overrides,
  });
}

/** Phase 27 — seeds a LIVE subscription directly (no HTTP round-trip), for tests whose subject is
 *  entitlement/limit ENFORCEMENT rather than subscription creation itself. Defaults to a business
 *  owner, "active", far-future period end so no test needs to reason about expiry.
 *  provider defaults to "mock" (a REAL, enforced subscription), never "internal" — "internal"
 *  (grandfathered/comped) is deliberately EXCLUDED from entitlement/limit enforcement (see
 *  entitlementLimit.service.ts's/agencyEntitlement.service.ts's resolveOwnerPlan/getMaxBusinesses
 *  doc comments), so a test wanting to prove real enforcement must not default into that exclusion
 *  by accident — pass `{provider:"internal"}` explicitly for a test whose subject IS grandfathering. */
export async function createTestSubscription(
  ownerType: "business" | "agency",
  ownerId: mongoose.Types.ObjectId,
  planId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const now = new Date();
  return Subscription.create({
    ownerType,
    ownerId,
    planId,
    status: "active",
    billingInterval: "monthly",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    provider: "mock",
    ...overrides,
  });
}

export async function createTestAgency(overrides: Partial<Record<string, unknown>> = {}) {
  return Agency.create({
    name: "Test Agency",
    slug: unique("test-agency"),
    contactEmail: unique("agency") + "@test.local",
    status: "active",
    ...overrides,
  });
}

/** Creates an ACTIVE membership directly (no invite/accept flow) — pair with tokenFor's second
 *  argument to get a token whose agencyMemberships claim matches what was actually created. */
export async function createTestAgencyMembership(
  agencyId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return AgencyMembership.create({
    agencyId,
    userId,
    role: "agency_owner",
    status: "active",
    acceptedAt: new Date(),
    ...overrides,
  });
}

export async function createTestModifierGroup(
  restaurantId: mongoose.Types.ObjectId,
  menuItemId: mongoose.Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return ModifierGroup.create({
    restaurantId,
    menuItemId,
    name: unique("Group"),
    minSelect: 0,
    maxSelect: 1,
    options: [{ name: "Option A", priceAdjustment: 1.5 }],
    ...overrides,
  });
}

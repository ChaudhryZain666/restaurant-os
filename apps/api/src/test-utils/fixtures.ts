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
import { signAccessToken } from "../services/token.service.js";
import { generateTableToken } from "../services/tableToken.service.js";
import { redis } from "../config/redis.js";

/**
 * ioredis's `quit()` resolves once the QUIT command is acknowledged, but the underlying socket
 * can still emit a trailing ECONNRESET after that (observed locally on Windows) — which fires the
 * shared client's "error" listener (console.error) after Jest has already torn down the test
 * file's environment, surfacing as a spurious "Cannot log after tests are done" suite failure
 * even though every assertion passed. Dropping the listener right before quitting is safe here:
 * it only removes it at teardown, after all real test assertions have already run.
 */
export async function closeTestConnections(): Promise<void> {
  await mongoose.disconnect();
  redis.removeAllListeners("error");
  await redis.quit();
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

export function tokenFor(user: HydratedDocument<UserDoc>) {
  return signAccessToken({
    sub: user.id as string,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
    // Phase 18, additive — mirrors auth.controller.ts's issueSession exactly, so tests exercising
    // the new Business/Location authorization path can use this same established helper.
    businessId: user.businessId?.toString(),
    locationIds: user.locationIds?.map((id) => id.toString()),
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

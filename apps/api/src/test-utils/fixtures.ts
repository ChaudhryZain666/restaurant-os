import mongoose, { type HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { User, type UserDoc } from "../models/User.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { signAccessToken } from "../services/token.service.js";
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
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 5,
    },
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

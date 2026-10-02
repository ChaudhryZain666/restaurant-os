import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import {
  DEMO_CATEGORIES,
  DEMO_MENU_ITEMS,
  DEMO_MODIFIER_GROUPS,
  DEMO_RESTAURANT_PROFILE,
} from "../scripts/demo/wildwoodKitchenCatalog.js";

/**
 * Phase 85A — production-safe provisioning of the marketing site's live demo storefront
 * (`/r/demo-restaurant`, apps/marketing's DEMO_STOREFRONT_URL). scripts/seed-demo-data.ts must never
 * run against production (known-password accounts, fake orders/customers/tickets), so this creates
 * ONLY the public storefront: one owner placeholder, its business, the restaurant, and its menu.
 *
 * Safety rules:
 *  - The demo tenant is identified by its owner account, DEMO_OWNER_EMAIL — an address under the
 *    reserved `.invalid` TLD, so it can never receive mail or belong to a real person. Its password
 *    is random and never printed: nobody can sign in as it.
 *  - If `demo-restaurant` (business or restaurant slug) exists and is NOT owned by that account, the
 *    run refuses and changes nothing — a real tenant that took the slug is never touched.
 *  - Every step is create-if-absent, matched by name within the demo tenant only, so re-running is
 *    a no-op and never duplicates categories, items or modifier groups. Existing demo content is
 *    never overwritten or reset.
 *  - No orders, customers, payments, staff, tables, support tickets or platform accounts.
 */
export const DEMO_SLUG = "demo-restaurant";
export const DEMO_OWNER_EMAIL = "demo-owner@demo-restaurant.garnishtable.invalid";

export class DemoProvisioningConflictError extends Error {}

export interface DemoProvisioningResult {
  restaurantId: string;
  created: {
    owner: boolean;
    business: boolean;
    restaurant: boolean;
    categories: number;
    menuItems: number;
    modifierGroups: number;
  };
}

/** `slug`/`ownerEmail` exist only so tests can run in a shared database without colliding with
 *  other suites; production always uses the defaults. */
export async function provisionProductionDemo({
  slug = DEMO_SLUG,
  ownerEmail = DEMO_OWNER_EMAIL,
}: { slug?: string; ownerEmail?: string } = {}): Promise<DemoProvisioningResult> {
  const created = { owner: false, business: false, restaurant: false, categories: 0, menuItems: 0, modifierGroups: 0 };

  // Ownership check first, before anything is written.
  let owner = await User.findOne({ email: ownerEmail });
  const [existingBusiness, existingRestaurant] = await Promise.all([
    Business.findOne({ slug }),
    Restaurant.findOne({ slug }),
  ]);
  for (const [label, doc] of [
    ["business", existingBusiness],
    ["restaurant", existingRestaurant],
  ] as const) {
    if (doc && (!owner || !doc.ownerId.equals(owner._id))) {
      throw new DemoProvisioningConflictError(
        `A ${label} with slug "${slug}" already exists and is not the GarnishTable demo tenant (owner is not ${ownerEmail}). ` +
          "Nothing was changed. Resolve the slug conflict manually before provisioning the demo."
      );
    }
  }

  if (!owner) {
    owner = await User.create({
      name: "GarnishTable Demo",
      email: ownerEmail,
      // Random and immediately discarded: the account exists only to own the demo tenant.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
      role: "restaurant_owner",
    });
    created.owner = true;
  }

  let business = existingBusiness;
  if (!business) {
    business = await Business.create({ name: DEMO_RESTAURANT_PROFILE.name, slug, ownerId: owner._id, status: "active" });
    created.business = true;
  }

  let restaurant = existingRestaurant;
  if (!restaurant) {
    const { theme, ...profile } = DEMO_RESTAURANT_PROFILE;
    restaurant = await Restaurant.create({
      ...profile,
      slug,
      businessId: business._id,
      ownerId: owner._id,
      status: "active",
      settings: {
        currency: "USD",
        timezone: "America/Chicago",
        orderingEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        dineInEnabled: true,
        cashEnabled: true,
        // No payment account exists for the demo, and production never processes mock online
        // payments (payments/restaurantProvider.ts) — the demo takes cash orders only.
        onlinePaymentEnabled: false,
        minOrderAmount: 0,
        taxRate: 0.08,
        deliveryFee: 3.99,
        deliveryRadiusKm: 8,
        businessHours: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({
          day,
          isClosed: false,
          open: "00:00",
          close: "00:00",
        })),
        theme,
      },
    });
    created.restaurant = true;
  }

  if (!owner.restaurantId || !owner.businessId) {
    owner.restaurantId = restaurant._id;
    owner.businessId = business._id;
    await owner.save();
  }

  const scope = { restaurantId: restaurant._id, businessId: business._id };

  const categoryIdByName = new Map<string, unknown>();
  for (const category of DEMO_CATEGORIES) {
    let doc = await Category.findOne({ ...scope, name: category.name });
    if (!doc) {
      doc = await Category.create({ ...scope, ...category });
      created.categories += 1;
    }
    categoryIdByName.set(category.name, doc._id);
  }

  const itemIdByName = new Map<string, unknown>();
  for (const { category, ...item } of DEMO_MENU_ITEMS) {
    let doc = await MenuItem.findOne({ ...scope, name: item.name });
    if (!doc) {
      doc = await MenuItem.create({ ...scope, ...item, categoryId: categoryIdByName.get(category) });
      created.menuItems += 1;
    }
    itemIdByName.set(item.name, doc._id);
  }

  for (const { item, ...group } of DEMO_MODIFIER_GROUPS) {
    const menuItemId = itemIdByName.get(item);
    if (await ModifierGroup.exists({ ...scope, menuItemId, name: group.name })) continue;
    await ModifierGroup.create({ ...scope, ...group, menuItemId });
    created.modifierGroups += 1;
  }

  return { restaurantId: restaurant.id as string, created };
}

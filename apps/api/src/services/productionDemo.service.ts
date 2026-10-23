import type { Types } from "mongoose";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { recordAuditEvent } from "./audit.service.js";
import { createStaffInvite } from "./staffInvite.service.js";
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

  // Ownership check first, before anything is written. The demo is owned either by the placeholder
  // account or — after scripts/transferDemoOwnership.ts — by a platform admin; anything else is a
  // real tenant that took the slug and is never touched.
  let owner = await User.findOne({ email: ownerEmail });
  const [existingBusiness, existingRestaurant] = await Promise.all([
    Business.findOne({ slug }),
    Restaurant.findOne({ slug }),
  ]);
  for (const [label, doc] of [
    ["business", existingBusiness],
    ["restaurant", existingRestaurant],
  ] as const) {
    if (doc && !(await isDemoOwner(doc.ownerId, owner?._id))) {
      throw new DemoProvisioningConflictError(
        `A ${label} with slug "${slug}" already exists and is not the GarnishTable demo tenant (owner is neither ${ownerEmail} nor a platform admin). ` +
          "Nothing was changed. Resolve the slug conflict manually before provisioning the demo."
      );
    }
  }

  // Whoever already owns the demo keeps owning anything added now; only a brand-new demo is
  // created under the placeholder (which is created only if it's actually needed).
  let ownerId = existingBusiness?.ownerId ?? existingRestaurant?.ownerId ?? owner?._id;
  if (!ownerId) {
    owner = await User.create({
      name: "GarnishTable Demo",
      email: ownerEmail,
      // Random and immediately discarded: the account exists only to own the demo tenant.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
      role: "restaurant_owner",
    });
    created.owner = true;
    ownerId = owner._id;
  }

  let business = existingBusiness;
  if (!business) {
    business = await Business.create({ name: DEMO_RESTAURANT_PROFILE.name, slug, ownerId, status: "active" });
    created.business = true;
  }

  let restaurant = existingRestaurant;
  if (!restaurant) {
    const { theme, ...profile } = DEMO_RESTAURANT_PROFILE;
    restaurant = await Restaurant.create({
      ...profile,
      slug,
      businessId: business._id,
      ownerId,
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

  // The placeholder (a restaurant_owner) points at the demo it owns; a platform admin owner never
  // gets restaurantId/businessId — its access comes from ownerOfRecord.service.ts instead.
  if (owner && owner._id.equals(ownerId) && (!owner.restaurantId || !owner.businessId)) {
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

/**
 * Lane A — operating access to the demo tenant for a GarnishTable team member, WITHOUT merging the
 * demo owner placeholder into anyone's account and without widening platform_admin's permissions.
 *
 * One email is one account with one role, so a platform admin's own address can't also be a
 * restaurant identity. Instead the team member gets a SEPARATE restaurant_manager login (a different
 * address — e.g. a plus-address of their own) through the exact invite flow an owner's "Invite
 * staff" uses (services/staffInvite.service.ts): a one-time email link, they set their own
 * password. A manager can run the menu, orders, POS and settings for the demo only, and holds
 * neither billing.manage nor any platform permission, so nothing done in the demo can touch real
 * customers' billing or data. Their platform-admin account is unchanged.
 *
 * Refuses (changing nothing) unless the demo tenant exists and is owned by DEMO_OWNER_EMAIL, and if
 * the email already has any account. If the invite email can't be sent, the new account is removed
 * again so a re-run starts clean.
 */
export async function inviteDemoManager({
  name,
  email,
  slug = DEMO_SLUG,
  ownerEmail = DEMO_OWNER_EMAIL,
}: {
  name: string;
  email: string;
  slug?: string;
  ownerEmail?: string;
}): Promise<{ restaurantId: string; userId: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const [owner, restaurant] = await Promise.all([User.findOne({ email: ownerEmail }), Restaurant.findOne({ slug })]);
  if (!restaurant) throw new DemoProvisioningConflictError(`No restaurant with slug "${slug}" exists. Provision the demo first.`);
  if (!(await isDemoOwner(restaurant.ownerId, owner?._id))) {
    throw new DemoProvisioningConflictError(
      `The restaurant "${slug}" is not the GarnishTable demo tenant (owner is neither ${ownerEmail} nor a platform admin). Nothing was changed.`
    );
  }
  if (await User.exists({ email: normalizedEmail })) {
    throw new DemoProvisioningConflictError(
      `${normalizedEmail} already has a GarnishTable account. Use a separate address for demo access ` +
        "(for example a plus-address of your own), so your existing account keeps its role. Nothing was changed."
    );
  }

  const { staff, emailSent } = await createStaffInvite(
    restaurant,
    { name, email: normalizedEmail, role: "restaurant_manager" },
    "GarnishTable"
  );
  if (!emailSent) {
    await User.deleteOne({ _id: staff._id });
    throw new Error("The invite email could not be sent (check SMTP settings), so the account was not kept. Nothing was changed.");
  }
  return { restaurantId: restaurant.id as string, userId: staff.id as string };
}

/** The demo's owner is acceptable when it is the placeholder account or a platform admin. */
async function isDemoOwner(ownerId: Types.ObjectId, placeholderId: Types.ObjectId | undefined): Promise<boolean> {
  if (placeholderId && ownerId.equals(placeholderId)) return true;
  return Boolean(await User.exists({ _id: ownerId, role: "platform_admin" }));
}

export interface DemoOwnershipTransferResult {
  changed: boolean;
  restaurantIds: string[];
  fromOwnerId: string;
  toOwnerId: string;
}

/**
 * Lane A / roadmap "demo ownership and admin access" — moves the demo tenant (its Business and every
 * location under it) from the placeholder owner to an existing platform-admin account, or back with
 * `revert`. The admin keeps its platform_admin role (no duplicate account, no role change); its
 * access to run the demo comes from being the recorded owner (ownerOfRecord.service.ts).
 *
 * Safe by construction: refuses unless the target is an ACTIVE platform admin, the slug is the real
 * demo tenant, and the current owner is the expected "from" account; idempotent (a second run reports
 * changed:false); records `restaurant.owner_transferred` on every location's audit log; never
 * deletes or edits the placeholder account, menu, orders or settings.
 */
export async function transferDemoOwnership({
  adminEmail,
  revert = false,
  slug = DEMO_SLUG,
  ownerEmail = DEMO_OWNER_EMAIL,
  actorUserId,
}: {
  adminEmail: string;
  revert?: boolean;
  slug?: string;
  ownerEmail?: string;
  actorUserId?: string;
}): Promise<DemoOwnershipTransferResult> {
  const [admin, placeholder, business] = await Promise.all([
    User.findOne({ email: adminEmail.trim().toLowerCase() }),
    User.findOne({ email: ownerEmail }),
    Business.findOne({ slug }),
  ]);
  if (!admin || admin.role !== "platform_admin" || admin.isActive === false) {
    throw new DemoProvisioningConflictError(`${adminEmail} is not an active platform admin account. Nothing was changed.`);
  }
  if (!placeholder) throw new DemoProvisioningConflictError(`The demo placeholder owner ${ownerEmail} doesn't exist. Nothing was changed.`);
  if (!business) throw new DemoProvisioningConflictError(`No business with slug "${slug}" exists. Nothing was changed.`);

  const from = revert ? admin : placeholder;
  const to = revert ? placeholder : admin;
  const restaurants = await Restaurant.find({ businessId: business._id });
  const result = {
    restaurantIds: restaurants.map((r) => r.id as string),
    fromOwnerId: from.id as string,
    toOwnerId: to.id as string,
  };

  const docs = [business, ...restaurants];
  if (docs.every((d) => d.ownerId.equals(to._id))) return { changed: false, ...result }; // already done
  const unexpected = docs.find((d) => !d.ownerId.equals(from._id) && !d.ownerId.equals(to._id));
  if (unexpected) {
    throw new DemoProvisioningConflictError(
      `The demo "${slug}" has an owner that is neither ${from.email} nor ${to.email}. Nothing was changed.`
    );
  }

  await Business.updateOne({ _id: business._id }, { $set: { ownerId: to._id } });
  await Restaurant.updateMany({ businessId: business._id }, { $set: { ownerId: to._id } });
  await Promise.all(
    restaurants.map((r) =>
      recordAuditEvent({
        restaurantId: r._id,
        actorUserId: actorUserId ?? admin.id,
        actorRole: "platform_admin",
        action: "restaurant.owner_transferred",
        targetType: "restaurant",
        targetId: r._id,
        metadata: { fromOwnerId: result.fromOwnerId, toOwnerId: result.toOwnerId, revert },
      })
    )
  );
  return { changed: true, ...result };
}

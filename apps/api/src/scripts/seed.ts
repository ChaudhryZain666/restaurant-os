import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Plan } from "../models/Plan.js";

async function seed() {
  await connectDB();

  // Phase 24 established the Plan catalog structurally. Phase 27 populated PROPOSED pricing on
  // "owner"/"agency". Phase 34 supersedes that pricing with a real commercial decision
  // (docs/commercial-decisions.md) — Basic/Pro/Agency-tier plans below — WITHOUT deleting or
  // price-mutating the original two documents: `Subscription.planId` is a live, non-snapshotted FK
  // (resolveOwnerPlan/getPlanForSubscription dereference Plan fresh on every check), so any
  // existing subscriber still pointed at "owner"/"agency" must keep seeing exactly the terms they
  // signed up under, forever. "owner"/"agency" are instead flipped isActive:false below — new
  // signups can never select them (createSubscriptionCore/createCheckoutSessionCore both filter
  // `Plan.findOne({code, isActive:true})`), but they remain valid FK targets for existing
  // subscriptions AND for subscriptionBackfill.service.ts's grandfather logic, which resolves
  // `Plan.findOne({code:"owner"})` with no isActive filter at all.
  //
  // All upserts use $setOnInsert (never $set) so re-running seed never clobbers a catalog that's
  // since been hand-edited — the same precedent Phase 25/27 established for this exact shape.
  await Plan.findOneAndUpdate(
    { code: "owner" },
    {
      $setOnInsert: {
        code: "owner",
        name: "Owner",
        type: "OWNER",
        description: "For a single restaurant or a small multi-location group you run yourself.",
        pricing: [
          { interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_owner_monthly" },
          { interval: "yearly", amountCents: 79000, currency: "USD", providerPriceId: "mock_price_owner_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_locations", value: 1 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency" },
    {
      $setOnInsert: {
        code: "agency",
        name: "Agency",
        type: "AGENCY",
        description: "For an agency managing multiple client restaurant businesses.",
        pricing: [
          { interval: "monthly", amountCents: 19900, currency: "USD", providerPriceId: "mock_price_agency_monthly" },
          { interval: "yearly", amountCents: 199000, currency: "USD", providerPriceId: "mock_price_agency_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 5 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  // Retired from new signups the moment Phase 34's replacement tiers exist — never deleted, never
  // price-mutated (see the block comment above). A no-op $set on a doc that's already isActive:false
  // (e.g. a second seed run) — Mongoose update, not $setOnInsert, since this one genuinely needs to
  // apply to an already-existing document, not only a freshly-inserted one.
  await Plan.updateMany({ code: { $in: ["owner", "agency"] } }, { $set: { isActive: false } });

  // Phase 34 — the real Basic/Pro/Agency-tier catalog (docs/commercial-decisions.md's updated
  // pricing table). Included-location/business counts and per-tier feature gating are a defaulted,
  // reasonable starting point flagged in the final report as a product-numbers decision, not a
  // hidden assumption — same PROPOSED-until-confirmed honesty convention as the plans above.
  await Plan.findOneAndUpdate(
    { code: "owner_basic" },
    {
      $setOnInsert: {
        code: "owner_basic",
        name: "Basic",
        type: "OWNER",
        description: "Core online ordering for a single restaurant location.",
        pricing: [
          { interval: "monthly", amountCents: 1500, currency: "USD", providerPriceId: "mock_price_owner_basic_monthly" },
          { interval: "yearly", amountCents: 15000, currency: "USD", providerPriceId: "mock_price_owner_basic_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: false },
          { key: "business_analytics", value: false },
          { key: "business_promotions", value: false },
          { key: "max_locations", value: 1 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "owner_pro" },
    {
      $setOnInsert: {
        code: "owner_pro",
        name: "Pro",
        type: "OWNER",
        description: "Multi-location ordering with custom domains, analytics, and promotions.",
        pricing: [
          { interval: "monthly", amountCents: 2900, currency: "USD", providerPriceId: "mock_price_owner_pro_monthly" },
          { interval: "yearly", amountCents: 29000, currency: "USD", providerPriceId: "mock_price_owner_pro_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_locations", value: 3 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency_starter" },
    {
      $setOnInsert: {
        code: "agency_starter",
        name: "Agency Starter",
        type: "AGENCY",
        description: "For an agency managing up to 5 client businesses.",
        pricing: [
          { interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: "mock_price_agency_starter_monthly" },
          { interval: "yearly", amountCents: 99000, currency: "USD", providerPriceId: "mock_price_agency_starter_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 5 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency_growth" },
    {
      $setOnInsert: {
        code: "agency_growth",
        name: "Agency Growth",
        type: "AGENCY",
        // Real volume economics: $99/5 businesses (Starter) vs. $249/15 (Growth) — a genuinely
        // lower per-business rate at higher volume, not just a bigger flat number.
        description: "For a larger agency managing up to 15 client businesses, at a lower per-business rate.",
        pricing: [
          { interval: "monthly", amountCents: 24900, currency: "USD", providerPriceId: "mock_price_agency_growth_monthly" },
          { interval: "yearly", amountCents: 249000, currency: "USD", providerPriceId: "mock_price_agency_growth_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 15 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  console.log("[seed] ensured plan catalog (owner_basic, owner_pro, agency_starter, agency_growth; legacy owner/agency retained inactive)");

  const platformAdminEmail = "platform-admin@restaurant.local";
  let platformAdmin = await User.findOne({ email: platformAdminEmail });
  if (!platformAdmin) {
    platformAdmin = await User.create({
      name: "Platform Admin",
      email: platformAdminEmail,
      passwordHash: await bcrypt.hash("Admin123!", 12),
      role: "platform_admin",
    });
    console.log(`[seed] created platform admin: ${platformAdminEmail} / Admin123!`);
  }

  const ownerEmail = "owner@demo-restaurant.local";
  let owner = await User.findOne({ email: ownerEmail });
  if (!owner) {
    owner = await User.create({
      name: "Demo Restaurant Owner",
      email: ownerEmail,
      passwordHash: await bcrypt.hash("Owner123!", 12),
      role: "customer", // upgraded to restaurant_owner below, once the restaurant exists
    });
  }

  let restaurant = await Restaurant.findOne({ slug: "demo-restaurant" });
  if (!restaurant) {
    // Phase 21 — seeded restaurants get a Business + canonical (businessId-scoped) menu directly,
    // matching real post-migration shape, rather than the legacy restaurantId-only shape the old
    // write endpoints (now retired for migrated businesses) used to produce. Keeps local dev data
    // consistent with what the real migration actually leaves behind.
    const business = await Business.create({
      name: "Demo Restaurant",
      slug: "demo-restaurant",
      ownerId: owner._id,
      status: "active",
    });

    restaurant = await Restaurant.create({
      name: "Demo Restaurant",
      slug: "demo-restaurant",
      businessId: business._id,
      description: "Wood-fired pizza, smash burgers, and made-from-scratch sides — a neighborhood spot serving Springfield since day one.",
      phone: "+1-555-0100",
      email: "hello@demo-restaurant.local",
      city: "Springfield",
      country: "USA",
      // Real Springfield, IL coordinates — the reference point delivery-radius eligibility is
      // calculated from (see services/delivery.service.ts).
      latitude: 39.7817,
      longitude: -89.6501,
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
        onlinePaymentEnabled: true,
        minOrderAmount: 0,
        taxRate: 0.08,
        deliveryFee: 3.99,
        deliveryRadiusKm: 8,
        businessHours: [
          { day: "monday", isClosed: false, open: "09:00", close: "22:00" },
          { day: "tuesday", isClosed: false, open: "09:00", close: "22:00" },
          { day: "wednesday", isClosed: false, open: "09:00", close: "22:00" },
          { day: "thursday", isClosed: false, open: "09:00", close: "22:00" },
          { day: "friday", isClosed: false, open: "09:00", close: "23:00" },
          { day: "saturday", isClosed: false, open: "10:00", close: "23:00" },
          { day: "sunday", isClosed: true },
        ],
      },
    });
    owner.role = "restaurant_owner";
    owner.restaurantId = restaurant._id;
    // Phase 18's Business/Location model needs this too — BusinessContext (apps/admin) resolves
    // activeBusinessId from here, and every restaurant-scoped nav item depends on that being set.
    // Missing on a genuinely fresh database (this line only ever ran against long-lived dev DBs
    // where some later manual/migration step had already backfilled it) — a real, if previously
    // invisible, gap; not present anywhere else in this script.
    owner.businessId = business._id;
    await owner.save();
    console.log(`[seed] created restaurant "demo-restaurant" owned by ${ownerEmail} / Owner123!`);
  }

  const categoryCount = await Category.countDocuments({ restaurantId: restaurant._id });
  if (categoryCount === 0) {
    // Every category/item/modifier-group document below also gets businessId set (via this
    // .map(), rather than repeating it on each literal) so seeded data matches real
    // post-migration canonical shape directly — see the import-block comment above.
    const withBusinessId = <T extends object>(docs: T[]) => docs.map((doc) => ({ ...doc, businessId: restaurant.businessId }));

    const [pizza, burgers, salad, sides, dessert, drinks] = await Category.insertMany(
      withBusinessId([
        { restaurantId: restaurant._id, name: "Pizza", sortOrder: 0 },
        { restaurantId: restaurant._id, name: "Burgers", sortOrder: 1 },
        { restaurantId: restaurant._id, name: "Salad", sortOrder: 2 },
        { restaurantId: restaurant._id, name: "Sides", sortOrder: 3 },
        { restaurantId: restaurant._id, name: "Dessert", sortOrder: 4 },
        { restaurantId: restaurant._id, name: "Drinks", sortOrder: 5 },
      ])
    );

    const menuItems = await MenuItem.insertMany(withBusinessId([
      {
        restaurantId: restaurant._id,
        categoryId: pizza._id,
        name: "Margherita Pizza",
        description: "Tomato, mozzarella, basil",
        price: 12.5,
        imageUrl: "/menu-images/margherita-pizza.svg",
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: pizza._id,
        name: "Pepperoni Pizza",
        description: "Tomato, mozzarella, pepperoni",
        price: 14,
        imageUrl: "/menu-images/pepperoni-pizza.svg",
        sortOrder: 1,
      },
      {
        restaurantId: restaurant._id,
        categoryId: pizza._id,
        name: "BBQ Chicken Pizza",
        description: "BBQ sauce, grilled chicken, red onion, mozzarella",
        price: 15.5,
        imageUrl: "/menu-images/bbq-chicken-pizza.svg",
        sortOrder: 2,
      },
      {
        restaurantId: restaurant._id,
        categoryId: burgers._id,
        name: "Classic Burger",
        description: "Beef patty, cheddar, lettuce, tomato, house sauce",
        price: 10.5,
        imageUrl: "/menu-images/classic-burger.svg",
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: burgers._id,
        name: "Crispy Chicken Burger",
        description: "Buttermilk-fried chicken, pickles, slaw, spicy mayo",
        price: 11,
        imageUrl: "/menu-images/crispy-chicken-burger.svg",
        sortOrder: 1,
      },
      {
        restaurantId: restaurant._id,
        categoryId: salad._id,
        name: "Caesar Salad",
        description: "Romaine, parmesan, croutons",
        price: 8.5,
        imageUrl: "/menu-images/caesar-salad.svg",
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: sides._id,
        name: "Loaded Fries",
        description: "Crispy fries, cheese sauce, bacon bits, scallions",
        price: 7,
        imageUrl: "/menu-images/loaded-fries.svg",
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: dessert._id,
        name: "Tiramisu",
        description: "Classic Italian dessert",
        price: 6,
        imageUrl: "/menu-images/tiramisu.svg",
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: dessert._id,
        name: "Chocolate Cake",
        description: "Rich layered chocolate cake, chocolate ganache",
        price: 6.5,
        imageUrl: "/menu-images/chocolate-cake.svg",
        sortOrder: 1,
      },
      {
        restaurantId: restaurant._id,
        categoryId: drinks._id,
        name: "Coke",
        description: "330ml can",
        price: 2,
        imageUrl: "/menu-images/coke.svg",
        sortOrder: 0,
      },
    ]));

    const margherita = menuItems.find((i) => i.name === "Margherita Pizza")!;
    const pepperoni = menuItems.find((i) => i.name === "Pepperoni Pizza")!;
    const classicBurger = menuItems.find((i) => i.name === "Classic Burger")!;
    const coke = menuItems.find((i) => i.name === "Coke")!;

    await ModifierGroup.insertMany(withBusinessId([
      {
        restaurantId: restaurant._id,
        menuItemId: margherita._id,
        name: "Size",
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 0,
        options: [
          { name: "Small", priceAdjustment: 0, sortOrder: 0 },
          { name: "Medium", priceAdjustment: 2, sortOrder: 1 },
          { name: "Large", priceAdjustment: 4, sortOrder: 2 },
        ],
      },
      {
        restaurantId: restaurant._id,
        menuItemId: margherita._id,
        name: "Extra toppings",
        minSelect: 0,
        maxSelect: 3,
        sortOrder: 1,
        options: [
          { name: "Extra cheese", priceAdjustment: 1.5, sortOrder: 0 },
          { name: "Mushrooms", priceAdjustment: 1, sortOrder: 1 },
          { name: "Olives", priceAdjustment: 1, sortOrder: 2 },
        ],
      },
      {
        restaurantId: restaurant._id,
        menuItemId: pepperoni._id,
        name: "Size",
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 0,
        options: [
          { name: "Small", priceAdjustment: 0, sortOrder: 0 },
          { name: "Medium", priceAdjustment: 2, sortOrder: 1 },
          { name: "Large", priceAdjustment: 4, sortOrder: 2 },
        ],
      },
      {
        restaurantId: restaurant._id,
        menuItemId: classicBurger._id,
        name: "Add-ons",
        minSelect: 0,
        maxSelect: 3,
        sortOrder: 0,
        options: [
          { name: "Extra patty", priceAdjustment: 3, sortOrder: 0 },
          { name: "Extra cheese", priceAdjustment: 1, sortOrder: 1 },
          { name: "Bacon", priceAdjustment: 2, sortOrder: 2 },
        ],
      },
      {
        restaurantId: restaurant._id,
        menuItemId: coke._id,
        name: "Size",
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 0,
        options: [
          { name: "Regular", priceAdjustment: 0, sortOrder: 0 },
          { name: "Large", priceAdjustment: 1, sortOrder: 1 },
        ],
      },
    ]));

    console.log("[seed] inserted categories, menu items, and modifier groups for demo-restaurant");
  }

  await mongoose.disconnect();
  console.log("[seed] done");
}

seed().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

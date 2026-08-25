/**
 * Run after `npm run seed` (which only creates the restaurant/users/menu skeleton) to fill in
 * realistic demo content: menu item images, order history, loyalty activity, a knowledge base,
 * and support tickets — everything a fresh install needs to look like a real operating
 * restaurant rather than an empty shell. Every section is idempotent (guarded by a count check),
 * so re-running this is always safe.
 */
import bcrypt from "bcryptjs";
import mongoose, { Types } from "mongoose";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Table } from "../models/Table.js";
import { KnowledgeBaseCategory, KnowledgeBaseArticle } from "../models/KnowledgeBase.js";
import { SupportTicket, SupportMessage } from "../models/SupportTicket.js";
import { nextOrderNumber } from "../services/orderNumber.service.js";
import { nextTicketNumber } from "../services/ticketNumber.service.js";
import { earnPoints } from "../services/loyalty.service.js";
import { generateTableToken } from "../services/tableToken.service.js";
import { haversineDistanceKm } from "../services/delivery.service.js";

// Jordan Lee's saved "Home" address (set up below, well within demo-restaurant's 8km radius) —
// reused here as the delivery address on historical demo orders so Order.deliveryAddress is a
// real, valid structured snapshot (required latitude/longitude) rather than the placeholder
// string this seed used before Phase 9 introduced the structured address/distance snapshot.
const DEMO_DELIVERY_ADDRESS = {
  line1: "1200 S 6th St",
  city: "Springfield",
  state: "IL",
  postalCode: "62703",
  country: "USA",
  latitude: 39.7658,
  longitude: -89.6501,
};

const IMAGE_BY_NAME: Record<string, string> = {
  "Margherita Pizza": "/menu-images/margherita-pizza.svg",
  "Pepperoni Pizza": "/menu-images/pepperoni-pizza.svg",
  "BBQ Chicken Pizza": "/menu-images/bbq-chicken-pizza.svg",
  "Classic Burger": "/menu-images/classic-burger.svg",
  "Crispy Chicken Burger": "/menu-images/crispy-chicken-burger.svg",
  "Caesar Salad": "/menu-images/caesar-salad.svg",
  "Loaded Fries": "/menu-images/loaded-fries.svg",
  Tiramisu: "/menu-images/tiramisu.svg",
  "Chocolate Cake": "/menu-images/chocolate-cake.svg",
  Coke: "/menu-images/coke.svg",
};

function daysAgo(n: number, hour = 18): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 30, 0, 0);
  return d;
}

/** A real, permanent demo fixture (not test-run debris) — lets anyone log in as a restaurant_staff
 *  user to see the deliberately-narrower admin experience that role gets (see Layout.tsx/App.tsx's
 *  role-filtered nav and routes), without an owner having to manually invite one first. */
async function ensureStaffMember(
  restaurantId: mongoose.Types.ObjectId,
  name: string,
  email: string,
  role: string,
  businessId?: mongoose.Types.ObjectId
) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash("Staff123!", 12),
      role,
      restaurantId,
      // Phase 18's Business/Location model needs this too — BusinessContext (apps/admin) resolves
      // activeBusinessId from here for every restaurant-scoped role, same gap seed.ts's owner
      // creation had (see that file's own fix comment) — this was never previously set here.
      businessId,
      // restaurant_staff/kitchen_staff are scoped by explicit locationIds, not implicit
      // business-wide access (see business.controller.ts's listBusinessLocations) — without this,
      // that endpoint returns zero locations for them, LocationContext resolves activeLocationId to
      // null, and every restaurantId-scoped page request 404s/403s. Never previously set here.
      locationIds: [restaurantId],
      isActive: true,
    });
    console.log(`[backfill] created ${role}: ${email}`);
  }
  return user;
}

async function ensureCustomer(name: string, email: string) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({ name, email, passwordHash: await bcrypt.hash("Customer123!", 12), role: "customer" });
    console.log(`[backfill] created customer: ${email}`);
  }
  return user;
}

async function main() {
  await connectDB();

  const restaurant = await Restaurant.findOne({ slug: "demo-restaurant" });
  if (!restaurant) {
    console.log("[backfill] no demo-restaurant found, nothing to do");
    await mongoose.disconnect();
    return;
  }
  const restaurantId = restaurant._id;

  // --- 1. Backfill food images on existing menu items ---
  const items = await MenuItem.find({ restaurantId });
  for (const item of items) {
    const url = IMAGE_BY_NAME[item.name];
    if (url && item.imageUrl !== url) {
      item.imageUrl = url;
      await item.save();
    }
  }
  console.log(`[backfill] set images on ${items.filter((i) => IMAGE_BY_NAME[i.name]).length} menu items`);

  // --- 1b. Backfill add-on/size modifier groups on items that don't have any yet ---
  // (seed.ts only creates the Size/toppings groups on the two pizzas; this backfills the burger
  // and drink examples referenced in the product spec without touching restaurants that already
  // have their own custom groups on these items.)
  // Phase 21 — if this restaurant's own menu is already canonical (businessId set on its
  // MenuItem docs, matching real post-migration shape — see seed.ts), any modifier group
  // backfilled here for one of its items must carry the same businessId. Omitting it would make
  // the group invisible to the canonical read/pricing path (which fetches
  // ModifierGroup.find({businessId, menuItemId})) even though its parent item resolves fine —
  // a real, easy-to-miss inconsistency, not just cosmetic staleness.
  const modifierGroupBusinessId = restaurant.businessId ? { businessId: restaurant.businessId } : {};

  const classicBurger = items.find((i) => i.name === "Classic Burger");
  if (classicBurger && (await ModifierGroup.countDocuments({ menuItemId: classicBurger._id })) === 0) {
    await ModifierGroup.create({
      restaurantId,
      ...modifierGroupBusinessId,
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
    });
    console.log("[backfill] added Add-ons modifier group to Classic Burger");
  }
  const coke = items.find((i) => i.name === "Coke");
  if (coke && (await ModifierGroup.countDocuments({ menuItemId: coke._id })) === 0) {
    await ModifierGroup.create({
      restaurantId,
      ...modifierGroupBusinessId,
      menuItemId: coke._id,
      name: "Size",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      options: [
        { name: "Regular", priceAdjustment: 0, sortOrder: 0 },
        { name: "Large", priceAdjustment: 1, sortOrder: 1 },
      ],
    });
    console.log("[backfill] added Size modifier group to Coke");
  }

  // --- 1c. Dine-in tables + enable dine-in ordering (backfilled here, not just seed.ts, so
  // restaurants seeded before Phase 7 also get demo tables on a re-run) ---
  if (!restaurant.settings.dineInEnabled) {
    restaurant.settings.dineInEnabled = true;
    await restaurant.save();
    console.log("[backfill] enabled dine-in ordering for demo-restaurant");
  }
  const tableCount = await Table.countDocuments({ restaurantId });
  if (tableCount === 0) {
    await Table.insertMany([
      { restaurantId, name: "Table 1", capacity: 2, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId, name: "Table 2", capacity: 2, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId, name: "Table 3", capacity: 4, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId, name: "Table 4", capacity: 4, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId, name: "Patio 1", capacity: 6, section: "Patio", qrToken: generateTableToken() },
      { restaurantId, name: "Bar 1", capacity: 2, section: "Bar", qrToken: generateTableToken() },
    ]);
    console.log("[backfill] seeded 6 demo tables for demo-restaurant");
  } else {
    console.log("[backfill] tables already exist, skipping");
  }

  // --- 1d. Delivery location + radius (backfilled here so a restaurant seeded before Phase 9
  // also gets a real delivery configuration on a re-run — same reasoning as 1c above). ---
  if (restaurant.latitude == null || restaurant.longitude == null || !restaurant.settings.deliveryRadiusKm) {
    restaurant.latitude = 39.7817;
    restaurant.longitude = -89.6501;
    restaurant.settings.deliveryRadiusKm = 8;
    await restaurant.save();
    console.log("[backfill] set demo-restaurant's location and delivery radius");
  }

  // --- 1d-2. Payment methods (Phase 15) — backfilled here so a restaurant seeded before this
  // phase still demos online payment out of the box; onlinePaymentEnabled defaults to false for
  // brand-new restaurants (a deliberate opt-in), but the demo restaurant is meant to be a
  // fully-configured reference, so it explicitly turns both on. ---
  if (!restaurant.settings.cashEnabled || !restaurant.settings.onlinePaymentEnabled) {
    restaurant.settings.cashEnabled = true;
    restaurant.settings.onlinePaymentEnabled = true;
    await restaurant.save();
    console.log("[backfill] enabled cash + online payment for demo-restaurant");
  }

  // --- 1e. Demo staff accounts — one per non-owner role, so the role-restricted admin
  // experience (Layout.tsx/App.tsx's role-filtered nav/routes) is directly demoable/testable
  // without an owner having to invite one first. ---
  await ensureStaffMember(restaurantId, "Sam Rivera", "manager@demo-restaurant.local", "restaurant_manager", restaurant.businessId);
  await ensureStaffMember(restaurantId, "Alex Chen", "staff@demo-restaurant.local", "restaurant_staff", restaurant.businessId);
  await ensureStaffMember(restaurantId, "Jamie Park", "kitchen@demo-restaurant.local", "kitchen_staff", restaurant.businessId);

  // --- 2. Demo customers ---
  const jordan = await ensureCustomer("Jordan Lee", "jordan.lee@example.com");
  const priya = await ensureCustomer("Priya Patel", "priya.patel@example.com");

  // A saved address with real coordinates ~2km from demo-restaurant (well within its 8km
  // delivery radius) — so the delivery flow has a ready-to-use "inside the delivery area"
  // address to demo/test with, without anyone needing to hand-enter coordinates first.
  if (jordan.addresses.length === 0) {
    jordan.addresses.push({
      _id: new Types.ObjectId(),
      label: "Home",
      line1: "1200 S 6th St",
      city: "Springfield",
      state: "IL",
      postalCode: "62703",
      country: "USA",
      latitude: 39.7658,
      longitude: -89.6501,
      isDefault: true,
    });
    await jordan.save();
    console.log("[backfill] gave Jordan Lee a saved delivery address near demo-restaurant");
  }

  // Priya deliberately gets a LEGACY address with no coordinates — a realistic demo of the
  // Phase 10 "search to add a location to an existing address" flow (AccountPage's "No
  // coordinates — set location for delivery" prompt), rather than every seeded address already
  // being geocoded.
  if (priya.addresses.length === 0) {
    priya.addresses.push({
      _id: new Types.ObjectId(),
      label: "Home",
      line1: "482 Maple Street",
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
      country: "USA",
      isDefault: true,
    });
    await priya.save();
    console.log("[backfill] gave Priya Patel a legacy saved address with no coordinates yet");
  }

  // --- 3. Realistic order history (only if this restaurant has no orders yet, so re-running is safe) ---
  const existingOrderCount = await Order.countDocuments({ restaurantId });
  if (existingOrderCount === 0) {
    const byName = (name: string) => items.find((i) => i.name === name)!;
    const margherita = byName("Margherita Pizza");
    const pepperoni = byName("Pepperoni Pizza");
    const bbqChicken = byName("BBQ Chicken Pizza");
    const classicBurger = byName("Classic Burger");
    const crispyChicken = byName("Crispy Chicken Burger");
    const caesarSalad = byName("Caesar Salad");
    const loadedFries = byName("Loaded Fries");
    const chocolateCake = byName("Chocolate Cake");
    const coke = byName("Coke");

    const margheritaSize = await ModifierGroup.findOne({ menuItemId: margherita._id, name: "Size" });
    const pepperoniSize = await ModifierGroup.findOne({ menuItemId: pepperoni._id, name: "Size" });

    function sizeModifier(group: typeof margheritaSize, optionName: string) {
      if (!group) return [];
      const option = group.options.find((o) => o.name === optionName);
      if (!option) return [];
      return [
        {
          groupId: group._id,
          groupName: group.name,
          optionId: option._id,
          optionName: option.name,
          priceAdjustment: option.priceAdjustment,
        },
      ];
    }

    const session = await mongoose.startSession();

    interface OrderPlan {
      customer: typeof jordan;
      when: Date;
      orderType: "pickup" | "delivery";
      status: "completed" | "preparing";
      lines: Array<{ item: typeof margherita; qty: number; modifiers: ReturnType<typeof sizeModifier> }>;
    }

    const plans: OrderPlan[] = [
      {
        customer: jordan,
        when: daysAgo(6),
        orderType: "pickup",
        status: "completed",
        lines: [{ item: margherita, qty: 1, modifiers: sizeModifier(margheritaSize, "Medium") }],
      },
      {
        customer: jordan,
        when: daysAgo(4),
        orderType: "delivery",
        status: "completed",
        lines: [
          { item: classicBurger, qty: 2, modifiers: [] },
          { item: coke, qty: 1, modifiers: [] },
        ],
      },
      {
        customer: jordan,
        when: daysAgo(2),
        orderType: "pickup",
        status: "completed",
        lines: [
          { item: caesarSalad, qty: 1, modifiers: [] },
          { item: loadedFries, qty: 1, modifiers: [] },
        ],
      },
      {
        customer: jordan,
        when: daysAgo(0, 12),
        orderType: "pickup",
        status: "preparing",
        lines: [{ item: bbqChicken, qty: 1, modifiers: [] }],
      },
      {
        customer: priya,
        when: daysAgo(5),
        orderType: "delivery",
        status: "completed",
        lines: [
          { item: crispyChicken, qty: 1, modifiers: [] },
          { item: chocolateCake, qty: 1, modifiers: [] },
        ],
      },
      {
        customer: priya,
        when: daysAgo(1),
        orderType: "pickup",
        status: "completed",
        lines: [{ item: pepperoni, qty: 2, modifiers: sizeModifier(pepperoniSize, "Small") }],
      },
    ];

    for (const plan of plans) {
      const orderItems = plan.lines.map((line) => {
        const modifierTotal = line.modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
        const unitPrice = line.item.price + modifierTotal;
        return {
          menuItemId: line.item._id,
          name: line.item.name,
          unitPrice,
          quantity: line.qty,
          selectedModifiers: line.modifiers,
          lineTotal: unitPrice * line.qty,
        };
      });
      const subtotal = orderItems.reduce((sum, i) => sum + i.lineTotal, 0);
      const taxAmount = Math.round(subtotal * restaurant.settings.taxRate * 100) / 100;
      const deliveryFee = plan.orderType === "delivery" ? restaurant.settings.deliveryFee : 0;
      const total = Math.round((subtotal + taxAmount + deliveryFee) * 100) / 100;
      const isCompleted = plan.status === "completed";

      const orderNumber = await nextOrderNumber(restaurantId, session);
      const statusHistory = isCompleted
        ? [
            { status: "pending" as const, at: plan.when },
            { status: "confirmed" as const, at: new Date(plan.when.getTime() + 3 * 60000) },
            { status: "preparing" as const, at: new Date(plan.when.getTime() + 8 * 60000) },
            { status: "ready" as const, at: new Date(plan.when.getTime() + 20 * 60000) },
            { status: "completed" as const, at: new Date(plan.when.getTime() + 35 * 60000) },
          ]
        : [
            { status: "pending" as const, at: plan.when },
            { status: "confirmed" as const, at: new Date(plan.when.getTime() + 3 * 60000) },
            { status: "preparing" as const, at: new Date(plan.when.getTime() + 8 * 60000) },
          ];

      const order = await Order.create({
        restaurantId,
        customerId: plan.customer._id,
        orderNumber,
        items: orderItems,
        status: plan.status,
        statusHistory,
        orderType: plan.orderType,
        paymentStatus: isCompleted ? "paid" : "unpaid",
        subtotal,
        taxAmount,
        deliveryFee,
        discount: 0,
        total,
        deliveryAddress: plan.orderType === "delivery" ? DEMO_DELIVERY_ADDRESS : undefined,
        // Rounded to 2 decimal places, matching checkDeliveryEligibility's own rounding — this is
        // a customer-facing display value (see OrderDetailPage), not raw floating-point distance.
        deliveryDistanceKm:
          plan.orderType === "delivery"
            ? Math.round(
                haversineDistanceKm(restaurant.latitude!, restaurant.longitude!, DEMO_DELIVERY_ADDRESS.latitude, DEMO_DELIVERY_ADDRESS.longitude) * 100
              ) / 100
            : undefined,
        createdAt: plan.when,
      });
      // Backdate createdAt/updatedAt explicitly since Mongoose timestamps default to "now" on create.
      await Order.updateOne({ _id: order._id }, { $set: { createdAt: plan.when, updatedAt: plan.when } });

      if (isCompleted) {
        const earned = await earnPoints(restaurantId.toString(), plan.customer._id.toString(), order.id, subtotal);
        await Order.updateOne({ _id: order._id }, { $set: { loyaltyPointsEarned: earned } });
      }
      console.log(`[backfill] created order ${orderNumber} for ${plan.customer.name}`);
    }
    await session.endSession();
  } else {
    console.log("[backfill] orders already exist, skipping order history seed");
  }

  // --- 4. Knowledge base ---
  const kbCategoryCount = await KnowledgeBaseCategory.countDocuments();
  if (kbCategoryCount === 0) {
    const platformAdmin = await User.findOne({ email: "platform-admin@restaurant.local" });
    const [ordering, account, payments] = await KnowledgeBaseCategory.insertMany([
      { name: "Ordering & Delivery", slug: "ordering-delivery", sortOrder: 0 },
      { name: "Account & Loyalty", slug: "account-loyalty", sortOrder: 1 },
      { name: "Payments & Receipts", slug: "payments-receipts", sortOrder: 2 },
    ]);

    await KnowledgeBaseArticle.insertMany([
      {
        categoryId: ordering._id,
        title: "How do I place an order?",
        slug: "how-do-i-place-an-order",
        summary: "Browse the menu, add items to your cart, choose pickup or delivery, and check out.",
        content:
          "Browse the restaurant's menu and tap any item to see its description, price, and available options. Choose your modifiers if the item has any, then add it to your cart. When you're ready, open your cart, pick pickup or delivery, add any delivery details, and place your order. You'll be able to track its status from your Orders page.",
        status: "published",
        sortOrder: 0,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: ordering._id,
        title: "What's the difference between pickup and delivery?",
        slug: "pickup-vs-delivery",
        summary: "Pickup means collecting your order in person; delivery brings it to your address for a fee.",
        content:
          "Pickup orders are prepared for you to collect at the restaurant, with no delivery fee. Delivery orders are brought to an address you provide, and may include a delivery fee and a minimum order amount depending on the restaurant's settings. You can see which options are available on the restaurant's menu page before you order.",
        status: "published",
        sortOrder: 1,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: ordering._id,
        title: "Can I change or cancel my order after placing it?",
        slug: "change-or-cancel-order",
        summary: "You can cancel an order yourself while it's still pending, from your Orders page.",
        content:
          "If your order hasn't been accepted by the restaurant yet, you can cancel it from the order's detail page. Once the restaurant has started preparing your order, changes need to go through the restaurant directly — you can reach them through a support ticket and we'll help coordinate.",
        status: "published",
        sortOrder: 2,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: account._id,
        title: "How do loyalty points work?",
        slug: "how-loyalty-points-work",
        summary: "Earn points on every completed order and see your balance grow toward higher tiers.",
        content:
          "Every completed, paid order earns you loyalty points based on your order subtotal. Points accumulate in your account and move you up through Bronze, Silver, and Gold tiers. You can see your current balance, tier, and full points history any time on the Loyalty page.",
        status: "published",
        sortOrder: 0,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: account._id,
        title: "How do I update my saved addresses?",
        slug: "update-saved-addresses",
        summary: "Manage your delivery addresses from your account page for faster checkout.",
        content:
          "Saved addresses let you skip retyping your delivery details every time you order. Add, edit, or remove addresses from your Account page, and set one as your default so it's pre-selected at checkout.",
        status: "published",
        sortOrder: 1,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: payments._id,
        title: "What payment methods do you accept?",
        slug: "payment-methods",
        summary: "Payment is currently handled directly with the restaurant at pickup or delivery.",
        content:
          "This platform doesn't process online payments directly today — orders are marked paid by restaurant staff once payment is settled at pickup or on delivery. Your order confirmation will always show the current payment status.",
        status: "published",
        sortOrder: 0,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
      {
        categoryId: payments._id,
        title: "Where can I find my receipt?",
        slug: "find-my-receipt",
        summary: "Every order's detail page shows a full breakdown of items, fees, and totals.",
        content:
          "Open any order from your Orders page to see a full itemized breakdown, including subtotal, tax, delivery fee, any discount applied, and the final total — everything you'd need for a receipt.",
        status: "published",
        sortOrder: 1,
        authorId: platformAdmin?._id,
        publishedAt: new Date(),
      },
    ]);
    console.log("[backfill] seeded knowledge base categories and articles");
  } else {
    console.log("[backfill] knowledge base already has content, skipping");
  }

  // --- 5. Support tickets ---
  const ticketCount = await SupportTicket.countDocuments();
  if (ticketCount === 0) {
    const platformAdminUser = await User.findOne({ email: "platform-admin@restaurant.local" });
    if (platformAdminUser) {
      const platformAdmin = platformAdminUser;
      async function seedTicket(opts: {
        subject: string;
        description: string;
        category: "orders" | "billing" | "other";
        priority: "low" | "normal" | "high";
        createdBy: Types.ObjectId;
        status: "open" | "in_progress" | "resolved" | "closed";
        exchange: Array<{ from: "customer" | "support"; text: string }>;
      }) {
        const ticketNumber = await nextTicketNumber();
        const t0 = daysAgo(3);
        const statusHistory =
          opts.status === "open"
            ? [{ status: "open" as const, at: t0 }]
            : opts.status === "in_progress"
              ? [
                  { status: "open" as const, at: t0 },
                  { status: "in_progress" as const, at: new Date(t0.getTime() + 3600000) },
                ]
              : opts.status === "resolved"
                ? [
                    { status: "open" as const, at: t0 },
                    { status: "in_progress" as const, at: new Date(t0.getTime() + 3600000) },
                    { status: "resolved" as const, at: new Date(t0.getTime() + 7200000) },
                  ]
                : [
                    { status: "open" as const, at: t0 },
                    { status: "in_progress" as const, at: new Date(t0.getTime() + 3600000) },
                    { status: "resolved" as const, at: new Date(t0.getTime() + 7200000) },
                    { status: "closed" as const, at: new Date(t0.getTime() + 86400000) },
                  ];

        const ticket = await SupportTicket.create({
          ticketNumber,
          subject: opts.subject,
          description: opts.description,
          status: opts.status,
          priority: opts.priority,
          category: opts.category,
          source: "help_widget",
          createdBy: opts.createdBy,
          restaurantId,
          assignedTo: opts.status === "open" ? undefined : platformAdmin._id,
          statusHistory,
          resolvedAt: opts.status === "resolved" || opts.status === "closed" ? statusHistory.at(-1)?.at : undefined,
          closedAt: opts.status === "closed" ? statusHistory.at(-1)?.at : undefined,
        });
        await SupportTicket.updateOne({ _id: ticket._id }, { $set: { createdAt: t0, updatedAt: statusHistory.at(-1)!.at } });

        let t = t0.getTime();
        for (const msg of opts.exchange) {
          t += 15 * 60000;
          await SupportMessage.create({
            ticketId: ticket._id,
            authorId: msg.from === "customer" ? opts.createdBy : platformAdmin._id,
            authorType: msg.from,
            content: msg.text,
            createdAt: new Date(t),
          });
        }
        console.log(`[backfill] created ticket ${ticketNumber} (${opts.status})`);
      }

      await seedTicket({
        subject: "Order arrived missing an item",
        description: "My last order was missing the fries I ordered as a side. Everything else arrived fine.",
        category: "orders",
        priority: "normal",
        status: "resolved",
        createdBy: jordan._id,
        exchange: [
          { from: "customer", text: "My last order was missing the fries I ordered as a side. Everything else arrived fine." },
          {
            from: "support",
            text: "Sorry about that! I've flagged this with the restaurant so it doesn't happen again, and I've added loyalty points to make up for the missing item. Let us know if there's anything else.",
          },
        ],
      });

      await seedTicket({
        subject: "Question about delivery radius",
        description: "Do you deliver to addresses just outside Springfield city limits?",
        category: "other",
        priority: "low",
        status: "closed",
        createdBy: priya._id,
        exchange: [
          { from: "customer", text: "Do you deliver to addresses just outside Springfield city limits?" },
          {
            from: "support",
            text: "Right now delivery is available within Springfield city limits only. We're hoping to expand that range soon!",
          },
          { from: "customer", text: "Good to know, thank you!" },
        ],
      });

      await seedTicket({
        subject: "Payment shows as unpaid after pickup",
        description: "I picked up and paid for my order in person, but it still shows as unpaid in my order history.",
        category: "billing",
        priority: "high",
        status: "in_progress",
        createdBy: jordan._id,
        exchange: [
          {
            from: "customer",
            text: "I picked up and paid for my order in person, but it still shows as unpaid in my order history.",
          },
          {
            from: "support",
            text: "Thanks for flagging this — payment status is updated by restaurant staff after pickup, so this can lag a few minutes. I'm checking with the restaurant now and will update you shortly.",
          },
        ],
      });
    }
  } else {
    console.log("[backfill] support tickets already exist, skipping");
  }

  // --- 6. A couple more demo restaurants, so the platform admin's Restaurants/Users lists (and
  // Platform dashboard counts) show a real multi-tenant picture instead of a single degenerate row.
  await ensureSecondaryRestaurant({
    slug: "spice-route",
    name: "Spice Route",
    description: "Modern Indian small plates and curries, made to order.",
    city: "Austin",
    state: "TX",
    country: "USA",
    ownerName: "Amara Osei",
    ownerEmail: "amara@spice-route.local",
    categoryName: "Mains",
    brandColor: "#B91C1C",
    latitude: 30.2672,
    longitude: -97.7431,
    deliveryRadiusKm: 6,
    items: [
      { name: "Butter Chicken", description: "Tomato-cream curry, tender chicken thigh", price: 13.5 },
      { name: "Paneer Tikka Masala", description: "Grilled paneer in a smoky masala sauce", price: 12 },
      { name: "Lamb Rogan Josh", description: "Slow-braised lamb, Kashmiri chili, yogurt", price: 15.5 },
    ],
  });

  await ensureSecondaryRestaurant({
    slug: "bella-vista",
    name: "Bella Vista Trattoria",
    description: "Family-run Italian trattoria — handmade pasta, wood-fired mains.",
    city: "Boston",
    state: "MA",
    country: "USA",
    ownerName: "Marco Rossi",
    ownerEmail: "marco@bella-vista.local",
    categoryName: "Pasta",
    brandColor: "#15803D",
    latitude: 42.3601,
    longitude: -71.0589,
    deliveryRadiusKm: 5,
    items: [
      { name: "Spaghetti Carbonara", description: "Guanciale, egg, pecorino, black pepper", price: 14 },
      { name: "Lasagna alla Bolognese", description: "Layered pasta, slow-cooked beef ragu", price: 15 },
      { name: "Risotto ai Funghi", description: "Arborio rice, wild mushrooms, parmesan", price: 13 },
    ],
  });

  console.log("[backfill] done");
  await mongoose.disconnect();
}

interface SecondaryRestaurantSpec {
  slug: string;
  name: string;
  description: string;
  city: string;
  state: string;
  country: string;
  ownerName: string;
  ownerEmail: string;
  categoryName: string;
  /** Purely presentational — see Restaurant.settings.brandColor — used here so the two secondary
   *  demo restaurants are visibly distinct from each other and from the primary demo-restaurant
   *  when proving out Phase 8's multi-tenant storefront (Part 19: different branding per tenant). */
  brandColor: string;
  /** Real coordinates for the restaurant's own city — the delivery-radius reference point. */
  latitude: number;
  longitude: number;
  deliveryRadiusKm: number;
  items: { name: string; description: string; price: number }[];
}

async function ensureSecondaryRestaurant(spec: SecondaryRestaurantSpec) {
  // Each step below is independently guarded (rather than one early return for the whole
  // function) so a run that crashed partway through — e.g. mid-order-creation, as actually
  // happened once during development — resumes and finishes on the next run instead of being
  // permanently stuck half-seeded just because the top-level Restaurant document already exists.
  let restaurant = await Restaurant.findOne({ slug: spec.slug });
  let menuItems: Awaited<ReturnType<typeof MenuItem.insertMany>>;

  if (restaurant) {
    menuItems = await MenuItem.find({ restaurantId: restaurant._id }).sort({ sortOrder: 1 });
  } else {
    let owner = await User.findOne({ email: spec.ownerEmail });
    if (!owner) {
      owner = await User.create({
        name: spec.ownerName,
        email: spec.ownerEmail,
        passwordHash: await bcrypt.hash("Owner123!", 12),
        role: "customer",
      });
    }

    // Phase 21 — each fresh secondary demo restaurant is its own single-location Business,
    // created with a canonical (businessId-scoped) menu directly, matching real post-migration
    // shape — same reasoning as seed.ts's primary demo-restaurant.
    const business = await Business.create({ name: spec.name, slug: spec.slug, ownerId: owner._id, status: "active" });

    restaurant = await Restaurant.create({
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      city: spec.city,
      state: spec.state,
      country: spec.country,
      ownerId: owner._id,
      businessId: business._id,
      status: "active",
    });
    owner.role = "restaurant_owner";
    owner.restaurantId = restaurant._id;
    owner.businessId = business._id;
    await owner.save();

    const category = await Category.create({
      restaurantId: restaurant._id,
      businessId: business._id,
      name: spec.categoryName,
      sortOrder: 0,
    });
    menuItems = await MenuItem.insertMany(
      spec.items.map((item, i) => ({
        restaurantId: restaurant!._id,
        businessId: business._id,
        categoryId: category._id,
        name: item.name,
        description: item.description,
        price: item.price,
        sortOrder: i,
      }))
    );
  }

  // Dine-in + tables + branding + delivery location/radius — independently guarded (not inside
  // the `existingOrders` early return below) so a restaurant that already has orders from an
  // earlier run still gets these backfilled on a re-run, same reasoning as every other step here.
  if (
    !restaurant.settings.dineInEnabled ||
    restaurant.settings.brandColor !== spec.brandColor ||
    restaurant.latitude == null ||
    restaurant.settings.deliveryRadiusKm !== spec.deliveryRadiusKm
  ) {
    restaurant.settings.dineInEnabled = true;
    restaurant.settings.brandColor = spec.brandColor;
    restaurant.latitude = spec.latitude;
    restaurant.longitude = spec.longitude;
    restaurant.settings.deliveryEnabled = true;
    restaurant.settings.deliveryRadiusKm = spec.deliveryRadiusKm;
    await restaurant.save();
    console.log(`[backfill] enabled dine-in, delivery, brand color, and location for ${spec.slug}`);
  }
  const tableCount = await Table.countDocuments({ restaurantId: restaurant._id });
  if (tableCount === 0) {
    await Table.insertMany([
      { restaurantId: restaurant._id, name: "Table 1", capacity: 2, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId: restaurant._id, name: "Table 2", capacity: 4, section: "Main dining", qrToken: generateTableToken() },
      { restaurantId: restaurant._id, name: "Table 3", capacity: 4, section: "Main dining", qrToken: generateTableToken() },
    ]);
    console.log(`[backfill] seeded 3 demo tables for ${spec.slug}`);
  } else {
    console.log(`[backfill] ${spec.slug} already has tables, skipping`);
  }

  const existingOrders = await Order.countDocuments({ restaurantId: restaurant._id });
  if (existingOrders > 0) {
    console.log(`[backfill] ${spec.slug} already has orders, skipping`);
    return;
  }

  // A couple of realistic orders so this restaurant isn't a zero-activity row on the platform's
  // Restaurants list — same nextOrderNumber/session pattern the primary restaurant's orders use.
  const customer = await ensureCustomer("Riley Chen", "riley.chen@example.com");
  const session = await mongoose.startSession();
  const orderPlans = [
    { item: menuItems[0], qty: 2, when: daysAgo(3) },
    { item: menuItems[1], qty: 1, when: daysAgo(1) },
  ];
  for (const plan of orderPlans) {
    const lineTotal = Math.round(plan.item.price * plan.qty * 100) / 100;
    const taxAmount = Math.round(lineTotal * 0.08 * 100) / 100;
    const total = Math.round((lineTotal + taxAmount) * 100) / 100;
    const orderNumber = await nextOrderNumber(restaurant._id, session);
    const order = await Order.create({
      restaurantId: restaurant._id,
      customerId: customer._id,
      orderNumber,
      items: [
        {
          menuItemId: plan.item._id,
          name: plan.item.name,
          unitPrice: plan.item.price,
          quantity: plan.qty,
          selectedModifiers: [],
          lineTotal,
        },
      ],
      status: "completed",
      statusHistory: [{ status: "pending", at: plan.when }, { status: "completed", at: plan.when }],
      orderType: "pickup",
      paymentStatus: "paid",
      subtotal: lineTotal,
      taxAmount,
      deliveryFee: 0,
      discount: 0,
      total,
      createdAt: plan.when,
    });
    await earnPoints(restaurant._id.toString(), customer._id.toString(), order.id, lineTotal);
  }
  await session.endSession();

  console.log(`[backfill] created secondary restaurant "${spec.slug}" with ${orderPlans.length} orders`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

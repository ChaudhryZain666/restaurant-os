import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";

async function seed() {
  await connectDB();

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
    restaurant = await Restaurant.create({
      name: "Demo Restaurant",
      slug: "demo-restaurant",
      description: "Seed data for local development",
      phone: "+1-555-0100",
      email: "hello@demo-restaurant.local",
      city: "Springfield",
      country: "USA",
      ownerId: owner._id,
      status: "active",
      settings: {
        currency: "USD",
        timezone: "America/Chicago",
        orderingEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        minOrderAmount: 0,
        taxRate: 0.08,
        deliveryFee: 3.99,
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
    await owner.save();
    console.log(`[seed] created restaurant "demo-restaurant" owned by ${ownerEmail} / Owner123!`);
  }

  const categoryCount = await Category.countDocuments({ restaurantId: restaurant._id });
  if (categoryCount === 0) {
    const [pizza, salad, dessert, drinks] = await Category.insertMany([
      { restaurantId: restaurant._id, name: "Pizza", sortOrder: 0 },
      { restaurantId: restaurant._id, name: "Salad", sortOrder: 1 },
      { restaurantId: restaurant._id, name: "Dessert", sortOrder: 2 },
      { restaurantId: restaurant._id, name: "Drinks", sortOrder: 3 },
    ]);

    const [margherita, pepperoni] = await MenuItem.insertMany([
      {
        restaurantId: restaurant._id,
        categoryId: pizza._id,
        name: "Margherita Pizza",
        description: "Tomato, mozzarella, basil",
        price: 12.5,
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: pizza._id,
        name: "Pepperoni Pizza",
        description: "Tomato, mozzarella, pepperoni",
        price: 14,
        sortOrder: 1,
      },
      {
        restaurantId: restaurant._id,
        categoryId: salad._id,
        name: "Caesar Salad",
        description: "Romaine, parmesan, croutons",
        price: 8.5,
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: dessert._id,
        name: "Tiramisu",
        description: "Classic Italian dessert",
        price: 6,
        sortOrder: 0,
      },
      {
        restaurantId: restaurant._id,
        categoryId: drinks._id,
        name: "Coke",
        description: "330ml can",
        price: 2,
        sortOrder: 0,
      },
    ]);

    await ModifierGroup.insertMany([
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
    ]);

    console.log("[seed] inserted categories, menu items, and modifier groups for demo-restaurant");
  }

  await mongoose.disconnect();
  console.log("[seed] done");
}

seed().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

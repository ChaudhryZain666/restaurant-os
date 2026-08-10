import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { MenuItem } from "../models/MenuItem.js";

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
      ownerId: owner._id,
      status: "active",
    });
    owner.role = "restaurant_owner";
    owner.restaurantId = restaurant._id;
    await owner.save();
    console.log(`[seed] created restaurant "demo-restaurant" owned by ${ownerEmail} / Owner123!`);
  }

  const menuCount = await MenuItem.countDocuments({ restaurantId: restaurant._id });
  if (menuCount === 0) {
    await MenuItem.insertMany([
      {
        restaurantId: restaurant._id,
        name: "Margherita Pizza",
        description: "Tomato, mozzarella, basil",
        price: 12.5,
        category: "Pizza",
      },
      {
        restaurantId: restaurant._id,
        name: "Pepperoni Pizza",
        description: "Tomato, mozzarella, pepperoni",
        price: 14,
        category: "Pizza",
      },
      {
        restaurantId: restaurant._id,
        name: "Caesar Salad",
        description: "Romaine, parmesan, croutons",
        price: 8.5,
        category: "Salad",
      },
      {
        restaurantId: restaurant._id,
        name: "Tiramisu",
        description: "Classic Italian dessert",
        price: 6,
        category: "Dessert",
      },
      { restaurantId: restaurant._id, name: "Coke", description: "330ml can", price: 2, category: "Drinks" },
    ]);
    console.log("[seed] inserted sample menu items for demo-restaurant");
  }

  await mongoose.disconnect();
  console.log("[seed] done");
}

seed().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

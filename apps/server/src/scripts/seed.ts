import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { MenuItem } from "../models/MenuItem.js";
import mongoose from "mongoose";

async function seed() {
  await connectDB();

  const adminEmail = "admin@restaurant.local";
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: "Admin",
      email: adminEmail,
      passwordHash: await bcrypt.hash("Admin123!", 12),
      role: "admin",
    });
    console.log(`[seed] created admin user: ${adminEmail} / Admin123!`);
  }

  const menuCount = await MenuItem.countDocuments();
  if (menuCount === 0) {
    await MenuItem.insertMany([
      { name: "Margherita Pizza", description: "Tomato, mozzarella, basil", price: 12.5, category: "Pizza" },
      { name: "Pepperoni Pizza", description: "Tomato, mozzarella, pepperoni", price: 14, category: "Pizza" },
      { name: "Caesar Salad", description: "Romaine, parmesan, croutons", price: 8.5, category: "Salad" },
      { name: "Tiramisu", description: "Classic Italian dessert", price: 6, category: "Dessert" },
      { name: "Coke", description: "330ml can", price: 2, category: "Drinks" },
    ]);
    console.log("[seed] inserted sample menu items");
  }

  await mongoose.disconnect();
  console.log("[seed] done");
}

seed().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

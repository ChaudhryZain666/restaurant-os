import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { MenuItem } from "../models/MenuItem.js";
import { Category } from "../models/Category.js";
import { DomainMapping } from "../models/DomainMapping.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
} from "../test-utils/fixtures.js";

const app = createApp();
const restaurantIds: string[] = [];

afterAll(async () => {
  await Promise.all([
    MenuItem.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Category.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
  ]);
  await closeTestConnections();
});

beforeAll(async () => {
  await connectDB();
});

describe("GET /sitemap.xml — SEO audit fixes", () => {
  it("includes an active, ordering-enabled restaurant that has at least one available menu item", async () => {
    const restaurant = await createTestRestaurant({ settings: { orderingEnabled: true } });
    const category = await createTestCategory(restaurant._id);
    await createTestMenuItem(restaurant._id, category._id, { isAvailable: true });
    restaurantIds.push(restaurant.id);

    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/r/${restaurant.slug}`);
  });

  it("excludes an active restaurant with zero menu items — a thin page has nothing for a crawler to index", async () => {
    const restaurant = await createTestRestaurant({ settings: { orderingEnabled: true } });
    restaurantIds.push(restaurant.id);

    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`/r/${restaurant.slug}`);
  });

  it("excludes a restaurant whose only menu items are all unavailable", async () => {
    const restaurant = await createTestRestaurant({ settings: { orderingEnabled: true } });
    const category = await createTestCategory(restaurant._id);
    await createTestMenuItem(restaurant._id, category._id, { isAvailable: false });
    restaurantIds.push(restaurant.id);

    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`/r/${restaurant.slug}`);
  });

  it("excludes the seeded demo-restaurant slug even if it has menu items", async () => {
    // Deleted first in case a prior interrupted run left one behind — this literal slug must be
    // unique, unlike every other fixture in this suite (which use createTestRestaurant's own
    // per-call unique() helper).
    await Restaurant.deleteOne({ slug: "demo-restaurant" });
    const restaurant = await createTestRestaurant({ slug: "demo-restaurant", settings: { orderingEnabled: true } });
    const category = await createTestCategory(restaurant._id);
    await createTestMenuItem(restaurant._id, category._id, { isAvailable: true });

    try {
      const res = await request(app).get("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("/r/demo-restaurant<");
    } finally {
      await MenuItem.deleteMany({ restaurantId: restaurant._id });
      await Category.deleteMany({ restaurantId: restaurant._id });
      await Restaurant.deleteOne({ _id: restaurant._id });
    }
  });

  it("Phase 79 SEO fix — uses the active custom domain's hostname instead of the platform /r/:slug URL when one exists", async () => {
    const business = await createTestBusiness();
    const restaurant = await createTestRestaurant({ businessId: business._id, settings: { orderingEnabled: true } });
    const category = await createTestCategory(restaurant._id);
    await createTestMenuItem(restaurant._id, category._id, { isAvailable: true });
    const hostname = `sitemap-custom-${Date.now()}.example.com`;
    await DomainMapping.create({
      hostname,
      businessId: business._id,
      locationId: restaurant._id,
      status: "active",
      verificationToken: "test-token",
    });

    try {
      const res = await request(app).get("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.text).toContain(`<loc>https://${hostname}</loc>`);
      expect(res.text).not.toContain(`/r/${restaurant.slug}<`);
    } finally {
      await DomainMapping.deleteOne({ hostname });
      await MenuItem.deleteMany({ restaurantId: restaurant._id });
      await Category.deleteMany({ restaurantId: restaurant._id });
      await Restaurant.deleteOne({ _id: restaurant._id });
      await business.deleteOne();
    }
  });
});

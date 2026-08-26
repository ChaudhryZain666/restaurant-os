import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { AuditLog } from "../models/AuditLog.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let staffAToken: string;
let ownerBToken: string;

const cleanupRestaurantIds: mongoose.Types.ObjectId[] = [];

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  cleanupRestaurantIds.push(restaurantA._id, restaurantB._id);

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  await Promise.all([
    ModifierGroup.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    MenuItem.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    Category.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    AuditLog.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    User.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: cleanupRestaurantIds } }),
  ]);
  await closeTestConnections();
});

function csv(rows: string[]): Buffer {
  return Buffer.from(rows.join("\n"), "utf-8");
}

const BASIC_HEADER = "category,item_name,description,price,available,sort_order";

async function xlsxBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Menu");
  rows.forEach((row) => sheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

describe("POST /restaurants/:restaurantId/menu/import/preview", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .attach("file", csv([BASIC_HEADER, "Burgers,Classic Burger,Beef,12.99,true,1"]), "menu.csv");
    expect(res.status).toBe(401);
  });

  it("rejects restaurant B's owner previewing an import for restaurant A (IDOR)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .attach("file", csv([BASIC_HEADER, "Burgers,Classic Burger,Beef,12.99,true,1"]), "menu.csv");
    expect(res.status).toBe(403);
  });

  it("rejects a restaurant_staff account (no restaurant.menu.write)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .attach("file", csv([BASIC_HEADER, "Burgers,Classic Burger,Beef,12.99,true,1"]), "menu.csv");
    expect(res.status).toBe(403);
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", Buffer.from("hello"), { filename: "menu.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("does NOT write anything to the database", async () => {
    const before = await MenuItem.countDocuments({ restaurantId: restaurantA._id });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv([BASIC_HEADER, "Preview Only,Preview Item,Desc,9.99,true,1"]), "menu.csv");
    expect(res.status).toBe(200);
    const after = await MenuItem.countDocuments({ restaurantId: restaurantA._id });
    expect(after).toBe(before);
    const category = await Category.findOne({ restaurantId: restaurantA._id, name: "Preview Only" });
    expect(category).toBeNull();
  });

  it("auto-detects common column header variants and reports all rows as creatable", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach(
        "file",
        csv([
          "Category Name,Product Name,Details,Cost,Availability,Sort",
          "Drinks,Cola,Ice cold,2.50,yes,1",
          "Drinks,Lemonade,Fresh squeezed,3.00,true,2",
        ]),
        "menu.csv"
      );
    expect(res.status).toBe(200);
    expect(res.body.data.unmappedRequiredFields).toEqual([]);
    expect(res.body.data.appliedMapping["Category Name"]).toBe("categoryName");
    expect(res.body.data.appliedMapping["Product Name"]).toBe("itemName");
    expect(res.body.data.appliedMapping["Cost"]).toBe("price");
    expect(res.body.data.summary.toCreate).toBe(2);
    expect(res.body.data.summary.newCategories).toBe(1);
  });

  it("reports unmapped required fields instead of guessing", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv(["Widget,Cost", "Foo,10"]), "menu.csv");
    expect(res.status).toBe(200);
    expect(res.body.data.unmappedRequiredFields).toEqual(expect.arrayContaining(["categoryName", "itemName"]));
    expect(res.body.data.rows).toEqual([]);
  });

  it("gives row-level, actionable validation errors (not a bare 'import failed')", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach(
        "file",
        csv([
          BASIC_HEADER,
          "Burgers,Bad Price Item,Desc,abc,true,1",
          ",Missing Category Item,Desc,5,true,2",
          "Burgers,,Desc,5,true,3",
        ]),
        "menu.csv"
      );
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<{ rowNumber: number; action: string; issues: Array<{ message: string }> }>;
    expect(rows[0].action).toBe("error");
    expect(rows[0].issues[0].message).toContain('Price "abc" is not valid');
    expect(rows[1].action).toBe("error");
    expect(rows[1].issues.some((i) => i.message.includes("Category is missing"))).toBe(true);
    expect(rows[2].action).toBe("error");
    expect(rows[2].issues.some((i) => i.message.includes("Item name is missing"))).toBe(true);
  });

  it("flags an in-file duplicate row by name", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach(
        "file",
        csv([BASIC_HEADER, "Burgers,Cheeseburger,Desc,10,true,1", "Burgers, Cheeseburger ,Desc,10,true,2"]),
        "menu.csv"
      );
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<{ action: string; issues: Array<{ message: string }> }>;
    expect(rows[0].action).toBe("create");
    expect(rows[1].action).toBe("error");
    expect(rows[1].issues[0].message).toContain('Duplicate item "Cheeseburger"');
  });

  it("matches an existing category case/whitespace-insensitively, without creating a duplicate", async () => {
    const existing = await createTestCategory(restaurantA._id, { name: "Burgers" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv([BASIC_HEADER, " burgers ,New Item,Desc,10,true,1"]), "menu.csv");
    expect(res.status).toBe(200);
    expect(res.body.data.categories).toEqual([{ name: "burgers", status: "existing", itemCount: 1 }]);
    await Category.deleteOne({ _id: existing._id });
  });

  it("detects an existing menu item as a duplicate and defaults to skip", async () => {
    const category = await createTestCategory(restaurantA._id, { name: "Sides" });
    const item = await createTestMenuItem(restaurantA._id, category._id, { name: "Fries", price: 4 });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv([BASIC_HEADER, "Sides,Fries,Crispy,5,true,1"]), "menu.csv");
    expect(res.status).toBe(200);
    const row = res.body.data.rows[0];
    expect(row.action).toBe("skip");
    expect(row.matchedItemId).toBe(item.id);
    await Promise.all([MenuItem.deleteOne({ _id: item._id }), Category.deleteOne({ _id: category._id })]);
  });

  it("switches a matched duplicate to 'update' and reports the previous values when duplicateStrategy=update", async () => {
    const category = await createTestCategory(restaurantA._id, { name: "Sides2" });
    const item = await createTestMenuItem(restaurantA._id, category._id, { name: "Wings", price: 8, description: "Old desc" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("duplicateStrategy", "update")
      .attach("file", csv([BASIC_HEADER, "Sides2,Wings,New desc,9.50,true,1"]), "menu.csv");
    expect(res.status).toBe(200);
    const row = res.body.data.rows[0];
    expect(row.action).toBe("update");
    expect(row.previousValues).toEqual({ price: 8, description: "Old desc", isAvailable: true, sortOrder: 0, imageUrl: undefined });
    await Promise.all([MenuItem.deleteOne({ _id: item._id }), Category.deleteOne({ _id: category._id })]);
  });

  it("parses modifier group/option rows attached to the preceding item", async () => {
    const header = "category,item_name,price,modifier_group,modifier_option,modifier_price,modifier_min,modifier_max";
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach(
        "file",
        csv([
          header,
          "Burgers,Deluxe Burger,10,Size,Small,0,1,1",
          ",,,Size,Large,2,,",
          ",,,Extras,Cheese,1,0,2",
          ",,,Extras,Bacon,2,,",
        ]),
        "menu.csv"
      );
    expect(res.status).toBe(200);
    const row = res.body.data.rows[0];
    expect(row.action).toBe("create");
    expect(row.modifierGroups).toEqual([
      { name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Small", priceAdjustment: 0 }, { name: "Large", priceAdjustment: 2 }] },
      { name: "Extras", minSelect: 0, maxSelect: 2, options: [{ name: "Cheese", priceAdjustment: 1 }, { name: "Bacon", priceAdjustment: 2 }] },
    ]);
  });

  it("reports a modifier row with no preceding item as an error, not a crash", async () => {
    const header = "category,item_name,price,modifier_group,modifier_option";
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv([header, ",,,Size,Small"]), "menu.csv");
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].action).toBe("error");
  });

  it("parses a valid XLSX file identically to the CSV path", async () => {
    const buffer = await xlsxBuffer([
      ["category", "item_name", "description", "price", "available", "sort_order"],
      ["Drinks", "Iced Tea", "Fresh brewed", "3.25", "true", "1"],
    ]);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", buffer, { filename: "menu.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.toCreate).toBe(1);
    expect(res.body.data.extraSheetsIgnored).toEqual([]);
  });

  it("reads only the first sheet of a multi-sheet workbook and reports the rest as ignored", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("Sheet1");
    first.addRow(["category", "item_name", "price"]);
    first.addRow(["Drinks", "Water", "1"]);
    workbook.addWorksheet("Sheet2").addRow(["ignored"]);
    const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", buffer, { filename: "menu.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(res.status).toBe(200);
    expect(res.body.data.extraSheetsIgnored).toEqual(["Sheet2"]);
  });
});

describe("POST /restaurants/:restaurantId/menu/import/commit", () => {
  it("rejects commit without a mapping", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("file", csv([BASIC_HEADER, "Burgers,Classic Burger,Desc,12.99,true,1"]), "menu.csv");
    expect(res.status).toBe(400);
  });

  it("creates categories, items, and modifier groups transactionally, invisible to preview beforehand", async () => {
    const mapping = JSON.stringify({
      category: "categoryName",
      item_name: "itemName",
      description: "description",
      price: "price",
      available: "isAvailable",
      sort_order: "sortOrder",
    });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach(
        "file",
        csv([BASIC_HEADER, "Committed Burgers,Classic Burger,Beef burger,12.99,true,1", "Committed Burgers,Chicken Burger,Crispy,11.99,true,2"]),
        "menu.csv"
      );
    expect(res.status).toBe(201);
    expect(res.body.data.report.created).toBe(2);
    expect(res.body.data.report.categoriesCreated).toBe(1);

    const category = await Category.findOne({ restaurantId: restaurantA._id, name: "Committed Burgers" });
    expect(category).not.toBeNull();
    const items = await MenuItem.find({ restaurantId: restaurantA._id, categoryId: category!._id });
    expect(items).toHaveLength(2);

    const auditEntry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "menu.imported", targetId: res.body.data.report.importId });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.metadata).toMatchObject({ created: 2, categoriesCreated: 1 });
  });

  it("skips rows with validation errors and still commits the valid ones (partial-file, not partial-write)", async () => {
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Mixed,Good Item,10", "Mixed,Bad Item,notanumber"]), "menu.csv");
    expect(res.status).toBe(201);
    expect(res.body.data.report.created).toBe(1);
    expect(res.body.data.report.errors).toBe(1);

    const category = await Category.findOne({ restaurantId: restaurantA._id, name: "Mixed" });
    const items = await MenuItem.find({ restaurantId: restaurantA._id, categoryId: category!._id });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Good Item");
  });

  it("updates an existing item's fields when duplicateStrategy=update, without touching its existing modifiers", async () => {
    const category = await createTestCategory(restaurantA._id, { name: "Update Target" });
    const item = await createTestMenuItem(restaurantA._id, category._id, { name: "Nuggets", price: 5 });
    const group = await ModifierGroup.create({
      restaurantId: restaurantA._id,
      menuItemId: item._id,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ name: "BBQ", priceAdjustment: 0 }],
    });

    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .field("duplicateStrategy", "update")
      .attach("file", csv(["category,item_name,price", "Update Target,Nuggets,6.50"]), "menu.csv");
    expect(res.status).toBe(201);
    expect(res.body.data.report.updated).toBe(1);
    expect(res.body.data.report.created).toBe(0);

    const updated = await MenuItem.findById(item._id);
    expect(updated!.price).toBe(6.5);
    const groups = await ModifierGroup.find({ menuItemId: item._id });
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(group.id);

    await Promise.all([ModifierGroup.deleteOne({ _id: group._id }), MenuItem.deleteOne({ _id: item._id }), Category.deleteOne({ _id: category._id })]);
  });

  it("an all-error file creates no orphaned categories (error rows never count as 'needed')", async () => {
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const before = await Category.countDocuments({ restaurantId: restaurantA._id, name: "No Orphan Category" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "No Orphan Category,Only Item,notanumber"]), "menu.csv");
    expect(res.status).toBe(201); // an all-error file still "succeeds" as an import of zero rows
    expect(res.body.data.report.created).toBe(0);
    const after = await Category.countDocuments({ restaurantId: restaurantA._id, name: "No Orphan Category" });
    expect(after).toBe(before);
  });

  it("rolls back the WHOLE transaction — including the category — if item creation fails partway through", async () => {
    // Forces a genuine mid-transaction failure (the batched MenuItem.create call throws) and
    // confirms mongoose's withTransaction correctly aborts EVERYTHING, including the category
    // already created earlier in the same transaction — not a partial commit of just that one
    // step.
    const createSpy = jest
      .spyOn(MenuItem, "create")
      .mockImplementationOnce(async () => {
        throw new Error("simulated mid-transaction failure");
      });
    try {
      const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
      const res = await request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .field("mapping", mapping)
        .attach("file", csv(["category,item_name,price", "Rollback Category,Item One,10", "Rollback Category,Item Two,12"]), "menu.csv");
      expect(res.status).toBe(500);
    } finally {
      createSpy.mockRestore();
    }

    const category = await Category.findOne({ restaurantId: restaurantA._id, name: "Rollback Category" });
    expect(category).toBeNull();
    const items = await MenuItem.find({ restaurantId: restaurantA._id, name: { $in: ["Item One", "Item Two"] } });
    expect(items).toHaveLength(0);
  });

  it("handles a 200-row import in one request without per-row round trips", async () => {
    const rows = [BASIC_HEADER];
    for (let i = 0; i < 200; i++) {
      rows.push(`Bulk Category,Bulk Item ${i},Desc,${(5 + i * 0.01).toFixed(2)},true,${i}`);
    }
    const mapping = JSON.stringify({
      category: "categoryName",
      item_name: "itemName",
      description: "description",
      price: "price",
      available: "isAvailable",
      sort_order: "sortOrder",
    });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach("file", csv(rows), "menu.csv");
    expect(res.status).toBe(201);
    expect(res.body.data.report.created).toBe(200);
    const count = await MenuItem.countDocuments({ restaurantId: restaurantA._id });
    expect(count).toBeGreaterThanOrEqual(200);
  }, 30000);
});

describe("GET /restaurants/:restaurantId/menu/import/:importId", () => {
  it("fetches a completed import's report", async () => {
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const commitRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "History Category,History Item,7"]), "menu.csv");
    const importId = commitRes.body.data.report.importId;

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/menu/import/${importId}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.report.created).toBe(1);
    expect(res.body.data.report.actorName).toEqual(expect.any(String));
  });

  it("404s for an unknown import id", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/menu/import/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(404);
  });

  it("404s (not leaks) when restaurant B tries to fetch restaurant A's import by guessing the id", async () => {
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const commitRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Cross Tenant Category,Cross Tenant Item,7"]), "menu.csv");
    const importId = commitRes.body.data.report.importId;

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantB.id}/menu/import/${importId}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(404);
  });
});

describe("Agency access and multi-location safety (Phase 30 Steps 19-20)", () => {
  let business: Awaited<ReturnType<typeof createTestBusiness>>;
  let locationA: Awaited<ReturnType<typeof createTestRestaurant>>;
  let locationB: Awaited<ReturnType<typeof createTestRestaurant>>;
  let agency: Awaited<ReturnType<typeof createTestAgency>>;
  let agencyStaffUser: Awaited<ReturnType<typeof createTestUser>>;
  let agencyAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let outsiderAgency: Awaited<ReturnType<typeof createTestAgency>>;
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    agency = await createTestAgency();
    business = await createTestBusiness({ agencyId: agency._id });
    locationA = await createTestRestaurant({ businessId: business._id, name: "Location A" });
    locationB = await createTestRestaurant({ businessId: business._id, name: "Location B" });

    // agency_staff is READ-only everywhere in this platform's RBAC model (AGENCY_ROLE_GRANTS —
    // no write permission at all, not menu-specific) — the importer correctly inherits that
    // existing boundary rather than carving out a special write exception for it.
    agencyStaffUser = await createTestUser("agency_member");
    await createTestAgencyMembership(agency._id, agencyStaffUser._id, { role: "agency_staff", businessIds: [business._id] });

    // agency_admin DOES hold restaurant.menu.write and gets implicit access to every location
    // under a business their agency manages (no explicit businessIds assignment needed).
    agencyAdminUser = await createTestUser("agency_member");
    await createTestAgencyMembership(agency._id, agencyAdminUser._id, { role: "agency_admin" });

    outsiderAgency = await createTestAgency();
    outsiderUser = await createTestUser("agency_member");
    await createTestAgencyMembership(outsiderAgency._id, outsiderUser._id, { role: "agency_owner" });
  });

  afterAll(async () => {
    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      AuditLog.deleteMany({ restaurantId: { $in: [locationA._id, locationB._id] } }),
      Restaurant.deleteMany({ _id: { $in: [locationA._id, locationB._id] } }),
      Business.deleteOne({ _id: business._id }),
      AgencyMembership.deleteMany({ agencyId: { $in: [agency._id, outsiderAgency._id] } }),
      Agency.deleteMany({ _id: { $in: [agency._id, outsiderAgency._id] } }),
      User.deleteMany({ _id: { $in: [agencyStaffUser._id, agencyAdminUser._id, outsiderUser._id] } }),
    ]);
  });

  it("lets an agency_admin (holds restaurant.menu.write, implicit business access) commit an import for a location under their business", async () => {
    const token = tokenFor(agencyAdminUser, [{ agencyId: agency.id, role: "agency_admin" }]);
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${locationA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${token}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Agency Category,Agency Item,8"]), "menu.csv");
    expect(res.status).toBe(201);
  });

  it("rejects an agency_staff member — read-only role, correctly denied write access even with a genuine businessIds assignment", async () => {
    const token = tokenFor(agencyStaffUser, [{ agencyId: agency.id, role: "agency_staff" }]);
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${locationA.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${token}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Should Not Exist,Should Not Exist,8"]), "menu.csv");
    expect(res.status).toBe(403);
  });

  it("rejects an agency_owner from a DIFFERENT agency that doesn't manage this business", async () => {
    const token = tokenFor(outsiderUser, [{ agencyId: outsiderAgency.id, role: "agency_owner" }]);
    const res = await request(app)
      .post(`/api/v1/restaurants/${locationA.id}/menu/import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", csv([BASIC_HEADER, "X,Y,Desc,1,true,1"]), "menu.csv");
    expect(res.status).toBe(403);
  });

  // The next three tests each need FULL CONTROL over whether their business starts with zero,
  // legacy-only, or canonical-only menu items — sharing the describe block's own `business`/
  // `locationA` (already mutated by the agency-authorization tests above) would make that
  // impossible to guarantee, so each gets its own fresh business+location+owner instead.
  async function freshLocation() {
    const freshBusiness = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: freshBusiness._id, name: "Fresh Location" });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: freshBusiness._id });
    return { business: freshBusiness, location, ownerToken: tokenFor(owner), ownerId: owner._id };
  }

  it("a genuinely empty business (no canonical AND no legacy items yet) imports straight into the canonical shape, matching what the standard admin editor would create for its first item anyway", async () => {
    // MenuManagementPage.tsx (the real, live admin menu editor) writes EXCLUSIVELY via the
    // canonical /businesses/:businessId/menu endpoints — never the legacy restaurantId-scoped
    // ones. If this importer wrote legacy items here instead, they'd become invisible the moment
    // the owner added or edited a single item through the normal editor afterward (see
    // resolveImportScope.ts's own doc comment). For a brand-new, empty menu — the common
    // fast-onboarding case this importer exists for — canonical from the very first item is the
    // only choice that stays consistent with the rest of the product.
    const fresh = await freshLocation();
    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${fresh.location.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${fresh.ownerToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Fresh Onboarding Category,Fresh Onboarding Item,9"]), "menu.csv");
    expect(res.status).toBe(201);

    const underBusiness = await MenuItem.findOne({ businessId: fresh.business._id, name: "Fresh Onboarding Item" });
    expect(underBusiness).not.toBeNull();
    expect(underBusiness!.restaurantId).toBeUndefined();

    await Promise.all([
      MenuItem.deleteMany({ businessId: fresh.business._id }),
      Category.deleteMany({ businessId: fresh.business._id }),
      Restaurant.deleteOne({ _id: fresh.location._id }),
      Business.deleteOne({ _id: fresh.business._id }),
      User.deleteOne({ _id: fresh.ownerId }),
    ]);
  });

  it("a business with existing LEGACY items (not yet canonical) keeps importing legacy-scoped, to avoid orphaning what's already visible", async () => {
    // The opposite edge case from the one above: this business already has a real, pre-existing
    // legacy (restaurantId-scoped) item for its location. Forcing a canonical import here would
    // flip businessHasCanonicalMenu to true and make that pre-existing item invisible to
    // resolveMenuForLocation (which never reads restaurantId-scoped documents once canonical) —
    // so the import correctly stays on the same legacy path this restaurant's menu is already on.
    const fresh = await freshLocation();
    const preExistingCategory = await createTestCategory(fresh.location._id);
    await createTestMenuItem(fresh.location._id, preExistingCategory._id, { name: "Pre-existing Legacy Item" });

    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${fresh.location.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${fresh.ownerToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Legacy Preserving Category,Legacy Preserving Item,9"]), "menu.csv");
    expect(res.status).toBe(201);

    const underLocation = await MenuItem.findOne({ restaurantId: fresh.location._id, name: "Legacy Preserving Item" });
    expect(underLocation).not.toBeNull();
    const underBusiness = await MenuItem.findOne({ businessId: fresh.business._id, name: "Legacy Preserving Item" });
    expect(underBusiness).toBeNull();

    await Promise.all([
      MenuItem.deleteMany({ restaurantId: fresh.location._id }),
      Category.deleteMany({ restaurantId: fresh.location._id }),
      Restaurant.deleteOne({ _id: fresh.location._id }),
      Business.deleteOne({ _id: fresh.business._id }),
      User.deleteOne({ _id: fresh.ownerId }),
    ]);
  });

  it("once a business IS canonical, an import via one location writes business-scoped (correctly shared across its own locations), still never leaking to an unrelated restaurant", async () => {
    // Seed one real canonical MenuItem first so businessHasCanonicalMenu already reports this
    // business as migrated — only then does the dual-path branch this import service reuses
    // (identical to createMenuItem/createCanonicalMenuItem) take the businessId-scoped route.
    const fresh = await freshLocation();
    const secondLocation = await createTestRestaurant({ businessId: fresh.business._id, name: "Fresh Location B" });
    const seedCategory = await createTestCategory(fresh.location._id, { businessId: fresh.business._id });
    await createTestMenuItem(fresh.location._id, seedCategory._id, { businessId: fresh.business._id, name: "Seed Canonical Item" });

    const mapping = JSON.stringify({ category: "categoryName", item_name: "itemName", price: "price" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${fresh.location.id}/menu/import/commit`)
      .set("Authorization", `Bearer ${fresh.ownerToken}`)
      .field("mapping", mapping)
      .attach("file", csv(["category,item_name,price", "Canonical Shared Category,Canonical Shared Item,9"]), "menu.csv");
    expect(res.status).toBe(201);

    const itemUnderBusiness = await MenuItem.findOne({ businessId: fresh.business._id, name: "Canonical Shared Item" });
    expect(itemUnderBusiness).not.toBeNull();
    expect(itemUnderBusiness!.restaurantId).toBeUndefined();
    const leakedIntoUnrelatedRestaurant = await MenuItem.findOne({ restaurantId: restaurantB._id, name: "Canonical Shared Item" });
    expect(leakedIntoUnrelatedRestaurant).toBeNull();

    await Promise.all([
      MenuItem.deleteMany({ businessId: fresh.business._id }),
      Category.deleteMany({ businessId: fresh.business._id }),
      Restaurant.deleteMany({ _id: { $in: [fresh.location._id, secondLocation._id] } }),
      Business.deleteOne({ _id: fresh.business._id }),
      User.deleteOne({ _id: fresh.ownerId }),
    ]);
  });
});

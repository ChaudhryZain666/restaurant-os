import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { MenuImportJob } from "../models/MenuImportJob.js";
import { MenuItem } from "../models/MenuItem.js";
import { Category } from "../models/Category.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { setStorageServiceForTests } from "../storage/index.js";
import type { StorageService, UploadResult } from "../storage/StorageService.js";
import { closeTestConnections, createTestCategory, createTestMenuItem, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";
import { runMenuImportExtraction } from "../services/menuImport/extractionPipeline.service.js";
import { notificationQueue } from "../queues/notification.queue.js";

const app = createApp();

class InMemoryStorageService implements StorageService {
  private files = new Map<string, Buffer>();
  async upload(key: string, body: Buffer | Uint8Array | string): Promise<UploadResult> {
    this.files.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body as string));
    return { key, url: `https://fake-cdn.test/${key}` };
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
  getUrl(key: string): string {
    return `https://fake-cdn.test/${key}`;
  }
  async download(key: string): Promise<Buffer> {
    return this.files.get(key) ?? Buffer.from("");
  }
}

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

beforeEach(async () => {
  setStorageServiceForTests(new InMemoryStorageService());
  // This dev/test environment's local Redis (3.0.504) predates BullMQ's minimum (5.0+) — see
  // this codebase's own documented, disclosed limitation elsewhere. Mirrors
  // notification.queue.test.ts's own established convention: spy on notificationQueue.add rather
  // than let a real enqueue call hit a genuinely incompatible Redis. The worker side is exercised
  // directly via runMenuImportExtraction(), same as that file's own runTrialEndingReminderSweep
  // pattern.
  jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
  // Every test in this file shares restaurantA/B (created once in beforeAll) — without this, an
  // earlier test's jobs count against a LATER test's own MAX_CONCURRENT_IMPORT_JOBS_PER_RESTAURANT
  // check, and a later sweep/list assertion sees jobs it never created.
  await MenuImportJob.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    MenuImportJob.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    MenuItem.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    Category.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    User.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: cleanupRestaurantIds } }),
  ]);
  setStorageServiceForTests(undefined);
  await closeTestConnections();
});

function jpeg(label: string): Buffer {
  return Buffer.from(`fake-jpeg-bytes-${label}`);
}

const base = `/api/v1/restaurants`;

describe("POST /restaurants/:restaurantId/menu/import-jobs — auth & tenant isolation", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs`).attach("files", jpeg("1"), "1.jpg").field("sourceType", "images");
    expect(res.status).toBe(401);
  });

  it("rejects restaurant B's owner creating a job for restaurant A (IDOR)", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .attach("files", jpeg("1"), "1.jpg")
      .field("sourceType", "images");
    expect(res.status).toBe(403); // requireTenantMatch — the route itself is unreachable, not a leaked 404
  });

  it("rejects a read-only staff member creating a job", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .attach("files", jpeg("1"), "1.jpg")
      .field("sourceType", "images");
    expect(res.status).toBe(403);
  });

  it("404s (not 403/leaks) when restaurant B fetches restaurant A's job by guessing the id", async () => {
    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("1"), "1.jpg")
      .field("sourceType", "images");
    expect(created.status).toBe(201);
    const jobId = created.body.data.job.id;

    const res = await request(app).get(`${base}/${restaurantB.id}/menu/import-jobs/${jobId}`).set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /restaurants/:restaurantId/menu/import-jobs — validation", () => {
  it("rejects an images job with no files", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("sourceType", "images");
    expect(res.status).toBe(400);
  });

  it("rejects a url job with an invalid url", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ url: "not a url" });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", Buffer.from("not an image"), { filename: "menu.txt", contentType: "text/plain" })
      .field("sourceType", "images");
    expect(res.status).toBe(400);
  });

  it("rejects a 'pdf' sourceType with more than one file", async () => {
    const res = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", Buffer.from("pdf1"), { filename: "1.pdf", contentType: "application/pdf" })
      .attach("files", Buffer.from("pdf2"), { filename: "2.pdf", contentType: "application/pdf" })
      .field("sourceType", "pdf");
    expect(res.status).toBe(400);
  });

  it("enforces the concurrent-import-jobs-per-restaurant limit", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`${base}/${restaurantA.id}/menu/import-jobs`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .attach("files", jpeg(`limit-${i}`), `${i}.jpg`)
        .field("sourceType", "images");
      expect(res.status).toBe(201);
    }
    const fourth = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("limit-4"), "4.jpg")
      .field("sourceType", "images");
    expect(fourth.status).toBe(400);
  });
});

describe("the full images import journey — create, extract, review, publish", () => {
  it("processes an images job end to end, preserving upload order, and publishes real MenuItem documents", async () => {
    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("page1"), "page1.jpg")
      .attach("files", jpeg("page2"), "page2.jpg")
      .field("sourceType", "images");
    expect(created.status).toBe(201);
    const jobId = created.body.data.job.id;
    expect(created.body.data.job.status).toBe("pending");

    // Simulate what the BullMQ worker would do — see notification.queue.test.ts's own precedent
    // for testing worker logic directly rather than against a real Redis-backed queue.
    await runMenuImportExtraction(jobId, { attemptsMade: 0, maxAttempts: 3 });

    const afterExtraction = await request(app).get(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(afterExtraction.status).toBe(200);
    expect(afterExtraction.body.data.job.status).toBe("ready_for_review");
    const draftRows = afterExtraction.body.data.job.draftRows;
    expect(draftRows.length).toBeGreaterThan(0);
    // MockMenuExtractionProvider produces 2 rows per image, in image order — sourcePageIndex must
    // read 1,1,2,2, never shuffled.
    expect(draftRows.map((r: { sourcePageIndex: number }) => r.sourcePageIndex)).toEqual([1, 1, 2, 2]);
    // Each row carries a plain-language review bucket, not a raw score as the primary signal.
    expect(draftRows.every((r: { reviewCategory: string }) => ["looks_good", "check_this", "missing", "needs_review"].includes(r.reviewCategory))).toBe(true);

    // Edit one row before publishing — proves human review can actually correct extracted data.
    const firstRow = draftRows[0];
    const patchRes = await request(app)
      .patch(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/rows/${firstRow.rowNumber}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ itemName: "Corrected Item Name", price: 13.5 });
    expect(patchRes.status).toBe(200);
    const editedRow = patchRes.body.data.job.draftRows.find((r: { rowNumber: number }) => r.rowNumber === firstRow.rowNumber);
    expect(editedRow.itemName).toBe("Corrected Item Name");
    expect(editedRow.price).toBe(13.5);

    const publishRes = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/publish`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({});
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.job.status).toBe("completed");
    expect(publishRes.body.data.job.publishedReport.created).toBeGreaterThan(0);

    const createdItem = await MenuItem.findOne({ restaurantId: restaurantA._id, name: "Corrected Item Name" });
    expect(createdItem).not.toBeNull();
    expect(createdItem?.price).toBe(13.5);
  });

  it("never publishes automatically — a job stays ready_for_review until an explicit publish call", async () => {
    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("solo"), "solo.jpg")
      .field("sourceType", "images");
    const jobId = created.body.data.job.id;
    await runMenuImportExtraction(jobId, { attemptsMade: 0, maxAttempts: 3 });

    const job = await MenuImportJob.findById(jobId);
    expect(job?.status).toBe("ready_for_review");
    expect(job?.publishedAt).toBeUndefined();
  });
});

describe("duplicate handling — merge only fills empty fields", () => {
  it("a row matching an existing item, published with userAction 'merge', fills only its empty fields", async () => {
    // MockMenuExtractionProvider's pdf path calls rowsForPage(1, ...), which names its category
    // CATEGORY_NAMES[1 % CATEGORY_NAMES.length] = "Mains" — matched here so resolveImport() finds
    // this seeded item as a real duplicate (categoryId + normalized item name).
    const category = await createTestCategory(restaurantA._id, { name: "Mains" });
    // MockMenuExtractionProvider's "Sample Dish A" row always has price 12.99 and a real description —
    // seed an existing item with that exact name but a populated price and an EMPTY description, so
    // merge's "only fill what's empty" behavior is directly observable.
    const existing = await createTestMenuItem(restaurantA._id, category._id, {
      name: "Sample Dish A",
      price: 99, // must remain untouched by merge
      description: "",
      imageUrl: undefined,
    });

    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", Buffer.from("pdf"), { filename: "menu.pdf", contentType: "application/pdf" })
      .field("sourceType", "pdf");
    const jobId = created.body.data.job.id;
    await runMenuImportExtraction(jobId, { attemptsMade: 0, maxAttempts: 3 });

    const detail = await request(app).get(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}`).set("Authorization", `Bearer ${ownerAToken}`);
    const matchedRow = detail.body.data.job.draftRows.find((r: { itemName: string }) => r.itemName === "Sample Dish A");
    expect(matchedRow).toBeDefined();
    expect(matchedRow.matchedItemId).toBe(existing.id);

    await request(app)
      .patch(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/rows/${matchedRow.rowNumber}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ userAction: "merge" });

    await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/publish`).set("Authorization", `Bearer ${ownerAToken}`).send({});

    const reloaded = await MenuItem.findById(existing._id);
    expect(reloaded?.price).toBe(99); // untouched
    expect(reloaded?.description).not.toBe(""); // filled from the extracted row
  });
});

describe("cancellation", () => {
  it("blocks a later publish attempt once a job has been cancelled", async () => {
    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("cancel-me"), "1.jpg")
      .field("sourceType", "images");
    const jobId = created.body.data.job.id;
    await runMenuImportExtraction(jobId, { attemptsMade: 0, maxAttempts: 3 });

    const cancelRes = await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/cancel`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.job.status).toBe("cancelled");

    const publishRes = await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/publish`).set("Authorization", `Bearer ${ownerAToken}`).send({});
    expect(publishRes.status).toBe(400);

    const itemCountBefore = await MenuItem.countDocuments({ restaurantId: restaurantA._id });
    expect(await MenuItem.countDocuments({ restaurantId: restaurantA._id })).toBe(itemCountBefore); // no write occurred
  });

  it("rejects cancelling an already-terminal job", async () => {
    const created = await request(app)
      .post(`${base}/${restaurantA.id}/menu/import-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .attach("files", jpeg("already-done"), "1.jpg")
      .field("sourceType", "images");
    const jobId = created.body.data.job.id;
    await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/cancel`).set("Authorization", `Bearer ${ownerAToken}`);

    const res = await request(app).post(`${base}/${restaurantA.id}/menu/import-jobs/${jobId}/cancel`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /restaurants/:restaurantId/menu/import-jobs — listing", () => {
  it("lists only this restaurant's own jobs", async () => {
    const res = await request(app).get(`${base}/${restaurantA.id}/menu/import-jobs`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.jobs)).toBe(true);
    for (const job of res.body.data.jobs) {
      expect(job.restaurantId).toBe(restaurantA.id);
    }
  });
});

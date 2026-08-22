import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { setStorageServiceForTests } from "../storage/index.js";
import type { StorageService, UploadResult } from "../storage/StorageService.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

class FakeStorageService implements StorageService {
  uploads: Array<{ key: string; contentType?: string }> = [];
  async upload(key: string, _body: Buffer | Uint8Array | string, contentType?: string): Promise<UploadResult> {
    this.uploads.push({ key, contentType });
    return { key, url: `https://fake-cdn.test/${key}` };
  }
  async delete(): Promise<void> {}
  getUrl(key: string): string {
    return `https://fake-cdn.test/${key}`;
  }
}

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;
const fakeStorage = new FakeStorageService();

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);

  setStorageServiceForTests(fakeStorage);
});

afterEach(() => {
  fakeStorage.uploads = [];
});

afterAll(async () => {
  setStorageServiceForTests(undefined);
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([User.deleteMany({ restaurantId: { $in: ids } }), Restaurant.deleteMany({ _id: { $in: ids } })]);
  await closeTestConnections();
});

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("POST /restaurants/:restaurantId/uploads", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .field("purpose", "logo")
      .attach("file", tinyPng, "logo.png");
    expect(res.status).toBe(401);
  });

  it("rejects a restaurant B owner uploading under restaurant A (IDOR)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .field("purpose", "logo")
      .attach("file", tinyPng, "logo.png");
    expect(res.status).toBe(403);
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  it("rejects a manager uploading a logo (owner-only setting)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .field("purpose", "logo")
      .attach("file", tinyPng, "logo.png");
    expect(res.status).toBe(403);
  });

  it("allows a manager to upload a menu item image (restaurant.menu.write)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .field("purpose", "menuItemImage")
      .attach("file", tinyPng, "item.png");
    expect(res.status).toBe(201);
    expect(res.body.data.url).toContain("fake-cdn.test");
  });

  it("rejects staff uploading anything (no menu.write, no settings.manage)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .field("purpose", "menuItemImage")
      .attach("file", tinyPng, "item.png");
    expect(res.status).toBe(403);
  });

  it("rejects a missing/invalid purpose", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("purpose", "somethingElse")
      .attach("file", tinyPng, "logo.png");
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("purpose", "logo")
      .attach("file", Buffer.from("not an image"), { filename: "logo.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("rejects a file over the size limit", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("purpose", "logo")
      .attach("file", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("owner can upload a logo and gets back a real URL, scoped under this restaurant's own key", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/uploads`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .field("purpose", "logo")
      .attach("file", tinyPng, "logo.png");

    expect(res.status).toBe(201);
    expect(res.body.data.url).toBe(`https://fake-cdn.test/${fakeStorage.uploads[0].key}`);
    expect(fakeStorage.uploads[0].key).toContain(`restaurants/${restaurantA.id}/logo/`);
    expect(fakeStorage.uploads[0].contentType).toBe("image/png");
  });
});

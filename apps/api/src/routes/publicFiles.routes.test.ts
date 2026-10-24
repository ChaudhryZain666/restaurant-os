import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { connectDB } from "../config/db.js";
import { env, envSchema } from "../config/env.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getStorageService, LocalDiskStorageService, setStorageServiceForTests } from "../storage/index.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

/**
 * Pre-launch — the production "disk" storage driver end to end: a real owner upload through
 * POST /uploads lands on disk and is served back by GET /files; only public image keys are ever
 * served (menu-import source files and anything else 404).
 */
jest.setTimeout(30_000);

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let app: Express;
let dir: string;
let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerToken: string;
const saved = { driver: env.STORAGE_DRIVER, dir: env.STORAGE_DISK_DIR };

beforeAll(async () => {
  await connectDB();
  dir = mkdtempSync(join(tmpdir(), "gt-disk-storage-"));
  env.STORAGE_DRIVER = "disk";
  env.STORAGE_DISK_DIR = dir;
  setStorageServiceForTests(undefined);
  const { createApp } = await import("../app.js");
  app = createApp();
  restaurant = await createTestRestaurant();
  ownerToken = tokenFor(await createTestUser("restaurant_owner", restaurant._id));
});

afterAll(async () => {
  env.STORAGE_DRIVER = saved.driver;
  env.STORAGE_DISK_DIR = saved.dir;
  setStorageServiceForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  await User.deleteMany({ restaurantId: restaurant._id });
  await Restaurant.deleteMany({ _id: restaurant._id });
  await closeTestConnections();
});

describe("STORAGE_DRIVER=disk", () => {
  it("an owner's logo upload is stored on disk and served publicly at API_PUBLIC_ORIGIN/files, cross-origin-safe", async () => {
    const up = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/uploads`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("purpose", "logo")
      .attach("file", tinyPng, { filename: "logo.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const url: string = up.body.data.url;
    const base = `${env.API_PUBLIC_ORIGIN.replace(/\/$/, "")}/files/`;
    expect(url.startsWith(base)).toBe(true);
    expect(url).toMatch(new RegExp(`/files/restaurants/${restaurant.id}/logo/[0-9a-f-]{36}\\.png$`));

    const res = await request(app).get(`/files/${url.slice(base.length)}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, tinyPng)).toBe(0);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("never serves private files (menu-import sources) or anything that isn't a public image key", async () => {
    const storage = new LocalDiskStorageService({ baseDir: dir, publicBaseUrl: "" });
    const privateKey = `restaurants/${restaurant.id}/menu-imports/0123456789abcdef01234567/source/1-menu.pdf`;
    await storage.upload(privateKey, Buffer.from("%PDF-1.4 private menu"), "application/pdf");
    const imageKey = `restaurants/${restaurant.id}/logo/00000000-0000-4000-8000-000000000000.png`;
    await storage.upload(imageKey, tinyPng, "text/html"); // a lying sidecar must not matter

    expect((await request(app).get(`/files/${privateKey}`)).status).toBe(404);
    expect((await request(app).get(`/files/${imageKey}.meta.json`)).status).toBe(404);
    expect((await request(app).get(`/files/restaurants/${restaurant.id}/logo/00000000-0000-4000-8000-000000000000.svg`)).status).toBe(404);
    expect((await request(app).get(`/files/..%2F..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await request(app).get(`/files/restaurants/${restaurant.id}/logo/../menu-imports/x.png`)).status).toBe(404);
    expect((await request(app).get(`/files/restaurants/${restaurant.id}/logo/11111111-1111-4111-8111-111111111111.png`)).status).toBe(404); // valid shape, no file

    const served = await request(app).get(`/files/${imageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png"); // from the extension, never the sidecar
  });

  it("the storage factory uses the disk volume and the /files URL", async () => {
    setStorageServiceForTests(undefined);
    const storage = getStorageService();
    expect(storage).toBeInstanceOf(LocalDiskStorageService);
    expect(storage.getUrl("restaurants/x/logo/y.png")).toBe(`${env.API_PUBLIC_ORIGIN.replace(/\/$/, "")}/files/restaurants/x/logo/y.png`);
  });
});

describe("storage configuration", () => {
  const BASE = { MONGO_URI: "mongodb://localhost:27017/test", REDIS_URL: "redis://localhost:6379", JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32) };

  it("STORAGE_DRIVER=disk requires an absolute directory", () => {
    expect(envSchema.safeParse({ ...BASE, STORAGE_DRIVER: "disk", STORAGE_DISK_DIR: "relative/uploads" }).success).toBe(false);
    expect(envSchema.safeParse({ ...BASE, STORAGE_DRIVER: "disk", STORAGE_DISK_DIR: "/data/uploads" }).success).toBe(true);
    expect(envSchema.safeParse({ ...BASE, STORAGE_DRIVER: "ftp" }).success).toBe(false);
  });

  it("an explicit STORAGE_DRIVER=s3 without credentials fails clearly instead of falling back to disk", () => {
    const savedDriver = env.STORAGE_DRIVER;
    const creds = { b: env.STORAGE_BUCKET, a: env.STORAGE_ACCESS_KEY, s: env.STORAGE_SECRET_KEY };
    env.STORAGE_DRIVER = "s3";
    env.STORAGE_BUCKET = undefined;
    setStorageServiceForTests(undefined);
    try {
      expect(() => getStorageService()).toThrow(/STORAGE_DRIVER=disk/);
    } finally {
      env.STORAGE_DRIVER = savedDriver;
      env.STORAGE_BUCKET = creds.b;
      env.STORAGE_ACCESS_KEY = creds.a;
      env.STORAGE_SECRET_KEY = creds.s;
      setStorageServiceForTests(undefined);
    }
  });
});

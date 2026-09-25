import { connectDB } from "../../config/db.js";
import { MenuImportJob } from "../../models/MenuImportJob.js";
import { setStorageServiceForTests } from "../../storage/index.js";
import type { StorageService, UploadResult } from "../../storage/StorageService.js";
import { closeTestConnections, createTestRestaurant, createTestUser } from "../../test-utils/fixtures.js";
import { runMenuImportRetentionSweep } from "./menuImportRetention.service.js";

class FakeStorageService implements StorageService {
  deletedKeys: string[] = [];
  failOn: Set<string> = new Set();
  async upload(key: string): Promise<UploadResult> {
    return { key, url: `https://fake-cdn.test/${key}` };
  }
  async delete(key: string): Promise<void> {
    if (this.failOn.has(key)) throw new Error("simulated delete failure");
    this.deletedKeys.push(key);
  }
  getUrl(key: string): string {
    return `https://fake-cdn.test/${key}`;
  }
  async download(): Promise<Buffer> {
    return Buffer.from("");
  }
}

let fakeStorage: FakeStorageService;
let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant();
  user = await createTestUser("restaurant_owner", restaurant._id);
});

beforeEach(async () => {
  fakeStorage = new FakeStorageService();
  setStorageServiceForTests(fakeStorage);
  // The sweep has no per-test scoping (it processes every due job in the collection) — without
  // this, an earlier test's job left "due but not yet deleted" (e.g. the simulated-failure case)
  // gets reprocessed by a LATER test's own sweep call, against that later test's fresh fakeStorage
  // (which no longer has the original key in its failOn set), producing a deletedKeys entry the
  // later test never expected.
  await MenuImportJob.deleteMany({ restaurantId: restaurant._id });
});

afterAll(async () => {
  setStorageServiceForTests(undefined);
  await closeTestConnections();
});

function pastDate(hoursAgo: number): Date {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
}
function futureDate(hoursAhead: number): Date {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
}

async function makeJob(overrides: Record<string, unknown>) {
  return MenuImportJob.create({
    restaurantId: restaurant._id,
    requestedByUserId: user._id,
    sourceType: "images",
    status: "completed",
    progress: { stage: "completed", percent: 100 },
    sourceFiles: [
      { storageKey: `restaurants/${restaurant._id}/menu-imports/x/source/1-a.jpg`, originalFileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 10, order: 1 },
    ],
    ...overrides,
  });
}

describe("runMenuImportRetentionSweep", () => {
  it("deletes source files for a job whose retention window has passed and marks it done", async () => {
    const job = await makeJob({ sourceRetentionDeleteAt: pastDate(1) });
    await runMenuImportRetentionSweep();

    expect(fakeStorage.deletedKeys).toEqual([`restaurants/${restaurant._id}/menu-imports/x/source/1-a.jpg`]);
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.sourceFilesDeletedAt).toBeDefined();
  });

  it("does not touch a job whose retention window hasn't passed yet", async () => {
    await makeJob({ sourceRetentionDeleteAt: futureDate(1) });
    await runMenuImportRetentionSweep();
    expect(fakeStorage.deletedKeys).toEqual([]);
  });

  it("does not re-process a job whose files were already deleted", async () => {
    await makeJob({ sourceRetentionDeleteAt: pastDate(1), sourceFilesDeletedAt: pastDate(0.5) });
    await runMenuImportRetentionSweep();
    expect(fakeStorage.deletedKeys).toEqual([]);
  });

  it("leaves a job eligible for retry when storage deletion fails, without crashing the sweep", async () => {
    const key = `restaurants/${restaurant._id}/menu-imports/y/source/1-a.jpg`;
    fakeStorage.failOn.add(key);
    const job = await MenuImportJob.create({
      restaurantId: restaurant._id,
      requestedByUserId: user._id,
      sourceType: "images",
      status: "completed",
      progress: { stage: "completed", percent: 100 },
      sourceFiles: [{ storageKey: key, originalFileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 10, order: 1 }],
      sourceRetentionDeleteAt: pastDate(1),
    });

    await expect(runMenuImportRetentionSweep()).resolves.not.toThrow();

    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.sourceFilesDeletedAt).toBeUndefined();
  });

  it("marks a url-sourced job (no sourceFiles) done immediately, with nothing to delete", async () => {
    const job = await MenuImportJob.create({
      restaurantId: restaurant._id,
      requestedByUserId: user._id,
      sourceType: "url",
      sourceUrl: "https://example.com/menu",
      status: "completed",
      progress: { stage: "completed", percent: 100 },
      sourceFiles: [],
      sourceRetentionDeleteAt: pastDate(1),
    });
    await runMenuImportRetentionSweep();
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.sourceFilesDeletedAt).toBeDefined();
    expect(fakeStorage.deletedKeys).toEqual([]);
  });
});

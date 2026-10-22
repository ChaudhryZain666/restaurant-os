import { connectDB } from "../../config/db.js";
import { MenuImportJob } from "../../models/MenuImportJob.js";
import { setStorageServiceForTests } from "../../storage/index.js";
import type { StorageService, UploadResult } from "../../storage/StorageService.js";
import { setMenuExtractionProviderForTests } from "../../menuExtraction/index.js";
import type { MenuExtractionInput, MenuExtractionProvider, MenuExtractionResult } from "../../menuExtraction/MenuExtractionProvider.js";
import { MenuExtractionError } from "../../menuExtraction/MenuExtractionProvider.js";
import { UnrecoverableError } from "bullmq";
import { closeTestConnections, createTestRestaurant, createTestUser } from "../../test-utils/fixtures.js";
import { runMenuImportExtraction } from "./extractionPipeline.service.js";

class FakeStorageService implements StorageService {
  async upload(key: string): Promise<UploadResult> {
    return { key, url: `https://fake-cdn.test/${key}` };
  }
  async delete(): Promise<void> {}
  getUrl(key: string): string {
    return `https://fake-cdn.test/${key}`;
  }
  async download(): Promise<Buffer> {
    return Buffer.from("%PDF-1.4 fixture");
  }
}

/** Throws on its first `failCount` calls (simulating a transient extraction failure — a network
 *  blip, a provider 503), then succeeds — lets these tests drive a real failure-then-retry
 *  sequence without waiting on BullMQ's own backoff timers. */
class FlakyExtractionProvider implements MenuExtractionProvider {
  readonly name = "flaky-test-provider";
  calls = 0;
  constructor(private readonly failCount: number) {}
  async extract(_input: MenuExtractionInput): Promise<MenuExtractionResult> {
    this.calls++;
    if (this.calls <= this.failCount) throw new Error("simulated transient extraction failure");
    return {
      rows: [{ categoryName: "Mains", itemName: "Test Dish", price: "12.00", overallConfidence: 0.9, fieldConfidence: [] }],
      warnings: [],
      modelUsed: "flaky-test-model",
    };
  }
}

let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant();
  user = await createTestUser("restaurant_owner", restaurant._id);
});

beforeEach(async () => {
  setStorageServiceForTests(new FakeStorageService());
  await MenuImportJob.deleteMany({ restaurantId: restaurant._id });
});

afterAll(async () => {
  setStorageServiceForTests(undefined);
  setMenuExtractionProviderForTests(undefined);
  await closeTestConnections();
});

async function makePendingJob() {
  return MenuImportJob.create({
    restaurantId: restaurant._id,
    requestedByUserId: user._id,
    sourceType: "pdf",
    status: "pending",
    progress: { stage: "pending", percent: 0 },
    sourceFiles: [{ storageKey: `restaurants/${restaurant._id}/menu-imports/x/source/1-menu.pdf`, originalFileName: "menu.pdf", contentType: "application/pdf", sizeBytes: 10, order: 1 }],
  });
}

describe("runMenuImportExtraction — retry safety", () => {
  it("a failed non-final attempt resets the job to pending so the next retry can actually run and complete (regression: previously wedged the job forever)", async () => {
    const job = await makePendingJob();
    setMenuExtractionProviderForTests(new FlakyExtractionProvider(1));

    await expect(runMenuImportExtraction(job._id.toString(), { attemptsMade: 0, maxAttempts: 3 })).rejects.toThrow(
      "simulated transient extraction failure"
    );
    const afterFirstFailure = await MenuImportJob.findById(job._id);
    expect(afterFirstFailure!.status).toBe("pending");

    // The retry (attemptsMade: 1) must actually be able to claim and process the job, not silently
    // no-op because status is no longer "pending" from a prior attempt's leftover progress.
    await runMenuImportExtraction(job._id.toString(), { attemptsMade: 1, maxAttempts: 3 });
    const afterRetry = await MenuImportJob.findById(job._id);
    expect(afterRetry!.status).toBe("ready_for_review");
    expect(afterRetry!.draftRows).toHaveLength(1);
    expect(afterRetry!.draftRows[0].itemName).toBe("Test Dish");
  });

  it("marks the job failed with an honest error only once the final attempt fails, never getting stuck", async () => {
    const job = await makePendingJob();
    setMenuExtractionProviderForTests(new FlakyExtractionProvider(99)); // always fails

    await expect(runMenuImportExtraction(job._id.toString(), { attemptsMade: 3, maxAttempts: 3 })).rejects.toThrow();
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.error?.message).toContain("simulated transient extraction failure");
  });

  it("a job already cancelled by the user is never resurrected by a failing attempt's own retry/failure handling", async () => {
    const job = await makePendingJob();
    // Claim it into "processing" the way a real first attempt would, then simulate the user
    // cancelling mid-flight (cancelMenuImportJob's own real effect) before the attempt's catch
    // block runs.
    job.status = "processing";
    await job.save();
    setMenuExtractionProviderForTests(new FlakyExtractionProvider(99));

    await MenuImportJob.updateOne({ _id: job._id }, { $set: { status: "cancelled", cancelledAt: new Date() } });

    // A non-final attempt's failure path must not overwrite "cancelled" back to "pending".
    await expect(runMenuImportExtraction(job._id.toString(), { attemptsMade: 0, maxAttempts: 3 })).resolves.toBeUndefined();
    const afterNonFinal = await MenuImportJob.findById(job._id);
    expect(afterNonFinal!.status).toBe("cancelled");
  });

  it("does not reprocess a job that isn't pending (already claimed, or already terminal) — the atomic claim guard", async () => {
    const job = await makePendingJob();
    job.status = "ready_for_review";
    job.draftRows = [];
    await job.save();
    const provider = new FlakyExtractionProvider(0);
    setMenuExtractionProviderForTests(provider);

    await runMenuImportExtraction(job._id.toString(), { attemptsMade: 0, maxAttempts: 3 });
    expect(provider.calls).toBe(0); // never even called — the atomic claim found no "pending" job to take
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.status).toBe("ready_for_review");
  });
});

// Phase 89 — permanent failures end the job at once (no repeated paid calls); temporary ones still
// get BullMQ's retries; and the real final attempt (attemptsMade = maxAttempts - 1) is marked failed.
class ErrorProvider implements MenuExtractionProvider {
  readonly name = "error-test-provider";
  calls = 0;
  constructor(private readonly error: Error) {}
  async extract(): Promise<MenuExtractionResult> {
    this.calls++;
    throw this.error;
  }
}

describe("runMenuImportExtraction — permanent vs temporary failures", () => {
  it.each([
    ["invalid credentials", new MenuExtractionError("The extraction service rejected these credentials.", "invalid_credentials")],
    ["a rejected request", new MenuExtractionError("The extraction service rejected this request (HTTP 400).", "rejected")],
    ["a refusal", new MenuExtractionError("The extraction service declined to read this menu.", "refused")],
    ["truncated output", new MenuExtractionError("This menu is too long to read in one pass.", "incomplete")],
    ["a provider_error marked non-retryable (Claude HTTP 400)", new MenuExtractionError("Extraction service error (HTTP 400)", "provider_error", { retryable: false })],
  ])("%s on the FIRST attempt fails the job immediately and tells BullMQ not to retry", async (_label, error) => {
    const provider = new ErrorProvider(error);
    setMenuExtractionProviderForTests(provider);
    const job = await makePendingJob();

    const thrown = await runMenuImportExtraction(job._id.toString(), { attemptsMade: 0, maxAttempts: 3 }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect((thrown as Error).message).toBe(error.message);
    expect(provider.calls).toBe(1);
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.error?.message).toBe(error.message);
  });

  it.each([
    ["a rate limit", new MenuExtractionError("busy", "rate_limited")],
    ["a timeout", new MenuExtractionError("timed out", "timeout")],
    ["a provider outage", new MenuExtractionError("unavailable", "provider_unavailable")],
    ["malformed output", new MenuExtractionError("malformed", "provider_error")],
    ["an unexpected error", new Error("socket hang up")],
  ])("%s on a non-final attempt is left for BullMQ's retry (job back to pending, original error rethrown)", async (_label, error) => {
    setMenuExtractionProviderForTests(new ErrorProvider(error));
    const job = await makePendingJob();

    const thrown = await runMenuImportExtraction(job._id.toString(), { attemptsMade: 0, maxAttempts: 3 }).catch((e: unknown) => e);
    expect(thrown).toBe(error);
    expect(thrown).not.toBeInstanceOf(UnrecoverableError);
    expect((await MenuImportJob.findById(job._id))!.status).toBe("pending");
  });

  it("the real final attempt (BullMQ attemptsMade = 2 of 3) marks the job failed instead of leaving it pending forever", async () => {
    setMenuExtractionProviderForTests(new ErrorProvider(new MenuExtractionError("busy", "rate_limited")));
    const job = await makePendingJob();
    await expect(runMenuImportExtraction(job._id.toString(), { attemptsMade: 2, maxAttempts: 3 })).rejects.toThrow("busy");
    const reloaded = await MenuImportJob.findById(job._id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.error?.message).toBe("busy");
  });
});

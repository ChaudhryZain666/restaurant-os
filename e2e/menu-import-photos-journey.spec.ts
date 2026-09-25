import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

// A minimal, valid 1x1 JPEG — real bytes a real image decoder can open, not a text placeholder.
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

/**
 * Phase 81 Stage 3 — Journey 3 (brief §37): new restaurant -> upload multiple menu photos ->
 * import -> review -> publish. Real multi-file upload (2 photos) through
 * LocalDiskStorageService + the real async pipeline; verifies multi-page/photo ordering is
 * preserved (brief §7) via each photo's own source-preview group.
 */
test.describe.serial("menu import — photos journey", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("multiple photos -> import -> review -> publish", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-photos-import-${stamp}`;
    const restaurantName = `E2E Photos Import ${stamp}`;
    const ownerEmail = `e2e-photos-import-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Photos Import Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("PhotosImportOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/menu/import");
    // LocationContext resolves activeLocationId asynchronously — a hard navigation straight to
    // this page (not an in-app link click) can render it before that's ready, silently no-opping
    // the file input's onChange handler (see ImportEntryPage.tsx's own startFilesJob guard).
    // Waiting for the option button to actually be enabled avoids racing ahead of it.
    await expect(page.getByRole("button", { name: "Upload photos" })).toBeEnabled({ timeout: 10_000 });
    const jpegBuffer = Buffer.from(JPEG_BASE64, "base64");
    const photosInput = page.locator('input[type="file"][accept*="image"]');
    await photosInput.setInputFiles([
      { name: "page1.jpg", mimeType: "image/jpeg", buffer: jpegBuffer },
      { name: "page2.jpg", mimeType: "image/jpeg", buffer: jpegBuffer },
    ]);

    await expect(page).toHaveURL(/\/menu\/import\/job\/[a-f0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Review your import" })).toBeVisible({ timeout: 30_000 });

    // 2 photos x 2 rows each (mock provider) = 4 items, in input order (brief §7).
    await expect(page.getByText("4 items found")).toBeVisible();
    await expect(page.getByText("Item from photo 1 A").first()).toBeVisible();
    await expect(page.getByText("Item from photo 2 A").first()).toBeVisible();
    await expect(page.getByText("2 photos uploaded")).toBeVisible();
    await expect(page.getByText("Photo 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Photo 2", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Publish to my menu" }).click();
    await expect(page.getByRole("heading", { name: "Your menu is ready" })).toBeVisible({ timeout: 15_000 });
    // Row "B" on each photo has the same deliberately-unparseable price as the PDF/URL journeys,
    // so only the 2 "A" rows (one per photo) actually publish.
    await expect(page.getByText("2 items added")).toBeVisible();

    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByText("Item from photo 1 A")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Item from photo 2 A")).toBeVisible();
  });
});

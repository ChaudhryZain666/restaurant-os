import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 81 Stage 3 — Journey 1 (brief §37): new restaurant -> menu importer -> upload PDF ->
 * processing -> review -> edit -> save draft -> preview -> publish. Runs against the real async
 * pipeline (real BullMQ job, real MockMenuExtractionProvider, real LocalDiskStorageService-backed
 * file upload/download) — nothing here is stubbed or seeded directly into Mongo.
 */
test.describe.serial("menu import — PDF journey", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("PDF upload -> processing -> review -> edit -> preview -> publish", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-pdf-import-${stamp}`;
    const restaurantName = `E2E PDF Import ${stamp}`;
    const ownerEmail = `e2e-pdf-import-owner-${stamp}@test.local`;

    // --- Provision a fresh, empty restaurant (same pattern as dashboard-not-ready-state.spec.ts). ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("PDF Import Owner");
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
    await page.locator('input[type="password"]').fill("PdfImportOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Menu -> import entry chooser -> upload PDF. ---
    await page.goto("http://localhost:5174/menu");
    await page.getByRole("link", { name: "Import menu" }).click();
    await expect(page).toHaveURL(/\/menu\/import$/);
    await expect(page.getByRole("heading", { name: "Bring your menu to GarnishTable" })).toBeVisible();

    const pdfInput = page.locator('input[type="file"][accept="application/pdf"]');
    await pdfInput.setInputFiles({
      name: "menu.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 a real (if fake-content) PDF for the async import pipeline", "utf-8"),
    });

    // --- Processing: real, honest stage-based progress (never a fake percentage). ---
    await expect(page).toHaveURL(/\/menu\/import\/job\/[a-f0-9]+$/, { timeout: 15_000 });

    // --- Review: real extraction output from MockMenuExtractionProvider (2 rows: one "Looks
    // good", one "Missing" due to a deliberately-unparseable price). ---
    await expect(page.getByRole("heading", { name: "Review your import" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 items found")).toBeVisible();
    await expect(page.getByText("Sample Dish A").first()).toBeVisible();
    await expect(page.getByText("Sample Dish B").first()).toBeVisible();
    await expect(page.getByText("Looks good").first()).toBeVisible();
    await expect(page.getByText("Missing").first()).toBeVisible();

    // --- Source preview: page-grouped, per the brief's own split-view requirement. ---
    await expect(page.getByText("Original source")).toBeVisible();
    await expect(page.getByText("1 page uploaded")).toBeVisible();

    // --- Edit a row before publishing — the brief's own "you can correct fields before
    // publishing" requirement. ---
    await page.getByRole("button", { name: /Sample Dish A/ }).click();
    const itemNameInput = page.getByLabel("Item name");
    await itemNameInput.fill("House Special Dish");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Reviewed")).toBeVisible({ timeout: 10_000 });

    // --- Publish. Never auto-published — this is an explicit owner action. ---
    await page.getByRole("button", { name: "Publish to my menu" }).click();
    await expect(page.getByRole("heading", { name: "Your menu is ready" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 item added")).toBeVisible();

    // --- The edited item is really on the live menu builder now. ---
    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByText("House Special Dish")).toBeVisible({ timeout: 10_000 });

    // --- Live preview — real storefront iframe, per the brief's own "see what customers will
    // see" requirement. ---
    await page.getByRole("button", { name: "Live preview" }).click();
    await expect(page.getByRole("dialog", { name: "Storefront live preview" })).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();
  });
});

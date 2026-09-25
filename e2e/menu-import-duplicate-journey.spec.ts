import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 81 Stage 3 — Journey 4 (brief §37): existing menu -> import additional menu -> duplicate
 * detection -> choose merge behavior -> review -> save. Real duplicate detection, not seeded: the
 * deterministic MockMenuExtractionProvider always names PDF row 1 "Sample Dish A" (see
 * MockMenuExtractionProvider.ts), so importing the same PDF twice against the same restaurant
 * reliably produces a genuine name-match on the second run — resolveImport()'s own real matching
 * logic, never faked for this test.
 */
test.describe.serial("menu import — duplicate detection journey", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("second PDF import detects the first import's item as a duplicate and merges it", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slug = `e2e-dup-import-${stamp}`;
    const restaurantName = `E2E Dup Import ${stamp}`;
    const ownerEmail = `e2e-dup-import-owner-${stamp}@test.local`;
    const pdfFile = { name: "menu.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 duplicate-detection fixture", "utf-8") };

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Dup Import Owner");
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
    await page.locator('input[type="password"]').fill("DupImportOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- First import: establishes "Sample Dish A" as a real, published menu item. ---
    await page.goto("http://localhost:5174/menu/import");
    await expect(page.getByRole("button", { name: "Upload a PDF" })).toBeEnabled({ timeout: 10_000 });
    await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(pdfFile);
    await expect(page).toHaveURL(/\/menu\/import\/job\/[a-f0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Review your import" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Sample Dish A").first()).toBeVisible();
    // Row is brand-new here — no duplicate badge yet, nothing to merge on the first pass.
    await expect(page.getByText("possible duplicate")).toHaveCount(0);
    await page.getByRole("button", { name: "Publish to my menu" }).click();
    await expect(page.getByRole("heading", { name: "Your menu is ready" })).toBeVisible({ timeout: 15_000 });

    // --- Second import of the SAME source: "Sample Dish A" now matches the just-published item. ---
    await page.goto("http://localhost:5174/menu/import");
    await expect(page.getByRole("button", { name: "Upload a PDF" })).toBeEnabled({ timeout: 10_000 });
    await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(pdfFile);
    await expect(page).toHaveURL(/\/menu\/import\/job\/[a-f0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Review your import" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("1 possible duplicate")).toBeVisible();

    // --- Open the duplicate row and choose "Fill in gaps only" (merge), the brief's own
    // never-silently-overwrite requirement (§21/§22). ---
    await page.getByRole("button", { name: /Sample Dish A/ }).click();
    await expect(page.getByText("This looks like an existing item — what should publish do?")).toBeVisible();
    // Two "Fill in gaps only" controls exist on this page: the per-row duplicate-action button
    // (this one, DOM-first) and the sticky publish bar's job-wide default-strategy picker further
    // down — .first() disambiguates to the row-level one.
    const rowMergeButton = page.getByRole("button", { name: "Fill in gaps only" }).first();
    await rowMergeButton.click();
    await expect(rowMergeButton).toHaveClass(/border-primary/);

    await page.getByRole("button", { name: "Publish to my menu" }).click();
    await expect(page.getByRole("heading", { name: "Your menu is ready" })).toBeVisible({ timeout: 15_000 });

    // --- Still exactly one "Sample Dish A" on the real menu — merged, not duplicated. ---
    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByText("Sample Dish A")).toHaveCount(1);
  });
});

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 81 Stage 3 — Journey 2 (brief §37): new restaurant -> paste URL -> import -> review ->
 * publish. Real SSRF-safe fetch (a genuine outbound HTTPS request to example.com — a stable,
 * always-reachable domain safe to use as a live external fixture) through the real async pipeline.
 */
test.describe.serial("menu import — URL journey", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("paste URL -> import -> review -> publish", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-url-import-${stamp}`;
    const restaurantName = `E2E URL Import ${stamp}`;
    const ownerEmail = `e2e-url-import-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("URL Import Owner");
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
    await page.locator('input[type="password"]').fill("UrlImportOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/menu/import");
    await page.getByPlaceholder("https://yourrestaurant.com/menu").fill("https://example.com/");
    await page.getByRole("button", { name: "Import", exact: true }).click();

    await expect(page).toHaveURL(/\/menu\/import\/job\/[a-f0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Review your import" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 items found")).toBeVisible();
    await expect(page.getByText("Web Menu Item A").first()).toBeVisible();
    await expect(page.getByText("Web Menu Item B").first()).toBeVisible();

    // URL-sourced jobs have no page/photo source preview (no file to group by) — the review list
    // alone fills the full width instead.
    await expect(page.getByText("Original source")).toHaveCount(0);

    await page.getByRole("button", { name: "Publish to my menu" }).click();
    await expect(page.getByRole("heading", { name: "Your menu is ready" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 item added")).toBeVisible();

    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByText("Web Menu Item A")).toBeVisible({ timeout: 10_000 });
  });
});

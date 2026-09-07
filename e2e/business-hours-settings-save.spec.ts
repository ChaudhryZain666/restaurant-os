import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 54 — the exact reproduction of the reported anomaly: "a newly provisioned restaurant can
 * end up 'Outside business hours' after a Settings-page save." Root cause: SettingsPage.tsx's
 * handleSubmit used to fall back to a hardcoded Mon-Sun 09:00-21:00 schedule whenever
 * `businessHours` was empty — and since that form always resubmits every setting regardless of
 * which tab is open, ANY unrelated save (this test uses General) silently turned an intentionally-
 * unrestricted restaurant (`businessHours: []`, the provisioning default — see Restaurant.ts) into
 * an hours-restricted one, which could immediately read as "closed" depending on the time of day the
 * save happened. Fixed by sending `restaurant.settings.businessHours` through as-is instead of
 * defaulting it at submit time.
 *
 * Checks the PERSISTED businessHours value directly (not just an availability badge) so this stays
 * deterministic regardless of what time of day it actually runs — an availability check alone could
 * coincidentally still read "open" even with the bug present, depending on the clock.
 */
test.describe.serial("business hours are never silently invented by an unrelated Settings save (Phase 54)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("an unrelated Settings save leaves an unconfigured restaurant's hours empty (unrestricted), then a real hours change correctly closes it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-hours-save-${stamp}`;
    const restaurantName = `E2E Hours Save ${stamp}`;
    const ownerEmail = `e2e-hours-save-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Hours Save Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("HoursSaveOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    const restaurantBefore = await db.collection("restaurants").findOne({ slug });
    expect(restaurantBefore?.settings?.businessHours ?? []).toEqual([]);

    // --- Save a completely unrelated tab (General — just the restaurant's own name). ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "General", exact: true }).click();
    await page.getByLabel("Description").fill("A test restaurant.");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    const restaurantAfterUnrelatedSave = await db.collection("restaurants").findOne({ slug });
    expect(restaurantAfterUnrelatedSave?.settings?.businessHours).toEqual([]);

    // --- Now actually configure hours to something unambiguously closed (every day), regardless of
    // the real time this test happens to run at — proves a REAL change is correctly honored. ---
    await page.getByRole("button", { name: "Business Hours", exact: true }).click();
    for (const day of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
      // The day's own row is the span's IMMEDIATE parent — a `div` `.filter({ has: ... })` also
      // matches every ANCESTOR div containing that span transitively (the whole day list included),
      // resolving to every checkbox on the page, not just this row's.
      const dayRow = page.locator("span", { hasText: day, exact: true }).locator("xpath=..");
      await dayRow.getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    const restaurantAfterRealChange = await db.collection("restaurants").findOne({ slug });
    expect(restaurantAfterRealChange?.settings?.businessHours.every((h: { isClosed: boolean }) => h.isClosed)).toBe(true);

    // The active tab is local component state, not URL-driven, so a reload lands back on General —
    // the "Current status" badge only renders inside the Business Hours tab itself.
    await page.reload();
    await page.getByRole("button", { name: "Business Hours", exact: true }).click();
    await expect(page.getByText("Outside business hours")).toBeVisible({ timeout: 10_000 });
  });
});

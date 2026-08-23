import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 24 — the real, browser-driven proof of the billing lifecycle: an owner with no
 * subscription starts one against the mock provider, sees it trialing, drives a real (signature-
 * verified) event through the mock-advance dev button to convert the trial to active — the same
 * code path a genuine webhook delivery goes through (billingMockDriver.controller.ts) — then
 * schedules cancellation, sees the "cancelling" state, and reactivates. Deliberately one focused
 * spec, not a giant journey — existing restaurant/business workflows are proven unaffected simply
 * by the rest of the suite staying green (nothing new gates them; see entitlement.service.ts's
 * header comment).
 *
 * Same documented exception as the other golden-path specs for the owner invite token (only ever
 * leaves the server via a real outbound email, so it's read/written directly against Mongo here).
 */
test.describe.serial("owner billing lifecycle via the mock provider (Phase 24)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("start -> trial -> active (via mock-advance) -> cancelling -> active again", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-billing-${stamp}`;
    const restaurantName = `E2E Billing ${stamp}`;
    const ownerEmail = `e2e-billing-owner-${stamp}@test.local`;

    // --- Platform admin provisions a restaurant + owner invite. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Billing Owner");
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
    await page.locator('input[type="password"]').fill("BillingOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/setup$/, { timeout: 10_000 });

    // --- Billing: no subscription yet. ---
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });

    // --- Start a subscription against the mock provider -> trialing. ---
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Simulate the trial converting (a real, signature-verified event through the same code
    // path a genuine webhook delivery uses — not a database shortcut) -> active. ---
    await page.getByRole("button", { name: "Simulate trial conversion (dev)" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Owner schedules cancellation -> cancelling, visible period-end date. ---
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel subscription" }).click();
    await expect(page.getByText("Cancelling", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Cancels on")).toBeVisible();

    // --- Owner reactivates -> back to active, cancel date cleared. ---
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Cancels on")).not.toBeVisible();
  });
});

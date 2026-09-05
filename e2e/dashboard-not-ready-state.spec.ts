import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Portal UX phase — focused coverage for the Dashboard's genuinely new code path: an in-place
 * "get your restaurant ready" state (DashboardPage.tsx) replacing the old
 * `<Navigate to="/setup" />` redirect. restaurant-provisioning-golden-path.spec.ts already exercises
 * this state in passing as part of its much larger end-to-end flow (and then moves on to Setup to
 * publish); this spec instead stays on Dashboard itself and checks the state actually reflects real
 * readiness data and updates in place, without ever navigating to /setup.
 */
test.describe.serial("dashboard not-ready state (Portal UX phase)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("a pending restaurant's owner sees Dashboard's ready-checklist in place, and it updates live as checks complete", async ({ page }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const slug = `e2e-not-ready-${stamp}`;
    const restaurantName = `E2E Not Ready ${stamp}`;
    const ownerEmail = `e2e-not-ready-owner-${stamp}@test.local`;
    const itemName = `Ready Burger ${stamp}`;
    const categoryName = `Ready Category ${stamp}`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Not Ready Owner");
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
    await page.locator('input[type="password"]').fill("NotReadyOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();

    // --- Lands on Dashboard itself, in place — never redirected to /setup. ---
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible();
    await expect(page.getByText("Your restaurant isn't ready to take its first online order yet")).toBeVisible();

    // --- Real readiness data, not a static message: only Menu is outstanding for a freshly
    // provisioned restaurant (profile/orderType/location default satisfied), shown with its actual
    // what/why copy, not a bare label. ---
    await expect(page.getByText("3 of 4 ready")).toBeVisible();
    await expect(page.getByText("Add the food customers can order.", { exact: false })).toBeVisible();
    await expect(page.getByText(/Nobody can check out until at least one item is available/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeDisabled();
    await expect(page.getByText("Finish the items above to enable publishing.")).toBeVisible();

    // --- Complete the one outstanding check, from Dashboard's own link (not by going through
    // Setup) — its own cross-link into Menu. ---
    await page.getByRole("link", { name: "Add menu items →" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("8");
    await page.getByRole("main").getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // --- Back on Dashboard: the same in-place state now reflects the change live, no redirect
    // needed, and Publish is enabled without ever having visited /setup. ---
    await page.goto("http://localhost:5174/");
    await expect(page.getByText("4 of 4 ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled();
    await page.getByRole("button", { name: "Publish restaurant" }).click();

    // --- Publishing transitions Dashboard straight to its normal operating-state metrics view,
    // in place — still no /setup redirect anywhere in this entire flow. ---
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Here's how the restaurant is doing right now.")).toBeVisible();
  });
});

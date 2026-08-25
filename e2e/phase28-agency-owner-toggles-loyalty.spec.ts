import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 28 — real, browser-driven proof of four new journeys:
 * 1. The agency signup wizard (Choose Plan -> Create Account -> Agency Info -> Review -> Start
 *    Trial) at /start, sequencing existing endpoints behind a new UI.
 * 2. An agency provisioning a business owner directly (provisioningMode: direct) — the returned
 *    temporary password logs the owner in, and the app forces a real password change before
 *    anything else is reachable.
 * 3. The Kitchen/Staff restaurant-level feature toggles — nav disappears, the page itself shows a
 *    friendly disabled state, and re-enabling restores it.
 * 4. A real loyalty reward, created by the owner, browsed and redeemed by a customer through
 *    checkout — never a raw DB mutation to fake the redemption.
 */

test.describe.serial("agency signup wizard (Phase 28)", () => {
  test("choose a plan, create an account, create an agency, review, and start a real trial", async ({ page }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();

    await page.goto("http://localhost:5174/start");
    await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Agency", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByLabel("Full name").fill("Wizard Agency Owner");
    await page.getByLabel("Email").fill(`wizard-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("WizardOwner1!");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Tell us about your agency" })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Agency name").fill(`Wizard Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`wizard-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`wizard-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Review & start your trial" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Trial length")).toBeVisible();
    await expect(page.getByText("After your trial ends")).toBeVisible();
    await page.getByRole("button", { name: /Start .*trial/ }).click();

    // Lands on the real agency dashboard, with a real subscription now attached.
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });
    await expect(page.getByText(`Wizard Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe.serial("agency-provisioned owner direct access (Phase 28)", () => {
  test("agency creates owner access directly; the temporary password forces a real password change before anything else works", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();

    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Direct Mode Agency Owner");
    await page.getByLabel("Email").fill(`direct-mode-agency-${stamp}@test.local`);
    await page.getByLabel("Password").fill("DirectModeAgency1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await page.getByLabel("Agency name").fill(`Direct Mode Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`direct-mode-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`direct-mode-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Direct Mode Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Businesses", exact: true }).click();
    await page.getByRole("button", { name: "New business" }).click();
    await page.getByLabel("Create owner access now", { exact: false }).check();
    await page.getByLabel("Business name").fill(`Direct Mode Client ${stamp}`);
    await page.getByLabel("Business slug").fill(`direct-mode-client-${stamp}`);
    await page.getByLabel("First location name").fill(`Direct Mode Location ${stamp}`);
    await page.getByLabel("Location slug").fill(`direct-mode-location-${stamp}`);
    await page.getByLabel("Owner full name").fill("Direct Mode Client Owner");
    const ownerEmail = `direct-mode-client-owner-${stamp}@test.local`;
    await page.getByLabel("Owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create business & owner access" }).click();

    await expect(page.getByText(/Owner access created/i)).toBeVisible({ timeout: 10_000 });
    const passwordCode = page.locator("code");
    await expect(passwordCode).toBeVisible();
    const temporaryPassword = (await passwordCode.textContent())!.trim();
    expect(temporaryPassword.length).toBeGreaterThan(8);

    // --- The owner logs in with that exact temporary password, in a fresh session. ---
    await page.context().clearCookies();
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.locator('input[type="password"]').fill(temporaryPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Forced to the password-change screen — never the normal dashboard.
    await expect(page).toHaveURL(/\/force-password-change$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();

    await page.getByLabel("Temporary password").fill(temporaryPassword);
    await page.getByLabel("New password", { exact: true }).fill("RealOwnerPassword1!");
    await page.getByLabel("Confirm new password").fill("RealOwnerPassword1!");
    await page.getByRole("button", { name: /Set password/ }).click();

    // Now reaches the real dashboard, and the temporary password no longer works.
    await expect(page).not.toHaveURL(/\/force-password-change$/, { timeout: 10_000 });

    await page.context().clearCookies();
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.locator('input[type="password"]').fill(temporaryPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Invalid email or password/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe.serial("Kitchen / Staff feature toggles (Phase 28)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("disabling Kitchen and Staff hides their nav items and shows a disabled-state page; re-enabling restores both", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-toggles-${stamp}`;
    const ownerEmail = `e2e-toggles-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(`E2E Toggles ${stamp}`);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Toggles Owner");
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
    await page.locator('input[type="password"]').fill("TogglesOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/setup$/, { timeout: 10_000 });

    // Both nav items are visible by default (kitchenEnabled/staffEnabled default true).
    await expect(page.getByRole("link", { name: "Kitchen", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Staff", exact: true })).toBeVisible();

    // --- Disable both. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Ordering" }).click();
    await page.locator("label", { hasText: "Kitchen operations" }).locator('input[type="checkbox"]').uncheck();
    await page.locator("label", { hasText: "Staff management" }).locator('input[type="checkbox"]').uncheck();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("link", { name: "Kitchen", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);

    // Direct navigation still shows a friendly disabled state, not a crash or a 403 page.
    await page.goto("http://localhost:5174/kitchen");
    await expect(page.getByText(/Kitchen operations are turned off/i)).toBeVisible({ timeout: 10_000 });
    await page.goto("http://localhost:5174/staff");
    await expect(page.getByText(/Staff management is turned off/i)).toBeVisible({ timeout: 10_000 });

    // --- Re-enable both. ---
    await page.goto("http://localhost:5174/settings");
    await page.getByRole("button", { name: "Ordering" }).click();
    await page.locator("label", { hasText: "Kitchen operations" }).locator('input[type="checkbox"]').check();
    await page.locator("label", { hasText: "Staff management" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("link", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Staff", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Kitchen", exact: true }).click();
    await expect(page.getByText(/Kitchen operations are turned off/i)).toHaveCount(0);
  });
});

test.describe.serial("loyalty reward redemption (Phase 28)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("owner creates a reward; customer earns points, browses the real reward catalog, and redeems it at checkout", async ({ browser }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slug = `e2e-loyalty-reward-${stamp}`;
    const restaurantName = `E2E Loyalty Reward ${stamp}`;
    const ownerEmail = `e2e-loyalty-reward-owner-${stamp}@test.local`;
    const itemName = `Reward Burger ${stamp}`;
    const categoryName = `Reward Category ${stamp}`;
    const customerEmail = `e2e-loyalty-reward-customer-${stamp}@test.local`;
    const rewardName = `Free Side ${stamp}`;

    const adminContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerPage = await customerContext.newPage();
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();

    try {
      await adminPage.goto("http://localhost:5174/login");
      await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
      await adminPage.locator('input[type="password"]').fill("Admin123!");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await expect(adminPage).toHaveURL(/\/platform$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Restaurants" }).click();
      await adminPage.getByRole("button", { name: "Create restaurant" }).click();
      await adminPage.getByLabel("Name", { exact: true }).fill(restaurantName);
      await adminPage.getByLabel("Slug").fill(slug);
      await adminPage.getByLabel("Full name").fill("Reward Owner");
      await adminPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await adminPage.getByRole("button", { name: "Create restaurant & send invite" }).click();
      await expect(adminPage.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await conn.collection("users").updateOne(
        { email: ownerEmail },
        { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      await adminPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await adminPage.locator('input[type="password"]').fill("RewardOwner123!");
      await adminPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(adminPage).toHaveURL(/\/setup$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Menu", exact: true }).click();
      await adminPage.getByPlaceholder("New category name").fill(categoryName);
      await adminPage.getByRole("button", { name: "Add category" }).click();
      await expect(adminPage.locator("li", { hasText: categoryName })).toBeVisible();
      await adminPage.getByRole("button", { name: "+ Add menu item" }).click();
      await adminPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
      await adminPage.getByPlaceholder("Base price").fill("100");
      await adminPage.getByRole("combobox").selectOption({ label: categoryName });
      await adminPage.getByRole("button", { name: "Create item & continue" }).click();
      await expect(adminPage.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
      await adminPage.getByRole("button", { name: "Done" }).click();

      await adminPage.getByRole("link", { name: "Setup" }).click();
      await expect(adminPage.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
      await adminPage.getByRole("button", { name: "Publish restaurant" }).click();
      await expect(adminPage.getByText("Published")).toBeVisible({ timeout: 10_000 });

      // --- Owner creates a real, named reward. ---
      await adminPage.getByRole("link", { name: "Loyalty" }).click();
      await adminPage.getByRole("button", { name: "New reward" }).click();
      await adminPage.getByPlaceholder("Name (e.g. Free drink)").fill(rewardName);
      await adminPage.getByPlaceholder("Points").fill("50");
      await adminPage.getByRole("button", { name: "Add" }).click();
      await expect(adminPage.getByText(rewardName)).toBeVisible({ timeout: 10_000 });

      // --- Customer earns 100 points from a $100 order (1pt per currency unit). ---
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("Reward Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("RewardCustomer1!");
      const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
      await customerPage.getByRole("button", { name: "Create account" }).click();
      expect((await registerRes).status()).toBe(201);

      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByRole("heading", { name: restaurantName })).toBeVisible({ timeout: 10_000 });
      await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();
      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

      // --- Add a new item to cart for the second order, THEN browse and redeem the real reward. ---
      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();

      await customerPage.goto(`http://localhost:5173/r/${slug}/loyalty`);
      await expect(customerPage.getByText(rewardName)).toBeVisible({ timeout: 10_000 });
      await customerPage.getByRole("button", { name: "Redeem" }).click();

      // Lands back on the cart (same cart, item still there) with the reward's point cost
      // pre-filled into the existing redemption control.
      await expect(customerPage).toHaveURL(/\/cart$/, { timeout: 10_000 });
      await expect(customerPage.getByText(/Loyalty points \(50\)/)).toBeVisible({ timeout: 10_000 });

      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      const orderRes = await customerPage.waitForResponse((r) => /\/orders\/[a-f0-9]+$/.test(r.url()) && r.request().method() === "GET");
      const orderBody = await orderRes.json();
      expect(orderBody.data.order.loyaltyPointsRedeemed).toBe(50);
    } finally {
      await adminContext.close();
      await customerContext.close();
      await conn.close();
    }
  });
});

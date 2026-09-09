import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 60 — the one continuous proof the Phase 60 audit found missing: everything AFTER
 * owner-self-serve-signup.spec.ts's own stopping point (account created, email verified, trial
 * started) through to a real customer completing a real order.
 *
 * owner-self-serve-signup.spec.ts (Phase 44) already proves signup -> verify -> trial in full and
 * is deliberately not re-driven step-for-step here beyond what's needed to reach a usable account —
 * this test's own job is the previously-unproven back half: a self-serve-provisioned restaurant
 * (createBusinessSelfServe, NOT platform-admin-provisioned) can add a menu, publish, and actually
 * sell something. restaurant-provisioning-golden-path.spec.ts already proves that back half for a
 * PLATFORM-ADMIN-provisioned restaurant; this test exists because that is a materially different
 * code path (business.controller.ts's createBusinessSelfServe vs. platformRestaurant.controller.ts's
 * admin-provisioning flow) and the Phase 60 brief is explicit that a working piece elsewhere must
 * not be assumed to cover this one.
 *
 * Same documented exception as owner-self-serve-signup.spec.ts: the verification link only ever
 * leaves the server via a real outbound email (ConsoleEmailProvider just logs it), so this test
 * writes its own token hash directly to the same MongoDB the dev API uses, then drives the real
 * /verify-email page with it — everything else goes through the real UI.
 */
test.describe.serial("owner self-serve launch journey (Phase 60)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("self-serve signup -> add menu -> publish -> live storefront -> real customer order -> order visible to owner", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const ownerEmail = `e2e-launch-owner-${stamp}@test.local`;
    const restaurantName = `E2E Launch Bistro ${stamp}`;
    const slug = `e2e-launch-${stamp}`;
    const itemName = `Launch Special ${stamp}`;
    const categoryName = `Launch Category ${stamp}`;
    const customerEmail = `e2e-launch-customer-${stamp}@test.local`;

    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      // --- Self-serve signup through to an authenticated trial account (mechanics identical to
      // owner-self-serve-signup.spec.ts, which is the actual source of truth for this sequence). ---
      await ownerPage.goto("http://localhost:5174/signup");
      await expect(ownerPage.getByText("Owner — Starter")).toBeVisible({ timeout: 10_000 });
      await ownerPage.getByRole("button", { name: "Continue" }).click();

      await expect(ownerPage.getByRole("heading", { name: "Create your account" })).toBeVisible();
      await ownerPage.getByLabel("Full name").fill("E2E Launch Owner");
      await ownerPage.getByLabel("Email").fill(ownerEmail);
      await ownerPage.getByLabel("Password").fill("LaunchOwner123!");
      await ownerPage.getByRole("button", { name: "Continue" }).click();

      await expect(ownerPage.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 10_000 });
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const updateResult = await db.collection("users").updateOne(
        { email: ownerEmail },
        { $set: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      expect(updateResult.matchedCount).toBe(1);

      await ownerPage.goto(`http://localhost:5174/verify-email?token=${rawToken}`);
      await expect(ownerPage.getByRole("heading", { name: "Email verified" })).toBeVisible({ timeout: 10_000 });
      await ownerPage.getByRole("link", { name: "Continue setting up my restaurant" }).click();

      await expect(ownerPage.getByRole("heading", { name: "Tell us about your restaurant" })).toBeVisible({ timeout: 10_000 });
      await ownerPage.getByLabel("Restaurant name").fill(restaurantName);
      const slugField = ownerPage.getByLabel("Web address");
      await slugField.fill(slug);
      await ownerPage.getByRole("button", { name: "Continue" }).click();

      await expect(ownerPage.getByRole("heading", { name: "Review & start your trial" })).toBeVisible({ timeout: 10_000 });
      await ownerPage.getByRole("button", { name: /Start \d+-day trial/ }).click();

      await expect(ownerPage).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
      await expect(ownerPage.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible({ timeout: 10_000 });
      // Publish is disabled until the menu check passes — proves this test isn't relying on a menu
      // that already existed some other way.
      await expect(ownerPage.getByRole("button", { name: "Publish restaurant" })).toBeDisabled();

      // --- Owner builds a real menu through the real Menu page (createBusinessSelfServe's own
      // restaurant, not a seeded one). ---
      await ownerPage.getByRole("link", { name: "Menu", exact: true }).click();
      await ownerPage.getByPlaceholder("New category name").fill(categoryName);
      await ownerPage.getByRole("button", { name: "Add category" }).click();
      await expect(ownerPage.locator("li", { hasText: categoryName })).toBeVisible();

      await ownerPage.getByRole("button", { name: "+ Add menu item" }).click();
      await ownerPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
      await ownerPage.getByPlaceholder("Base price").fill("11");
      await ownerPage.getByRole("combobox").selectOption({ label: categoryName });
      await ownerPage.getByRole("button", { name: "Create item & continue" }).click();
      await expect(ownerPage.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
      await ownerPage.getByRole("button", { name: "Done" }).click();

      // --- Publish, via the real Setup page (matches restaurant-provisioning-golden-path.spec.ts's
      // already-proven publish assertions). ---
      await ownerPage.getByRole("link", { name: "Setup" }).click();
      await expect(ownerPage.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
      await ownerPage.getByRole("button", { name: "Publish restaurant" }).click();
      await expect(ownerPage.getByText("Published")).toBeVisible({ timeout: 10_000 });
      await expect(ownerPage.getByRole("link", { name: "View live storefront" })).toBeVisible();

      // --- A real, anonymous-until-now customer discovers the live storefront by its real slug
      // (no online-payment account was ever connected — this proves the cash/pay-at-restaurant
      // default path a brand-new, BYOC-less restaurant actually ships with). ---
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Launch Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("LaunchCustomer1!");
      const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
      await customerPage.getByRole("button", { name: "Create account" }).click();
      expect((await registerRes).status()).toBe(201);

      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByRole("heading", { name: restaurantName })).toBeVisible({ timeout: 10_000 });
      const itemRow = customerPage.locator("li", { hasText: itemName });
      await itemRow.getByRole("button", { name: "Add to cart" }).click();

      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible();
      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(customerPage.getByText("Order placed successfully!")).toBeVisible();
      const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
      const orderNumber = heading.match(/ORD-\d+/)![0];

      // --- The order is visible to the owner in their own, real Orders page — proving the whole
      // provisioning-to-order loop lands in the SAME tenant this owner actually owns. ---
      await ownerPage.getByRole("link", { name: "Orders" }).click();
      await expect(ownerPage.getByRole("group", { name: `Order ${orderNumber}` })).toBeVisible({ timeout: 10_000 });
    } finally {
      await ownerContext.close();
      await customerContext.close();
    }
  });
});

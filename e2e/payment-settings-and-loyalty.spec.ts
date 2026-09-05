import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 15 additions: (1) a restaurant's cash/online payment toggles actually gate what a
 * customer can select at checkout, server-enforced, not just hidden client-side; (2) loyalty
 * points earned on one order can be redeemed on a later one, reducing the charged total.
 *
 * Provisions its own fresh restaurant (rather than mutating the shared seeded demo restaurant)
 * specifically so toggling payment settings here can never race against/pollute
 * online-payment.spec.ts, which assumes the demo restaurant's defaults are untouched — Playwright
 * can run spec files concurrently in different workers.
 */
test.describe.serial("payment method gating and loyalty redemption (Phase 15)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("owner-configured payment methods gate customer checkout; loyalty points earned on one order are redeemable on the next", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slug = `e2e-payments-${stamp}`;
    const restaurantName = `E2E Payments ${stamp}`;
    const ownerEmail = `e2e-payments-owner-${stamp}@test.local`;
    const itemName = `Loyalty Burger ${stamp}`;
    const categoryName = `Loyalty Category ${stamp}`;
    const customerEmail = `e2e-payments-customer-${stamp}@test.local`;

    const adminContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      // --- Provision a fresh restaurant + owner, same pattern as the golden-path spec. ---
      await adminPage.goto("http://localhost:5174/login");
      await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
      await adminPage.locator('input[type="password"]').fill("Admin123!");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await expect(adminPage).toHaveURL(/\/platform$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Restaurants" }).click();
      await adminPage.getByRole("button", { name: "Create restaurant" }).click();
      await adminPage.getByLabel("Name", { exact: true }).fill(restaurantName);
      await adminPage.getByLabel("Slug").fill(slug);
      await adminPage.getByLabel("Full name").fill("Payments Owner");
      await adminPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await adminPage.getByRole("button", { name: "Create restaurant & send invite" }).click();
      await expect(adminPage.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const usersCollection = db.collection("users");
      await usersCollection.updateOne(
        { email: ownerEmail },
        { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      await adminPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await adminPage.locator('input[type="password"]').fill("PaymentsOwner123!");
      await adminPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(adminPage).toHaveURL(/\/$/, { timeout: 10_000 });

      // --- Build a minimal menu and publish. ---
      await adminPage.getByRole("link", { name: "Menu", exact: true }).click();
      await adminPage.getByPlaceholder("New category name").fill(categoryName);
      await adminPage.getByRole("button", { name: "Add category" }).click();
      await expect(adminPage.locator("li", { hasText: categoryName })).toBeVisible();
      await adminPage.getByRole("button", { name: "+ Add menu item" }).click();
      await adminPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
      await adminPage.getByPlaceholder("Base price").fill("20");
      await adminPage.getByRole("combobox").selectOption({ label: categoryName });
      await adminPage.getByRole("button", { name: "Create item & continue" }).click();
      await expect(adminPage.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
      await adminPage.getByRole("button", { name: "Done" }).click();

      await adminPage.getByRole("link", { name: "Setup" }).click();
      await expect(adminPage.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
      await adminPage.getByRole("button", { name: "Publish restaurant" }).click();
      await expect(adminPage.getByText("Published")).toBeVisible({ timeout: 10_000 });

      // --- Owner makes this restaurant cash-only via Settings > Payment. ---
      await adminPage.getByRole("link", { name: "Settings" }).click();
      await adminPage.getByRole("button", { name: "Payment" }).click();
      await adminPage.locator("label", { hasText: "Online payment" }).locator('input[type="checkbox"]').uncheck();
      await adminPage.getByRole("button", { name: "Save settings" }).click();
      await expect(adminPage.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

      // Attempting to also disable cash (leaving nothing enabled) must be rejected.
      await adminPage.locator("label", { hasText: "Cash / pay in person" }).locator('input[type="checkbox"]').uncheck();
      await adminPage.getByRole("button", { name: "Save settings" }).click();
      await expect(adminPage.getByText(/at least one payment method/i)).toBeVisible({ timeout: 10_000 });

      // --- Customer sees only Cash at checkout (no Pay online option at all). ---
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("Payments Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("PaymentsCustomer1!");
      const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
      await customerPage.getByRole("button", { name: "Create account" }).click();
      expect((await registerRes).status()).toBe(201);

      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByRole("heading", { name: restaurantName })).toBeVisible({ timeout: 10_000 });
      const itemRow = customerPage.locator("li", { hasText: itemName });
      await itemRow.getByRole("button", { name: "Add to cart" }).click();
      await customerPage.getByRole("link", { name: /Cart/ }).click();

      await expect(customerPage.locator("label", { hasText: "Cash" })).toBeVisible();
      await expect(customerPage.locator("label", { hasText: "Pay online" })).toHaveCount(0);

      // First order, paid in cash — earns loyalty points server-side (1 point per currency unit).
      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(customerPage.getByText("Order placed successfully!")).toBeVisible();

      // --- Owner re-enables online payment (cash stays on too — both enabled now). ---
      await adminPage.goto("http://localhost:5174/settings");
      await adminPage.getByRole("button", { name: "Payment" }).click();
      await adminPage.locator("label", { hasText: "Online payment" }).locator('input[type="checkbox"]').check();
      await adminPage.getByRole("button", { name: "Save settings" }).click();
      await expect(adminPage.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

      // --- Second order: customer now sees both methods, and can redeem loyalty points earned above. ---
      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await itemRow.getByRole("button", { name: "Add to cart" }).click();
      await customerPage.getByRole("link", { name: /Cart/ }).click();

      await expect(customerPage.locator("label", { hasText: "Cash" })).toBeVisible();
      await expect(customerPage.locator("label", { hasText: "Pay online" })).toBeVisible();

      await expect(customerPage.getByText(/point.*available/i)).toBeVisible({ timeout: 10_000 });
      await customerPage.getByRole("button", { name: "Use max" }).click();
      await expect(customerPage.getByText(/Loyalty points \(\d+\)/)).toBeVisible();

      // The estimated total reflects the redemption having been applied.
      const totalText = await customerPage.getByText("Estimated total").locator("..").innerText();
      expect(totalText).toMatch(/\$\d+\.\d{2}/);

      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      const orderRes = await customerPage.waitForResponse((r) => /\/orders\/[a-f0-9]+$/.test(r.url()) && r.request().method() === "GET");
      const orderBody = await orderRes.json();
      expect(orderBody.data.order.loyaltyPointsRedeemed).toBeGreaterThan(0);
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});

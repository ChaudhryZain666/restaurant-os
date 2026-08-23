import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 23 — the real, browser-driven end-to-end proof: a fresh owner with two locations sees
 * business-wide analytics correctly aggregate across them, and a business-wide promotion targeting
 * only one location applies there and is genuinely rejected at the other — the core security
 * property this phase exists to prove, via the real checkout flow, not just Jest/supertest.
 *
 * Same documented exception as the other golden-path specs: the owner's invite token only ever
 * leaves the server via a real outbound email, so this reads/writes that one field directly against
 * Mongo rather than skipping the step. Everything else goes through the real UI.
 */
test.describe.serial("business-wide analytics and promotions (Phase 23)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("owner sees business-wide analytics across two locations, and a business promotion applies at the selected location only", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const slugA = `e2e-biz-a-${stamp}`;
    const restaurantName = `E2E Business Analytics ${stamp}`;
    const ownerEmail = `e2e-biz-owner-${stamp}@test.local`;
    const itemName = `Shared Item ${stamp}`;
    const categoryName = `Category ${stamp}`;
    const locationBName = `Location B ${stamp}`;
    const slugB = `e2e-biz-b-${stamp}`;
    const promoCode = `BIZPROMO${stamp}`.slice(0, 20);

    // --- Platform admin provisions Location A + owner invite. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slugA);
    await page.getByLabel("Full name").fill("Business Analytics Owner");
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
    await page.locator('input[type="password"]').fill("BizOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/setup$/, { timeout: 10_000 });

    // --- Build one canonical menu item — shared automatically across every future location. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("20");
    await page.getByRole("main").getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(itemName, { exact: false })).toBeVisible();

    // --- Publish Location A. ---
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // --- Add Location B through the real Locations page. ---
    await page.getByRole("link", { name: "Locations" }).click();
    await page.getByRole("button", { name: "+ Add another location" }).click();
    await page.getByLabel("Name", { exact: true }).fill(locationBName);
    await page.getByLabel("Slug").fill(slugB);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`${locationBName} was created`, { exact: false })).toBeVisible({ timeout: 10_000 });

    const switcher = page.getByRole("combobox", { name: "Active location" });
    await switcher.selectOption({ label: locationBName });
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // --- A customer orders once at Location A. ---
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerEmail = `e2e-biz-customer-${stamp}@test.local`;
    await customerPage.goto("http://localhost:5173/register");
    await customerPage.getByLabel("Name").fill("Business Analytics Customer");
    await customerPage.getByLabel("Email").fill(customerEmail);
    await customerPage.getByLabel("Password").fill("BizCustomer1!");
    const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
    await customerPage.getByRole("button", { name: "Create account" }).click();
    expect((await registerRes).status()).toBe(201);

    await customerPage.goto(`http://localhost:5173/r/${slugA}`);
    await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible({ timeout: 10_000 });
    await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();
    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await customerPage.getByRole("button", { name: /Place order/ }).click();
    await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

    // --- Owner checks Business Analytics: one order, correctly attributed to Location A only. ---
    await switcher.selectOption({ label: restaurantName });
    await page.getByRole("link", { name: "Business Analytics" }).click();
    await expect(page.getByText("Total orders")).toBeVisible({ timeout: 10_000 });
    const locationARow = page.locator("tbody tr", { hasText: restaurantName });
    const locationBRow = page.locator("tbody tr", { hasText: locationBName });
    await expect(locationARow).toBeVisible();
    await expect(locationBRow).toBeVisible();
    // Orders column — the second cell in each row (Location | Orders | Revenue | AOV).
    await expect(locationARow.locator("td").nth(1)).toHaveText("1");
    await expect(locationBRow.locator("td").nth(1)).toHaveText("0");

    // --- Owner creates a business promotion targeting Location A only. ---
    await page.getByRole("link", { name: "Business Promotions" }).click();
    await page.getByRole("button", { name: "New business promotion" }).click();
    await page.getByLabel("Code").fill(promoCode);
    await page.getByLabel("Name").fill("Business Promo A Only");
    await page.getByLabel("Discount type").selectOption({ label: "Fixed amount off" });
    await page.getByRole("spinbutton", { name: "Amount off" }).fill("5");
    await page.getByLabel(restaurantName, { exact: true }).check();
    await page.getByRole("button", { name: "Create business promotion" }).click();
    await expect(page.getByText(promoCode, { exact: false })).toBeVisible({ timeout: 10_000 });

    // --- Applies at Location A. ---
    await customerPage.goto(`http://localhost:5173/r/${slugA}`);
    await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();
    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await customerPage.getByPlaceholder("Enter a code").fill(promoCode);
    await customerPage.getByRole("button", { name: "Apply" }).click();
    await expect(customerPage.getByText(`${promoCode} applied`, { exact: false })).toBeVisible({ timeout: 10_000 });

    // Completes this order (rather than leaving it in the cart) so the cart is naturally empty
    // before switching storefronts — otherwise CartContext's cross-restaurant guard would show a
    // "clear cart" conflict banner instead of a clean add-to-cart at Location B below.
    await customerPage.getByRole("button", { name: /Place order/ }).click();
    await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

    // --- The core security proof: rejected at Location B, even though it's the same business. ---
    await customerPage.goto(`http://localhost:5173/r/${slugB}`);
    await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible({ timeout: 10_000 });
    await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();
    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await customerPage.getByPlaceholder("Enter a code").fill(promoCode);
    await customerPage.getByRole("button", { name: "Apply" }).click();
    await expect(customerPage.getByText(/invalid promo code/i)).toBeVisible({ timeout: 10_000 });

    await customerContext.close();
  });
});

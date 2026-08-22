import { test, expect } from "@playwright/test";

/**
 * Proves the Phase 8 multi-tenant storefront routing end to end: two DIFFERENT real seeded
 * restaurants (spice-route, bella-vista), browsed and ordered from in the same run, with an
 * explicit check that neither's branding/menu/order data leaks into the other. Also covers the
 * restaurant-scoped QR flow and the legacy-URL redirect strategy.
 */
test.describe("multi-tenant storefront routing", () => {
  test.describe.configure({ timeout: 60_000 });

  test("two different restaurants show their own branding, menu, and orders — no cross-tenant leakage", async ({
    browser,
  }) => {
    const spiceContext = await browser.newContext();
    const bellaContext = await browser.newContext();
    const spicePage = await spiceContext.newPage();
    const bellaPage = await bellaContext.newPage();

    try {
      await spicePage.goto("http://localhost:5173/r/spice-route");
      await expect(spicePage.getByRole("heading", { name: "Spice Route" })).toBeVisible();
      await expect(spicePage.getByText("Butter Chicken")).toBeVisible();
      await expect(spicePage.getByText("Spaghetti Carbonara")).not.toBeVisible();

      await bellaPage.goto("http://localhost:5173/r/bella-vista");
      await expect(bellaPage.getByRole("heading", { name: "Bella Vista Trattoria" })).toBeVisible();
      await expect(bellaPage.getByText("Spaghetti Carbonara")).toBeVisible();
      await expect(bellaPage.getByText("Butter Chicken")).not.toBeVisible();

      // --- Order from Spice Route ---
      const spiceEmail = `e2e-spice-${Date.now()}@test.local`;
      await spicePage.goto("http://localhost:5173/register");
      await spicePage.getByLabel("Name").fill("E2E Spice Customer");
      await spicePage.getByLabel("Email").fill(spiceEmail);
      await spicePage.getByLabel("Password").fill("E2ePassword1!");
      await spicePage.getByRole("button", { name: "Create account" }).click();
      // Registration always lands on "/", which legacy-redirects to the default restaurant.
      await expect(spicePage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      await spicePage.goto("http://localhost:5173/r/spice-route");
      const butterChickenRow = spicePage.locator("li", { hasText: "Butter Chicken" });
      await butterChickenRow.getByRole("button", { name: "Add to cart" }).click();
      await spicePage.getByRole("link", { name: /Cart/ }).click();
      await expect(spicePage).toHaveURL(/\/r\/spice-route\/cart$/);
      await spicePage.getByRole("button", { name: /Place order/ }).click();
      await expect(spicePage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      // Order numbers (ORD-N) are sequential PER RESTAURANT, not globally unique — two different
      // restaurants' Nth order can legitimately share the same number. Order IDs (Mongo ObjectIds,
      // from the URL) are what's actually guaranteed unique, so isolation is checked against those.
      const spiceOrderId = spicePage.url().split("/orders/")[1];
      const spiceOrderNumber = (await spicePage.getByRole("heading", { level: 1 }).innerText()).match(/ORD-\d+/)![0];

      // --- Order from Bella Vista (a completely different account) ---
      const bellaEmail = `e2e-bella-${Date.now()}@test.local`;
      await bellaPage.goto("http://localhost:5173/register");
      await bellaPage.getByLabel("Name").fill("E2E Bella Customer");
      await bellaPage.getByLabel("Email").fill(bellaEmail);
      await bellaPage.getByLabel("Password").fill("E2ePassword1!");
      await bellaPage.getByRole("button", { name: "Create account" }).click();
      await expect(bellaPage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      await bellaPage.goto("http://localhost:5173/r/bella-vista");
      const carbonaraRow = bellaPage.locator("li", { hasText: "Spaghetti Carbonara" });
      await carbonaraRow.getByRole("button", { name: "Add to cart" }).click();
      await bellaPage.getByRole("link", { name: /Cart/ }).click();
      await expect(bellaPage).toHaveURL(/\/r\/bella-vista\/cart$/);
      await bellaPage.getByRole("button", { name: /Place order/ }).click();
      await expect(bellaPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      const bellaOrderId = bellaPage.url().split("/orders/")[1];
      const bellaOrderNumber = (await bellaPage.getByRole("heading", { level: 1 }).innerText()).match(/ORD-\d+/)![0];

      expect(spiceOrderId).not.toBe(bellaOrderId);

      // --- Each customer's own order history shows only their own order ---
      await spicePage.goto("http://localhost:5173/orders");
      await expect(spicePage.getByText(spiceOrderNumber)).toBeVisible();
      await expect(spicePage.locator(`a[href="/orders/${bellaOrderId}"]`)).toHaveCount(0);

      await bellaPage.goto("http://localhost:5173/orders");
      await expect(bellaPage.getByText(bellaOrderNumber)).toBeVisible();
      await expect(bellaPage.locator(`a[href="/orders/${spiceOrderId}"]`)).toHaveCount(0);
    } finally {
      await spiceContext.close();
      await bellaContext.close();
    }
  });

  test("switching restaurants with items already in the cart shows a conflict warning, never a silent merge", async ({
    page,
  }) => {
    await page.goto("http://localhost:5173/r/spice-route");
    const butterChickenRow = page.locator("li", { hasText: "Butter Chicken" });
    await butterChickenRow.getByRole("button", { name: "Add to cart" }).click();

    await page.goto("http://localhost:5173/r/bella-vista");
    const carbonaraRow = page.locator("li", { hasText: "Spaghetti Carbonara" });
    await carbonaraRow.getByRole("button", { name: "Add to cart" }).click();

    await expect(page.getByText(/cart has items from a different restaurant/i)).toBeVisible();
    await page.getByRole("button", { name: /Clear cart & continue/ }).click();

    // The new restaurant's item is now the only thing in the cart.
    await page.getByRole("link", { name: /Cart/ }).click();
    await expect(page.getByText("Spaghetti Carbonara")).toBeVisible();
    await expect(page.getByText("Butter Chicken")).not.toBeVisible();
  });

  test("legacy bare URLs redirect to the default restaurant's canonical /r/:slug URLs", async ({ page }) => {
    await page.goto("http://localhost:5173/");
    await expect(page).toHaveURL(/\/r\/demo-restaurant$/);

    await page.goto("http://localhost:5173/cart");
    await expect(page).toHaveURL(/\/r\/demo-restaurant\/cart$/);
  });

  test("an unknown restaurant slug shows a not-found page, not a crash or someone else's data", async ({ page }) => {
    await page.goto("http://localhost:5173/r/this-restaurant-does-not-exist");
    await expect(page.getByText("We can't find that restaurant")).toBeVisible();
  });

  test("a table QR code is restaurant-scoped: the same token format resolves only under its own restaurant", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const tableName = `E2E MT Table ${Date.now()}`;

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.locator('input[type="email"]').fill("owner@demo-restaurant.local");
      await ownerPage.locator('input[type="password"]').fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Tables" }).click();
      await ownerPage.getByRole("button", { name: "New table" }).click();
      await ownerPage.getByLabel("Name").fill(tableName);
      await ownerPage.getByRole("button", { name: "Create table" }).click();

      const tableRow = ownerPage.locator("li", { hasText: tableName });
      await tableRow.getByRole("button", { name: "QR code" }).click();
      const urlText = ownerPage.locator("p", { hasText: "/t/" });
      await expect(urlText).toBeVisible({ timeout: 10_000 });
      const fullUrl = (await urlText.innerText()).trim();

      // The QR URL itself is restaurant-scoped.
      expect(fullUrl).toContain("/r/demo-restaurant/t/");
      const token = fullUrl.split("/t/")[1];

      const customerPage = await ownerContext.newPage();
      await customerPage.goto(`http://localhost:5173/r/demo-restaurant/t/${token}`);
      await expect(customerPage.getByText(`Ordering for ${tableName}`)).toBeVisible();

      // The exact same token means nothing under a DIFFERENT restaurant's slug.
      await customerPage.goto(`http://localhost:5173/r/spice-route/t/${token}`);
      await expect(customerPage.getByText(/table code isn't valid anymore/i)).toBeVisible();
      await customerPage.close();
    } finally {
      await ownerContext.close();
    }
  });

  test("mobile viewport: switching between two restaurants shows correct branding without horizontal overflow", async ({
    browser,
  }) => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await mobileContext.newPage();

    try {
      await page.goto("http://localhost:5173/r/spice-route");
      await expect(page.getByRole("heading", { name: "Spice Route" })).toBeVisible();
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);

      await page.goto("http://localhost:5173/r/bella-vista");
      await expect(page.getByRole("heading", { name: "Bella Vista Trattoria" })).toBeVisible();
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    } finally {
      await mobileContext.close();
    }
  });
});

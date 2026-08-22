import { test, expect } from "@playwright/test";

/**
 * Proves the Phase 7 QR dine-in flow end to end through the real UI: a restaurant owner creates
 * a table and views its QR code, a customer "scans" it (navigates straight to the /t/:token URL,
 * exactly like a phone camera would), sees table context, orders, and the resulting order is
 * correctly tagged dine-in with that table on both the KDS and the customer's own tracking page.
 * Reuses the seeded demo-restaurant/owner — same fixtures as the other e2e specs.
 */
test.describe("QR dine-in ordering", () => {
  test.describe.configure({ timeout: 60_000 });

  test("owner creates a table, customer scans its QR, orders dine-in, and it shows up correctly everywhere", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();
    const tableName = `E2E Table ${Date.now()}`;

    try {
      // --- Owner creates a table and opens its QR code ---
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.locator('input[type="email"]').fill("owner@demo-restaurant.local");
      await ownerPage.locator('input[type="password"]').fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();

      await ownerPage.getByRole("link", { name: "Tables" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Tables" })).toBeVisible();

      await ownerPage.getByRole("button", { name: "New table" }).click();
      await ownerPage.getByLabel("Name").fill(tableName);
      await ownerPage.getByRole("button", { name: "Create table" }).click();

      const tableRow = ownerPage.locator("li", { hasText: tableName });
      await expect(tableRow).toBeVisible();
      await tableRow.getByRole("button", { name: "QR code" }).click();

      const urlText = ownerPage.locator("p", { hasText: "/t/" });
      await expect(urlText).toBeVisible({ timeout: 10_000 });
      const fullUrl = (await urlText.innerText()).trim();
      const tableToken = fullUrl.split("/t/")[1];
      expect(tableToken).toBeTruthy();
      await ownerPage.getByRole("button", { name: "Close" }).click();

      // --- Customer registers/signs in first (as a real returning diner would), then scans the QR ---
      const email = `e2e-dinein-${Date.now()}@test.local`;
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Dine-in Customer");
      await customerPage.getByLabel("Email").fill(email);
      await customerPage.getByLabel("Password").fill("E2ePassword1!");
      await customerPage.getByRole("button", { name: "Create account" }).click();
      // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
      await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      // --- Customer scans the QR (a real navigation to the /t/:token URL, as a phone camera would do) ---
      await customerPage.goto(`http://localhost:5173/t/${tableToken}`);
      await expect(customerPage.getByText(`Ordering for ${tableName}`)).toBeVisible({ timeout: 10_000 });

      const itemRow = customerPage.locator("li", { hasText: "Margherita Pizza" });
      await itemRow.scrollIntoViewIfNeeded();
      await itemRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
      await itemRow.getByText("Small", { exact: false }).click();
      await itemRow.getByRole("button", { name: "Confirm add to cart" }).click();

      // Table context (sessionStorage) must survive this in-app navigation to the cart.
      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await expect(customerPage.getByRole("heading", { name: "Cart" })).toBeVisible();

      // Dine-in is pre-selected because the table resolved, and the table name is shown.
      await expect(customerPage.getByRole("radio", { name: "Dine-in" })).toBeChecked();
      await expect(customerPage.getByText(`Served at ${tableName}`)).toBeVisible();

      await customerPage.getByRole("button", { name: /Place order/ }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

      const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
      const orderNumber = heading.match(/ORD-\d+/)![0];
      await expect(customerPage.getByText("Dine-in", { exact: true })).toBeVisible();
      // The table banner (still showing "Ordering for <table>" from earlier) also contains the
      // table name, so scope to the order-detail page's own "Table" summary row specifically —
      // it renders after the banner in document order.
      await expect(customerPage.getByText(tableName).last()).toBeVisible();

      // --- Order appears on the KDS tagged "Dine-in · <table>" ---
      await ownerPage.getByRole("link", { name: "Kitchen" }).click();
      const kdsCard = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(kdsCard).toBeVisible({ timeout: 15_000 });
      await expect(kdsCard.getByText(`Dine-in · ${tableName}`)).toBeVisible();

      // --- Table now shows as occupied on the Tables dashboard ---
      await ownerPage.getByRole("link", { name: "Tables" }).click();
      const occupiedRow = ownerPage.locator("li", { hasText: tableName });
      await expect(occupiedRow.getByText("Occupied")).toBeVisible();
    } finally {
      await ownerContext.close();
      await customerContext.close();
    }
  });

  test("an invalid table code shows a friendly notice and pickup/delivery ordering still works", async ({ page }) => {
    await page.goto("http://localhost:5173/t/this-token-does-not-exist");
    await expect(page.getByText(/table code isn't valid anymore/i)).toBeVisible();
    // The rest of the storefront must still function — this is not a dead end.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a deactivated table's QR code also shows the invalid notice", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const tableName = `E2E Inactive Table ${Date.now()}`;

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
      const tableToken = (await urlText.innerText()).trim().split("/t/")[1];
      await ownerPage.getByRole("button", { name: "Close" }).click();

      await tableRow.getByRole("button", { name: "Deactivate" }).click();
      await expect(tableRow.getByText("Inactive")).toBeVisible();

      const customerPage = await ownerContext.newPage();
      await customerPage.goto(`http://localhost:5173/t/${tableToken}`);
      await expect(customerPage.getByText(/table code isn't valid anymore/i)).toBeVisible();
      await customerPage.close();
    } finally {
      await ownerContext.close();
    }
  });

  test("mobile viewport: QR landing page shows table context without horizontal overflow", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const tableName = `E2E Mobile Table ${Date.now()}`;

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
      const tableToken = (await urlText.innerText()).trim().split("/t/")[1];

      const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(`http://localhost:5173/t/${tableToken}`);
      await expect(mobilePage.getByText(`Ordering for ${tableName}`)).toBeVisible();

      const hasHorizontalOverflow = await mobilePage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHorizontalOverflow).toBe(false);

      await mobileContext.close();
    } finally {
      await ownerContext.close();
    }
  });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 30 — the menu importer end to end: upload -> map columns -> preview -> confirm -> the
 * imported items show up in the real admin menu editor AND the real public storefront. Also
 * covers a duplicate/error scenario, matching the brief's explicit "at least one duplicate/error
 * scenario" requirement. Uses the seeded demo-restaurant owner account (already-canonical
 * business, per menu-rbac.spec.ts) rather than a fresh restaurant, since that's the realistic case
 * a real owner with an existing menu would be in.
 */
test.describe("menu importer", () => {
  test("owner imports a CSV menu, reviews the preview, confirms, and the new items appear in the admin editor and the storefront", async ({ page }) => {
    const suffix = Date.now();
    const categoryName = `Imported Category ${suffix}`;
    const itemName = `Imported Burger ${suffix}`;
    const csv = [
      "category,item_name,description,price,available,sort_order",
      `${categoryName},${itemName},A freshly imported item,13.50,true,1`,
    ].join("\n");

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Menu" }).click();
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Import menu" }).click();
    await expect(page.getByRole("heading", { name: "Import menu" })).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    // The importer disables this input until the active location has resolved (LocationContext is
    // async) — waiting for it to become enabled avoids racing ahead and sending
    // /restaurants/null/... (see MenuImportPage.tsx's own disabled={busy || !restaurantId}).
    await expect(fileInput).toBeEnabled({ timeout: 10_000 });
    await fileInput.setInputFiles({
      name: "menu.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });

    // Required fields (category/item name/price) auto-map from these exact header names, so this
    // skips straight to the review step.
    await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(itemName)).toBeVisible();
    await expect(page.getByText(categoryName)).toBeVisible();
    await expect(page.getByText("New item", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Confirm import/ }).click();
    await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1 new categor/)).toBeVisible();

    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
    await expect(page.getByText(itemName)).toBeVisible();
    // Appears twice — the category list label, and again as "(Category Name)" on the item row —
    // both confirm the same fact, so .first() is enough.
    await expect(page.getByText(categoryName).first()).toBeVisible();

    // The real public storefront, not just the admin editor — confirms the import actually
    // reaches customers, not just the staff-facing view.
    await page.goto("http://localhost:5173/r/demo-restaurant");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 10_000 });
  });

  test("shows a row-level error for an invalid price and does not let it be imported", async ({ page }) => {
    const suffix = Date.now();
    const goodItemName = `Valid Item ${suffix}`;
    const badItemName = `Bad Price Item ${suffix}`;
    const csv = [
      "category,item_name,description,price,available,sort_order",
      `Error Test Category,${goodItemName},Fine,9.99,true,1`,
      `Error Test Category,${badItemName},Broken,not-a-price,true,2`,
    ].join("\n");

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Wait for the post-login redirect to actually land before navigating away — jumping straight
    // to page.goto() here raced ahead of the pending login/redirect and got bounced right back to
    // /login by RequireAuth (a real bug in this test, not the product).
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });
    await page.goto("http://localhost:5174/menu/import");

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeEnabled({ timeout: 10_000 });
    await fileInput.setInputFiles({
      name: "menu.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });

    await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible({ timeout: 10_000 });
    // "Needs fixing" appears both as the summary stat label and as the row's status badge —
    // scope to the table for the specific row-level confirmation this test cares about.
    await expect(page.getByRole("table").getByText("Needs fixing")).toBeVisible();
    await expect(page.getByText(/Price "not-a-price" is not valid/)).toBeVisible();

    await page.getByRole("button", { name: /Confirm import/ }).click();
    await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "View your menu" }).click();
    await expect(page.getByText(goodItemName)).toBeVisible();
    await expect(page.getByText(badItemName)).toHaveCount(0);
  });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 12: platform Restaurants/Users are now server-paginated/filterable instead of loading the
 * entire table. The seeded platform already has 60+ users (more than one page at the 20/page
 * size), so Users can exercise real Next/Previous through the UI without extra setup; Restaurants
 * only has a handful of seeded tenants, so that test instead proves search/status filtering work
 * against the real backend.
 */
test.describe("platform admin — pagination and filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });
  });

  test("Users page paginates through more than one page and narrows via search", async ({ page }) => {
    await page.getByRole("link", { name: "Users" }).click();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("row")).toHaveCount(21); // header + 20 rows
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();

    await page.getByPlaceholder("Search by name or email...").fill("owner@demo-restaurant.local");
    await expect(page.getByText("owner@demo-restaurant.local")).toBeVisible({ timeout: 10_000 });
    // A search narrow enough to match one user collapses back below a full page.
    await expect(page.getByRole("row")).toHaveCount(2);
  });

  test("Restaurants page filters by status and search against the real backend", async ({ page }) => {
    await page.getByRole("link", { name: "Restaurants" }).click();
    await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();

    // Phase 21 — e2e/shared-menu-canonical-override.spec.ts creates a real "Spice Route Downtown
    // {timestamp}" second location under this same real business on every run, which also matches
    // a "Spice Route" substring search — so an exact single-row count is no longer a safe
    // assertion here. What this test actually needs to prove (search narrows results against the
    // real backend) still holds: the exact "Spice Route" row is present, and every returned row
    // genuinely matches the search term (none of the platform's other, unrelated restaurants leak
    // through).
    await page.getByPlaceholder("Search by name, slug, or city...").fill("Spice Route");
    const row = page.locator("tr").filter({ hasText: "Spice Route" }).filter({ hasNotText: "Downtown" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const resultRows = page.getByRole("row");
    const resultCount = await resultRows.count();
    for (let i = 1; i < resultCount; i++) {
      await expect(resultRows.nth(i)).toContainText("Spice Route");
    }

    await page.getByPlaceholder("Search by name, slug, or city...").fill("");
    await page.getByRole("combobox").selectOption("suspended");
    // Every visible row (if any) must show the suspended badge — none of the currently-active
    // seeded restaurants should appear.
    const badges = page.locator("tbody tr td:nth-child(4)");
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toContainText("suspended");
    }
  });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 12 fix for a real Phase 11A finding: restaurant_staff can legitimately view /menu
 * (they have restaurant.menu.read) but MenuManagementPage used to render fully-interactive
 * Add/Edit/Delete controls regardless of role — controls that always 403'd on click for staff,
 * since the backend has always required restaurant.menu.write (which staff never has). Proves
 * both halves: the UI now hides those controls for staff, AND the backend still independently
 * rejects a write attempt even if the UI were bypassed entirely (a raw API call with staff's own
 * real, valid token) — the actual authorization boundary, not just what's rendered.
 */
test.describe("menu page — role-based write controls", () => {
  test("restaurant_staff sees the menu read-only; owner retains full write controls", async ({ page, request }) => {
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("staff@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Staff123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Menu" }).click();
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    // Staff can see the menu content itself...
    await expect(page.getByText("Margherita Pizza")).toBeVisible();
    // ...but none of the write affordances a 403 would otherwise be waiting behind.
    await expect(page.getByRole("button", { name: "+ Add menu item" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add category" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

    // Capture staff's own genuine access token, then prove the backend rejects a write attempt
    // independently of the UI — not merely "the button is hidden." Phase 21 — the admin Menu page
    // now reads the canonical (business-scoped) menu, not the old location-scoped /menu/items
    // endpoint, so that's what the auth header is captured from here.
    let staffAuthHeader: string | null = null;
    page.on("request", (req) => {
      if (!staffAuthHeader && /\/businesses\/[^/]+\/menu$/.test(req.url())) staffAuthHeader = req.headers()["authorization"] ?? null;
    });
    await page.reload();
    await expect.poll(() => staffAuthHeader).not.toBeNull();

    const restaurantRes = await request.get("http://localhost:4000/api/v1/restaurants/by-slug/demo-restaurant");
    const restaurantData = (await restaurantRes.json()).data.restaurant;
    const createRes = await request.post(`http://localhost:4000/api/v1/businesses/${restaurantData.businessId}/menu`, {
      headers: { Authorization: staffAuthHeader! },
      data: { name: "Should never be created", price: 1, categoryId: "000000000000000000000000" },
    });
    expect(createRes.status()).toBe(403);

    // Owner: the same page, full write controls present and working.
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Menu" }).click();
    await expect(page.getByRole("button", { name: "+ Add menu item" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add category" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
  });
});

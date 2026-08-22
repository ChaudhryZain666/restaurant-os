import { test, expect } from "@playwright/test";

/**
 * Phase 12: GET /orders/mine is now server-paginated (10/page in the web app) instead of
 * fetching a customer's entire order history in one response. Registers a fresh customer via the
 * real UI, captures its own genuine Bearer token from a real page request (same technique as
 * e2e/admin-tenant-isolation.spec.ts), then places 11 orders directly via the API — fast setup
 * that still exercises the real backend, not a mocked one — to get past the 10-per-page boundary.
 */
test.describe("customer order history — pagination", () => {
  test.describe.configure({ timeout: 60_000 });

  test("first page shows 10, Next reveals the remainder, and no other customer's orders ever appear", async ({
    page,
    request,
  }) => {
    const email = `e2e-orders-page-${Date.now()}@test.local`;

    await page.goto("/register");
    await page.getByLabel("Name").fill("E2E Pagination Customer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("E2ePassword1!");

    let authHeader: string | null = null;
    page.on("request", (req) => {
      if (!authHeader && req.url().includes("/api/v1/auth/me")) authHeader = req.headers()["authorization"] ?? null;
    });

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/r\/demo-restaurant$/);
    await page.goto("/orders");
    await expect.poll(() => authHeader).not.toBeNull();

    const restaurantRes = await request.get("http://localhost:4000/api/v1/restaurants/by-slug/demo-restaurant");
    const restaurant = (await restaurantRes.json()).data.restaurant;
    const menuRes = await request.get(`http://localhost:4000/api/v1/restaurants/${restaurant.id}/menu`);
    const menu = (await menuRes.json()).data;
    // Pick an item with no required (minSelect > 0) modifier group, so a plain selectedModifiers:
    // [] is valid — avoids coupling this test to which specific demo item happens to be first.
    const groupsRequiringSelection = new Set(
      menu.modifierGroups.filter((g: { minSelect: number }) => g.minSelect > 0).map((g: { menuItemId: string }) => g.menuItemId)
    );
    const orderableItem = menu.items.find((i: { id: string }) => !groupsRequiringSelection.has(i.id));
    if (!orderableItem) throw new Error("No demo menu item without a required modifier group was found");

    // 11 total: enough for a full first page (10) plus exactly 1 on the second.
    for (let i = 0; i < 11; i++) {
      const res = await request.post(`http://localhost:4000/api/v1/restaurants/${restaurant.id}/orders`, {
        headers: { Authorization: authHeader! },
        data: { orderType: "pickup", items: [{ menuItemId: orderableItem.id, quantity: 1, selectedModifiers: [] }] },
      });
      if (!res.ok()) throw new Error(`order create failed: ${res.status()} ${await res.text()}`);
    }

    await page.reload();
    await expect(page.getByRole("heading", { name: "My orders" })).toBeVisible();
    await expect(page.getByText("11 orders")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.locator("li")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.locator("li")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("a customer with no orders sees the empty state, not pagination controls", async ({ page }) => {
    const email = `e2e-orders-empty-${Date.now()}@test.local`;
    await page.goto("/register");
    await page.getByLabel("Name").fill("E2E Empty Orders Customer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("E2ePassword1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/r\/demo-restaurant$/);

    await page.goto("/orders");
    await expect(page.getByText("No orders yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  });
});

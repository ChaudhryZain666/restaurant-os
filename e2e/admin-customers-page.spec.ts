import { test, expect } from "@playwright/test";

/**
 * Phase 12: CustomersPage used to be built entirely client-side from the restaurant's full order
 * history (see the old comment this replaced). Proves the real backend-derived version: a fresh
 * customer places two real orders via the API, then the admin's Customers page shows their
 * correct aggregated totals and is findable via search — through the actual admin UI, not a
 * mocked response.
 */
test("admin Customers page shows real aggregated order totals for a customer, and search finds them", async ({
  page,
  request,
}) => {
  const email = `e2e-admin-customers-${Date.now()}@test.local`;
  const name = `E2E Customers ${Date.now()}`;

  const registerRes = await request.post("http://localhost:4000/api/v1/auth/register", {
    data: { name, email, password: "E2ePassword1!" },
  });
  expect(registerRes.ok()).toBe(true);
  const { accessToken } = (await registerRes.json()).data;

  const restaurantRes = await request.get("http://localhost:4000/api/v1/restaurants/by-slug/demo-restaurant");
  const restaurant = (await restaurantRes.json()).data.restaurant;
  const menuRes = await request.get(`http://localhost:4000/api/v1/restaurants/${restaurant.id}/menu`);
  const menu = (await menuRes.json()).data;
  const groupsRequiringSelection = new Set(
    menu.modifierGroups.filter((g: { minSelect: number }) => g.minSelect > 0).map((g: { menuItemId: string }) => g.menuItemId)
  );
  const orderableItem = menu.items.find((i: { id: string }) => !groupsRequiringSelection.has(i.id));

  for (let i = 0; i < 2; i++) {
    const res = await request.post(`http://localhost:4000/api/v1/restaurants/${restaurant.id}/orders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { orderType: "pickup", items: [{ menuItemId: orderableItem.id, quantity: 1, selectedModifiers: [] }] },
    });
    if (!res.ok()) throw new Error(`order create failed: ${res.status()} ${await res.text()}`);
  }

  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
  await page.locator('input[type="password"]').fill("Owner123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

  await page.getByPlaceholder("Search by name or email...").fill(name);
  const row = page.locator("tr", { hasText: name });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText(email)).toBeVisible();
  // Both orders priced the same item — 2 orders total.
  await expect(row.getByText("2", { exact: true })).toBeVisible();

  // A search for something that matches nobody shows the empty state, not a stale/wrong row.
  await page.getByPlaceholder("Search by name or email...").fill("zzz-no-such-customer-zzz");
  await expect(page.getByText("No matching customers")).toBeVisible();
});

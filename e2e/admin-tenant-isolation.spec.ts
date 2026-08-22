import { test, expect } from "@playwright/test";

/**
 * Phase 11 P1-9: the API's requireTenantMatch() middleware and its cross-tenant Jest coverage
 * (menu/order/staff/promotion/table/analytics/audit controller.test.ts files) already prove
 * tenant isolation at the request level. What's missing is proof through the actual admin-panel
 * UI/browser session: that a real restaurant owner's admin login only ever shows their own
 * restaurant's data, AND that their own real access token is rejected outright if used against a
 * different restaurant's URL — not just something asserted in an isolated supertest call.
 * Reuses the seeded spice-route/bella-vista fixtures also used by e2e/multi-tenant.spec.ts.
 */
test.describe("admin panel — tenant isolation", () => {
  test.describe.configure({ timeout: 60_000 });

  test("a restaurant owner's admin session only ever sees their own restaurant's menu, and their own access token is rejected against a different restaurant's API", async ({
    page,
    request,
  }) => {
    const bellaVista = await request.get("http://localhost:4000/api/v1/restaurants/by-slug/bella-vista");
    const bellaVistaId = (await bellaVista.json()).data.restaurant.id as string;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("amara@spice-route.local");
    await page.locator('input[type="password"]').fill("Owner123!");

    let capturedAuthHeader: string | null = null;
    page.on("request", (req) => {
      if (!capturedAuthHeader && req.url().includes("/menu/items")) {
        capturedAuthHeader = req.headers()["authorization"] ?? null;
      }
    });

    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Menu" }).click();

    // Own restaurant's menu is visible...
    await expect(page.getByText("Butter Chicken")).toBeVisible({ timeout: 10_000 });
    // ...and Bella Vista's items never appear, even though both restaurants share the same admin origin/session shell.
    await expect(page.getByText("Spaghetti Carbonara")).not.toBeVisible();
    await expect(page.getByText("Lasagna alla Bolognese")).not.toBeVisible();

    await expect.poll(() => capturedAuthHeader).not.toBeNull();

    // The exact same, genuinely valid access token — reused against a different restaurantId in
    // the URL — must be rejected by requireTenantMatch(), not silently served.
    const crossTenantRes = await request.get(`http://localhost:4000/api/v1/restaurants/${bellaVistaId}/menu/items`, {
      headers: { Authorization: capturedAuthHeader! },
    });
    expect(crossTenantRes.status()).toBe(403);
  });

  test("a new order at one restaurant never triggers a real-time toast for a different restaurant's owner", async ({
    browser,
  }) => {
    const otherOwnerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const otherOwnerPage = await otherOwnerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      // Bella Vista's owner sits on their Dashboard — socket rooms are joined server-side from the
      // JWT (restaurant:{id}), so this proves that room join, not just the REST layer, is tenant-safe.
      await otherOwnerPage.goto("http://localhost:5174/login");
      await otherOwnerPage.locator('input[type="email"]').fill("marco@bella-vista.local");
      await otherOwnerPage.locator('input[type="password"]').fill("Owner123!");
      await otherOwnerPage.getByRole("button", { name: "Sign in" }).click();
      await expect(otherOwnerPage.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });

      const customerEmail = `e2e-tenant-iso-${Date.now()}@test.local`;
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Tenant Isolation Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("E2ePassword1!");
      await customerPage.getByRole("button", { name: "Create account" }).click();
      await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      await customerPage.goto("http://localhost:5173/r/spice-route");
      const butterChickenRow = customerPage.locator("li", { hasText: "Butter Chicken" });
      await butterChickenRow.getByRole("button", { name: "Add to cart" }).click();
      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await expect(customerPage).toHaveURL(/\/r\/spice-route\/cart$/);
      await customerPage.getByRole("button", { name: /Place order/ }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

      // Give the socket event a real window to arrive before asserting its absence.
      await otherOwnerPage.waitForTimeout(5_000);
      await expect(otherOwnerPage.getByRole("status")).toHaveCount(0);
    } finally {
      await otherOwnerContext.close();
      await customerContext.close();
    }
  });
});

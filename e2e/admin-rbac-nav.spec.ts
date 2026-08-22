import { test, expect } from "@playwright/test";

/**
 * Regression test for a Phase 11 audit finding: several admin nav links (Delivery, Analytics,
 * Loyalty, Support, Settings, Tables, Staff) were shown to restaurant_staff even though the pages
 * behind them require restaurant_owner/restaurant_manager permissions — clicking them landed on a
 * page that silently 403'd on load or save. Fixed in Layout.tsx (nav now filters by role) and
 * App.tsx (route-level roles tightened to match each page's real required permission).
 *
 * Uses the seeded demo restaurant_staff account (staff@demo-restaurant.local — see
 * seed-demo-data.ts's ensureStaffMember) rather than driving the full owner-invite-email flow,
 * since this test is about nav/route behavior, not the invite flow itself.
 */
test("restaurant_staff sees only the nav links they actually have permission for, and owner-only routes redirect rather than 403", async ({
  page,
}) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("staff@demo-restaurant.local");
  await page.locator('input[type="password"]').fill("Staff123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  // restaurant_staff holds no restaurant.analytics.read, so the Dashboard (which the "/" route
  // renders) would otherwise crash to an error-only screen fetching analytics it can't read
  // (Phase 13 audit's P0-5) — DashboardPage.tsx now redirects it straight to Orders instead.
  await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });

  const nav = page.locator("aside nav");
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Kitchen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Menu" })).toBeVisible();

  // None of these are usable by restaurant_staff — the nav must not link to them at all.
  for (const label of ["Delivery", "Staff", "Analytics", "Support", "Settings", "Tables", "Loyalty"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  }

  // Direct navigation (bookmark, typed URL) to an owner-only route must not render/attempt the
  // page (which would silently fail its own data load/save) — RequireAuth redirects to "/" first,
  // and DashboardPage immediately redirects staff onward to Orders (see above), so "/orders" is
  // the real final landing spot for this role, not "/" itself.
  await page.goto("http://localhost:5174/delivery");
  await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });

  await page.goto("http://localhost:5174/settings");
  await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });
});

test("restaurant_owner still sees every nav link (regression: the role filter didn't over-restrict the owner)", async ({
  page,
}) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
  await page.locator('input[type="password"]').fill("Owner123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

  const nav = page.locator("aside nav");
  for (const label of ["Orders", "Kitchen", "Tables", "Menu", "Customers", "Delivery", "Staff", "Promotions", "Loyalty", "Analytics", "Support", "Settings"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});

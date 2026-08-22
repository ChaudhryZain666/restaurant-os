import { test, expect } from "@playwright/test";

/**
 * Regression coverage for a Phase 11 audit finding: platform admin could view restaurants/users
 * but had no way to suspend a restaurant or deactivate a user anywhere, front or back end. Backend
 * enforcement (status: "active" filtering, login's isActive check) already existed — this is the
 * missing admin action on top, verified end to end through the real UI here.
 */
test("platform admin can suspend and reactivate a restaurant from the Restaurants page", async ({ page }) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
  await page.locator('input[type="password"]').fill("Admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

  await page.getByRole("link", { name: "Restaurants" }).click();
  await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();

  // Searched rather than relied on being on the default (unfiltered, newest-first) first page —
  // this dev database accumulates real restaurants from every other E2E spec's own real UI-driven
  // provisioning across the whole suite's history, so an old seeded restaurant like this one can
  // legitimately no longer be on page 1 by the time this runs. The search box is the same one
  // platform-pagination-filters.spec.ts already exercises against the real backend.
  //
  // Phase 21 — excludes "Downtown" because e2e/shared-menu-canonical-override.spec.ts creates a
  // real "Spice Route Downtown {timestamp}" second location under this same real business on every
  // run, which also matches a "Spice Route" substring search; this locator must keep targeting the
  // one, original, exact "Spice Route" row regardless of how many such locations have accumulated.
  await page.getByPlaceholder("Search by name, slug, or city...").fill("Spice Route");
  const row = page.locator("tr").filter({ hasText: "Spice Route" }).filter({ hasNotText: "Downtown" });
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Suspend" }).click();
  await expect(row.getByText("suspended", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

  // The suspension has real effect on the storefront, not just the admin table.
  const customerContext = await page.context().browser()!.newContext();
  const customerPage = await customerContext.newPage();
  await customerPage.goto("http://localhost:5173/r/spice-route");
  await expect(customerPage.getByText("We can't find that restaurant")).toBeVisible({ timeout: 10_000 });
  await customerContext.close();

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("active", { exact: true })).toBeVisible({ timeout: 10_000 });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 16 — platform admins previously could only work from the Restaurants list; this covers
 * the new single-restaurant overview page (readiness, owner, activity) reached by clicking a
 * restaurant's name, plus the new staff-invite resend action (a real Phase 16 gap: owner invites
 * already had a resend button, staff invites never did).
 */
test("platform admin can open a restaurant's detail page from the Restaurants list and see its readiness, owner, and activity", async ({
  page,
}) => {
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
  // legitimately no longer be on page 1 by the time this runs.
  await page.getByPlaceholder("Search by name, slug, or city...").fill("Spice Route");
  await page.getByRole("link", { name: "Spice Route" }).click();
  await expect(page.getByRole("heading", { name: "Spice Route" })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Owner" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup readiness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

  // Navigating back to the list still works — this page didn't strand the admin.
  await page.getByRole("button", { name: "← All restaurants" }).click();
  await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();
});

test("owner can resend a pending staff invite from the Staff page", async ({ page }) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("amara@spice-route.local");
  await page.locator('input[type="password"]').fill("Owner123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });

  await page.getByRole("link", { name: "Staff" }).click();
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();

  await page.getByRole("button", { name: "Add staff member" }).click();
  const email = `resend-e2e-${Date.now()}@test.local`;
  await page.getByLabel("Name").fill("Resend Test Staff");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invite", exact: true }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible({ timeout: 10_000 });

  const row = page.locator("li", { hasText: email });
  await expect(row.getByText("Invite pending")).toBeVisible();
  await row.getByRole("button", { name: "Resend invite" }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible({ timeout: 10_000 });
});

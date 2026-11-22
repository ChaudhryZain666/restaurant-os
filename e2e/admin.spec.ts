import { test, expect } from "@playwright/test";

// Launch, 2026-11-22 — "/" now shows the public owner portal home to signed-out visitors (see
// owner-portal-public-home.spec.ts); the dashboard's own guarded pages still redirect to sign-in.
test("admin dashboard pages redirect unauthenticated visitors to login", async ({ page }) => {
  await page.goto("http://localhost:5174/orders");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("admin login rejects bad credentials with an inline error", async ({ page }) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("nobody@nowhere.local");
  await page.locator('input[type="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("admin login succeeds for the seeded platform admin and shows platform nav", async ({ page }) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
  await page.locator('input[type="password"]').fill("Admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Restaurants" })).toBeVisible();
  await expect(page.getByText("System configuration")).toBeVisible();
});

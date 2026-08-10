import { test, expect } from "@playwright/test";

test("admin dashboard redirects unauthenticated visitors to login", async ({ page }) => {
  await page.goto("http://localhost:5174/");
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

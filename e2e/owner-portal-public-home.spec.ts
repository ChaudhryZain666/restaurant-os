import { test, expect } from "@playwright/test";

/**
 * Launch, 2026-11-22 — app.garnishtable.com's public home for signed-out visitors (Paddle's domain
 * review refused the host as a login wall). Signed-in owners and every other path keep the
 * existing behaviour. The admin dev server (:5174) has no portal hostnames configured, so it
 * behaves as the Owner Portal host.
 */
const ADMIN = "http://localhost:5174";
const MARKETING = process.env.E2E_MARKETING_URL ?? "http://localhost:5175";

test("a signed-out visitor to / sees the public owner portal home, not a login wall", async ({ page }) => {
  await page.goto(`${ADMIN}/`);
  await expect(page).toHaveURL(`${ADMIN}/`);
  await expect(page.getByRole("heading", { level: 1, name: "The GarnishTable owner portal" })).toBeVisible();
  await expect(page.getByText(/online ordering software for restaurants/)).toBeVisible();
  // No app chrome and no sign-in form on this page.
  await expect(page.locator("aside nav")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("the public home links to sign-in, the free trial, and the public pricing and policies", async ({ page }) => {
  await page.goto(`${ADMIN}/`);
  const policies = page.getByRole("navigation", { name: "GarnishTable policies" });
  await expect(policies.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", `${MARKETING}/pricing`);
  await expect(policies.getByRole("link", { name: "Terms" })).toHaveAttribute("href", `${MARKETING}/terms`);
  await expect(policies.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", `${MARKETING}/privacy`);
  await expect(policies.getByRole("link", { name: "Refund policy" })).toHaveAttribute("href", `${MARKETING}/refund-policy`);
  await expect(policies.getByRole("link", { name: "Contact" })).toHaveAttribute("href", `${MARKETING}/contact`);
  await expect(page.getByRole("link", { name: "Start a 14-day free trial" })).toHaveAttribute("href", "/signup");

  await page.getByRole("link", { name: "Sign in to your restaurant" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("every other signed-out path still goes to sign-in", async ({ page }) => {
  for (const path of ["/orders", "/billing", "/settings"]) {
    await page.goto(`${ADMIN}${path}`);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("a signed-in owner at / still gets the dashboard with the full navigation", async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
  await page.locator('input[type="password"]').fill("Owner123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  await expect(page.locator("aside nav").getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The GarnishTable owner portal" })).toHaveCount(0);

  // A reload keeps the session and the dashboard (the public home never flashes in for a signed-in user).
  await page.reload();
  await expect(page.locator("aside nav").getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The GarnishTable owner portal" })).toHaveCount(0);
});

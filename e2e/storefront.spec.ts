import { test, expect } from "@playwright/test";

test("storefront loads and shows the menu heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("customer can register, add an item to cart, and place an order", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2ePassword1!");
  await page.getByRole("button", { name: "Create account" }).click();

  // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
  await expect(page).toHaveURL(/\/r\/demo-restaurant$/);
  // Margherita Pizza (seeded) has a required "Size" modifier group, so "Add to cart" opens a
  // selection panel rather than adding immediately. Targeted by name rather than "first item"
  // since other e2e specs can add their own items/categories to the same seeded restaurant.
  const pizzaRow = page.locator("li", { hasText: "Margherita Pizza" });
  await pizzaRow.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Confirm add to cart" }).click();

  await page.getByRole("link", { name: /Cart/ }).click();
  await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();

  await page.getByRole("button", { name: "Place order" }).click();
  // Placing an order now lands on that order's own tracking page (Phase 3), not the list.
  await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
  await expect(page.getByText(/Order ORD-\d+/)).toBeVisible();
  await expect(page.getByText("Order placed successfully!")).toBeVisible();
});

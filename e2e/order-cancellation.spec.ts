import { test, expect } from "@playwright/test";

/**
 * Phase 2 (cancellation) + Phase 3 (post-checkout lands on the order's own tracking page, not
 * the list). Scoped entirely to a fresh order the test itself creates for a fresh customer
 * account — never mutates the shared demo-restaurant's config, so it can safely run in parallel
 * with the other specs that also place orders against demo-restaurant.
 */
test("customer can cancel their own pending order, and cannot cancel it twice", async ({ page }) => {
  const email = `e2e-cancel-${Date.now()}@test.local`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Cancel Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2ePassword1!");
  await page.getByRole("button", { name: "Create account" }).click();
  // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
  await expect(page).toHaveURL(/\/r\/demo-restaurant$/);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  const pizzaRow = page.locator("li", { hasText: "Margherita Pizza" });
  await pizzaRow.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Confirm add to cart" }).click();

  await page.getByRole("link", { name: /Cart/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
  await expect(page.getByText("Order placed successfully!")).toBeVisible();

  await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByText("Order cancelled")).toBeVisible();

  // The button only renders for pending orders — once cancelled, it's gone.
  await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
});

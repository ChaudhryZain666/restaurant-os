import { test, expect } from "@playwright/test";

/**
 * Phase 67 — proves the expanded demo-restaurant menu (Wildwood Kitchen, 28 items/7 categories)
 * isn't just decorative content: the newly-added items participate in the exact same real
 * ordering pipeline as the original 10 (product interaction -> modifier selection -> cart ->
 * checkout -> order creation -> confirmation), through the real storefront UI, not a mock.
 *
 * Reuses the seeded Jordan Lee customer account (jordan.lee@example.com / Customer123! — see
 * seed-demo-data.ts's ensureCustomer) rather than full-order-flow.spec.ts's shared
 * customer1@test.local, so the two specs' carts/orders never interleave when run in parallel.
 */
test("customer orders a new menu item with a modifier, then a second item with no modifier, through checkout to confirmation", async ({ page }) => {
  await page.goto("http://localhost:5173/login");
  await page.getByLabel("Email").fill("jordan.lee@example.com");
  await page.getByLabel("Password").fill("Customer123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wildwood Kitchen", { timeout: 15_000 });

  // --- New item WITH a required modifier: Wild Mushroom & Taleggio Pizza (Wood-Fired Pizza) ---
  const pizzaRow = page.locator("li", { hasText: "Wild Mushroom & Taleggio Pizza" });
  await pizzaRow.scrollIntoViewIfNeeded();
  await pizzaRow.getByRole("button", { name: "Add to order" }).click();

  const detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByText("Wild Mushroom & Taleggio Pizza")).toBeVisible();
  await expect(detailDialog.getByText("Size", { exact: false })).toBeVisible();
  await detailDialog.getByText("Medium", { exact: false }).click();
  await detailDialog.getByRole("button", { name: /Add to order — \$/ }).click();

  // --- New item with NO modifier: San Pellegrino Sparkling Water (Drinks) — adds directly ---
  const drinkRow = page.locator("li", { hasText: "San Pellegrino Sparkling Water" });
  await drinkRow.scrollIntoViewIfNeeded();
  await drinkRow.getByRole("button", { name: "Add to order" }).click({ timeout: 15_000 });
  await expect(drinkRow.getByText("Added", { exact: false })).toBeVisible();

  // --- Cart: both items present with the right price math (pizza $16 + $2 Medium = $18, water $3) ---
  await page.getByRole("link", { name: /Cart/ }).click();
  await expect(page.getByText("Wild Mushroom & Taleggio Pizza")).toBeVisible();
  await expect(page.getByText("Medium (+$2.00)")).toBeVisible();
  await expect(page.getByText("San Pellegrino Sparkling Water")).toBeVisible();
  await expect(page.getByText("Subtotal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order — $21.00" })).toBeVisible();

  // Quantity update: bump the water to 2 and confirm the subtotal recalculates.
  await page.getByLabel("Quantity for San Pellegrino Sparkling Water").fill("2");
  await expect(page.getByRole("button", { name: "Place order — $24.00" })).toBeVisible();

  // --- Checkout: pickup + cash (both always enabled on this fixture), then place the order ---
  await page.locator("label", { hasText: "Pickup" }).click();
  await page.locator("label", { hasText: "Cash" }).click();
  await page.getByRole("button", { name: /Place order — \$/ }).click();

  await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
  await expect(page.getByText("Order placed successfully!")).toBeVisible();
  await expect(page.getByText("Wild Mushroom & Taleggio Pizza")).toBeVisible();
  await expect(page.getByText("San Pellegrino Sparkling Water")).toBeVisible();
});

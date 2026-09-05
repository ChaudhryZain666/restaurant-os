import { test, expect } from "@playwright/test";

/**
 * Portal UX safety phase — RestaurantSupportPage.tsx used to only ever list tickets that already
 * existed, with no way to create one; several other pages link here as "Contact support" and found
 * nothing they could actually do. This proves the real fix end to end: a restaurant owner can open
 * the form, submit it against the existing POST /support/tickets endpoint (no new support
 * architecture), land on the new ticket, and see it appear back in the list.
 */
test("restaurant owner can contact support from the empty state or the page header, and the new ticket is visible", async ({ page }) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
  await page.locator('input[type="password"]').fill("Owner123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

  await page.getByRole("link", { name: "Support" }).click();
  await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();

  const subject = `E2E support contact ${Date.now()}`;
  await page.getByRole("button", { name: "Contact support" }).first().click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message").fill("This is a test message from the restaurant owner support contact e2e spec.");
  await page.getByRole("button", { name: "Send" }).click();

  // Lands directly on the newly created ticket.
  await expect(page).toHaveURL(/\/support\/[a-f0-9]+$/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();

  // And it's visible back in the list, not just on its own detail page.
  await page.getByRole("link", { name: "← Back to support" }).click();
  await expect(page.getByText(subject)).toBeVisible();
});

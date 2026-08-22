import { test, expect } from "@playwright/test";

/**
 * Regression test for a Phase 11 audit finding: LoyaltyPage's data fetch had no .catch, so a
 * failed request silently rendered "0 points · Bronze tier" as if that were the customer's real
 * balance instead of surfacing an error — indistinguishable from a customer who genuinely has no
 * points. Fixed in apps/web/src/pages/LoyaltyPage.tsx to show a real error state instead.
 */
test("a failed loyalty data fetch shows an error, never a fake zero-balance", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("jordan.lee@example.com");
  await page.getByLabel("Password").fill("Customer123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

  await page.route("**/api/v1/restaurants/*/loyalty/me*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }),
    })
  );

  await page.goto("/r/demo-restaurant/loyalty");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("0 points")).not.toBeVisible();
  await expect(page.getByText("Bronze tier")).not.toBeVisible();
});

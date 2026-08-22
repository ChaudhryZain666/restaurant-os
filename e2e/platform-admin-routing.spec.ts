import { test, expect } from "@playwright/test";

/**
 * Regression test for Phase 11's Step 2 fix (apps/admin/src/components/RequireAuth.tsx): a
 * platform_admin who lands on the bare "/" route (a stale bookmark, a stray link — anything other
 * than a fresh login, which already redirects correctly via LoginPage) used to get bounced by
 * RequireAuth's "unauthorized role" fallback back to "/" itself, which failed the same restaurant-
 * role check, looping indefinitely. RequireAuth now redirects to the user's own role-appropriate
 * home instead of unconditionally "/".
 */
test("a platform_admin landing on the restaurant-only root route is redirected to /platform, not stuck in a loop", async ({
  page,
}) => {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
  await page.locator('input[type="password"]').fill("Admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

  // Simulates the stale-bookmark/stray-link scenario directly, rather than only the fresh-login
  // path LoginPage already handles correctly.
  await page.goto("http://localhost:5174/");
  await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });
  await expect(page.getByText("System configuration")).toBeVisible();
});

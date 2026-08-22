import { test, expect } from "@playwright/test";

/**
 * Regression coverage for Phase 11's Step 5 fix (packages/utils/src/apiClient.ts): when a 401
 * survives a refresh attempt — the refresh token is genuinely expired/revoked, not just a stale
 * access token — the client now clears its session and notifies AuthContext, so every
 * RequireAuth-guarded page naturally redirects to login instead of the app silently looking
 * "logged in" while every subsequent request keeps failing.
 *
 * The concurrent-401-dedup guarantee this fix builds on (a single shared refreshPromise, so two
 * simultaneous 401s never fire two independent /auth/refresh calls against the single-use
 * rotating refresh token) predates this phase and is structurally verified by there being no
 * `await` between the dedup check and the promise assignment in tryRefresh() — this suite adds
 * black-box coverage that the whole flow still behaves correctly end to end, not a reimplementation
 * of that unit-level guarantee.
 */

test.describe("session refresh behavior", () => {
  test("a genuinely expired/revoked refresh token clears the session and redirects to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("jordan.lee@example.com");
    await page.getByLabel("Password").fill("Customer123!");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

    // From this point on, every API call looks like the access token is stale AND the refresh
    // token is genuinely dead (simulating real expiry/revocation deterministically, rather than
    // waiting out a real 15-minute access-token TTL).
    await page.route("**/api/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/auth/refresh")) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Refresh token invalid" } }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }),
      });
    });

    // Any authenticated page load triggers a real request that will now fail this way.
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });

  test("a stale-but-refreshable access token transparently refreshes and retries — the customer never sees a failure", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("jordan.lee@example.com");
    await page.getByLabel("Password").fill("Customer123!");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

    // Force exactly the NEXT non-refresh API call to 401 once (simulating an access token that
    // just expired), while leaving /auth/refresh itself untouched — it should succeed for real
    // against the actual backend, and the original request should transparently retry and succeed.
    let forcedOnce = false;
    await page.route("**/api/v1/users/me/addresses", async (route) => {
      if (!forcedOnce) {
        forcedOnce = true;
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }),
        });
      }
      return route.continue();
    });

    await page.goto("/account");
    // The page loads normally — the customer stays logged in and sees their real data, never a
    // login redirect or a visible error, because the client refreshed and retried transparently.
    await expect(page).toHaveURL(/\/account$/);
    // exact: true — Phase 12's email-change section also mentions the current address inline
    // ("your login email stays jordan.lee@example.com until you use it"), so a substring match
    // would ambiguously match two elements.
    await expect(page.getByText("jordan.lee@example.com", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Saved addresses" })).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 12: account self-service (password change, email change, account deletion) — previously
 * entirely absent. Each test registers its own fresh customer so it never touches shared demo
 * fixtures other specs depend on.
 */
test.describe("account self-service", () => {
  async function registerFreshCustomer(page: import("@playwright/test").Page, label: string) {
    const email = `e2e-${label}-${Date.now()}@test.local`;
    await page.goto("/register");
    await page.getByLabel("Name").fill(`E2E ${label}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("OriginalPass1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });
    return email;
  }

  test("changing password takes effect immediately — old password stops working, new one logs in", async ({ page }) => {
    const email = await registerFreshCustomer(page, "pwchange");

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await page.locator('input[type="password"]').nth(0).fill("OriginalPass1!");
    await page.locator('input[type="password"]').nth(1).fill("BrandNewPass1!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Password updated. Your other sessions have been signed out.")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("OriginalPass1!");
    const failedLoginRes = page.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await page.getByRole("button", { name: "Log in" }).click();
    expect((await failedLoginRes).status()).toBe(401);

    await page.getByLabel("Password").fill("BrandNewPass1!");
    const okLoginRes = page.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await page.getByRole("button", { name: "Log in" }).click();
    expect((await okLoginRes).status()).toBe(200);
  });

  test("requesting an email change sends a confirmation, and an invalid token is genuinely rejected", async ({ page }) => {
    await registerFreshCustomer(page, "emailchange");

    await page.goto("/account");
    await page.locator('input[type="email"]').fill(`e2e-newaddr-${Date.now()}@test.local`);
    await page.locator('input[type="password"]').nth(2).fill("OriginalPass1!");
    await page.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(page.getByText(/A confirmation link has been sent to/)).toBeVisible();

    // A bogus token must be rejected, not silently accepted — proves confirmation is real.
    await page.goto("/confirm-email-change?token=not-a-real-token");
    await expect(page.getByText("This confirmation link is invalid or has expired")).toBeVisible();
  });

  test("account deletion signs the customer out and their old credentials stop working", async ({ page }) => {
    const email = await registerFreshCustomer(page, "delete");

    await page.goto("/account");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByPlaceholder("Current password").fill("OriginalPass1!");
    await page.getByRole("button", { name: "Permanently delete my account" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("OriginalPass1!");
    const res = page.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await page.getByRole("button", { name: "Log in" }).click();
    expect((await res).status()).toBe(401);
  });
});

import { test, expect } from "@playwright/test";

/**
 * Regression coverage for a Phase 11 audit finding: no notification system existed anywhere, so a
 * restaurant owner not actively watching Orders/Kitchen had no way to learn a new order arrived.
 * Proves the toast is genuinely global (fires from the socket-driven order:event while the owner
 * sits on an unrelated page — Dashboard, not Orders/Kitchen) and that its action navigates correctly.
 * Reuses the same seeded demo-restaurant fixtures/flow as kitchen-realtime.spec.ts.
 */
test.describe("admin — new order toast notification", () => {
  test.describe.configure({ timeout: 60_000 });

  test("owner sees a toast for a new order while on an unrelated admin page", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
      await ownerPage.getByLabel("Password").fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });

      await customerPage.goto("http://localhost:5173/login");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
      await customerPage.getByRole("button", { name: "Log in" }).click();
      if ((await loginRes).status() !== 200) {
        await customerPage.goto("http://localhost:5173/register");
        await customerPage.getByLabel("Name").fill("E2E Toast Customer");
        await customerPage.getByLabel("Email").fill("customer1@test.local");
        await customerPage.getByLabel("Password").fill("Customer123!");
        await customerPage.getByRole("button", { name: "Create account" }).click();
      }
      await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      await customerPage.goto("http://localhost:5173/");
      const itemRow = customerPage.locator("li", { hasText: "Margherita Pizza" });
      await itemRow.scrollIntoViewIfNeeded();
      await itemRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
      await itemRow.getByText("Small", { exact: false }).click();
      await itemRow.getByRole("button", { name: "Confirm add to cart" }).click();

      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await customerPage.getByRole("button", { name: /Place order/ }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
      const orderNumber = heading.match(/ORD-\d+/)![0];

      // Owner never navigated away from Dashboard — the toast must be app-shell-global, not
      // scoped to the Orders/Kitchen pages.
      await expect(ownerPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      const toast = ownerPage.getByRole("status").filter({ hasText: orderNumber });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await expect(toast.getByText("New order received")).toBeVisible();

      await toast.getByRole("button", { name: "View order" }).click();
      await expect(ownerPage).toHaveURL(/\/orders$/);
    } finally {
      await ownerContext.close();
      await customerContext.close();
    }
  });
});

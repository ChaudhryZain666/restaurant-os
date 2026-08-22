import { test, expect } from "@playwright/test";

/**
 * Phase 12: the audit-log backend (GET /restaurants/:id/audit-log) already existed and was
 * already permission-gated on restaurant.audit.read — this is the first admin page that actually
 * renders it. Confirming a real order through the Kitchen UI is what already records an
 * "order.status_changed" audit entry (order.controller.ts) — used here as a deterministic,
 * real-through-the-app way to guarantee a fresh row exists, rather than relying on leftover state
 * from other specs.
 */
test("owner can view the restaurant audit log, and a real status change appears in it", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    await ownerPage.goto("http://localhost:5174/login");
    await ownerPage.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await ownerPage.locator('input[type="password"]').fill("Owner123!");
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.getByRole("link", { name: "Kitchen" }).click();

    await customerPage.goto("http://localhost:5173/login");
    await customerPage.getByLabel("Email").fill("customer1@test.local");
    await customerPage.getByLabel("Password").fill("Customer123!");
    const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await customerPage.getByRole("button", { name: "Log in" }).click();
    if ((await loginRes).status() !== 200) {
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Audit Log Customer");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      await customerPage.getByRole("button", { name: "Create account" }).click();
    }
    await customerPage.goto("http://localhost:5173/r/demo-restaurant");
    const pizzaRow = customerPage.locator("li", { hasText: "Margherita Pizza" });
    await pizzaRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
    await pizzaRow.getByText("Small", { exact: false }).click();
    await pizzaRow.getByRole("button", { name: "Confirm add to cart" }).click();
    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await customerPage.getByRole("button", { name: /Place order/ }).click();
    await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    const orderNumber = (await customerPage.getByRole("heading", { level: 1 }).innerText()).match(/ORD-\d+/)![0];

    const kdsCard = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
    await expect(kdsCard).toBeVisible({ timeout: 15_000 });
    await kdsCard.getByRole("button", { name: "Accept" }).click();

    await ownerPage.getByRole("link", { name: "Audit log" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Audit log" })).toBeVisible();
    // Scoped to the table specifically — Phase 15 added a filter dropdown above it whose options
    // share this same text ("Order status changed"), which a page-wide getByText would also match.
    await expect(ownerPage.locator("table").getByText("Order status changed").first()).toBeVisible({ timeout: 10_000 });
    await expect(ownerPage.getByText(/\d+ events?/)).toBeVisible();

    // Phase 15 added more filter dropdowns (Action, Actor) alongside this one — named explicitly
    // now that getByRole("combobox") alone would be ambiguous.
    await ownerPage.getByRole("combobox", { name: "Target" }).selectOption("payment");
    // Filtering to a target type this fresh entry doesn't match must hide it (or show the empty state).
    const rows = ownerPage.locator("tbody tr");
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      await expect(rows.nth(i)).not.toContainText("Order status changed");
    }
  } finally {
    await ownerContext.close();
    await customerContext.close();
  }
});

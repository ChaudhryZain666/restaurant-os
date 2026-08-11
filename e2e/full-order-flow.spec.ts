import { test, expect } from "@playwright/test";

/**
 * End-to-end proof of the full Phase 1 loop:
 *   category created (admin) -> menu item created (admin) -> customer orders it (storefront)
 *   -> restaurant sees the order (admin) -> status progresses pending -> confirmed -> preparing
 *   -> ready -> completed (admin).
 *
 * Reuses the seeded demo-restaurant/owner rather than creating a fresh restaurant via the
 * platform_admin API: the storefront (apps/web) points at one hardcoded restaurant slug by
 * design in this phase (see docs/roadmap.md — multi-restaurant storefront routing is future
 * work), so a dynamically-created restaurant wouldn't be reachable from the customer side
 * anyway. This still exercises every step of the requested flow end to end.
 *
 * Uses two separate browser contexts (owner, customer) rather than one shared page: admin
 * (localhost:5174) and web (localhost:5173) are different ports of the same "localhost" host,
 * and browser cookies are scoped by host, not port — sharing one page would let the customer's
 * login silently overwrite the owner's refresh-token cookie. Two contexts mirror what's actually
 * true in production too: the restaurant owner and the customer are different people on
 * different browsers.
 */
test("category -> menu item -> customer order -> restaurant status lifecycle", async ({ browser }) => {
  const itemName = `E2E Burger ${Date.now()}`;
  const categoryName = `E2E Category ${Date.now()}`;

  const ownerContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    // --- Restaurant owner creates a category and a menu item via the real admin UI ---
    await ownerPage.goto("http://localhost:5174/login");
    await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
    await ownerPage.getByLabel("Password").fill("Owner123!");
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.getByRole("link", { name: "Menu" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    await ownerPage.getByPlaceholder("New category name").fill(categoryName);
    await ownerPage.getByRole("button", { name: "Add category" }).click();
    await expect(ownerPage.locator("li", { hasText: categoryName })).toBeVisible();

    await ownerPage.getByPlaceholder("Item name").fill(itemName);
    await ownerPage.getByPlaceholder("Price").fill("9");
    await ownerPage.getByRole("combobox").selectOption({ label: categoryName });
    await ownerPage.getByRole("button", { name: "Add item" }).click();
    await expect(ownerPage.getByText(itemName, { exact: false })).toBeVisible();

    // --- Customer places an order for that item via the real storefront UI ---
    await customerPage.goto("http://localhost:5173/login");
    await customerPage.getByLabel("Email").fill("customer1@test.local");
    await customerPage.getByLabel("Password").fill("Customer123!");
    const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await customerPage.getByRole("button", { name: "Log in" }).click();
    const loginStatus = (await loginRes).status();
    if (loginStatus !== 200) {
      // First run on a fresh DB — this account doesn't exist yet, register it instead.
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Full Flow Customer");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      await customerPage.getByRole("button", { name: "Create account" }).click();
    }
    await expect(customerPage).toHaveURL("http://localhost:5173/");

    await customerPage.goto("http://localhost:5173/");
    await expect(customerPage.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    const itemRow = customerPage.locator("li", { hasText: itemName });
    await itemRow.scrollIntoViewIfNeeded();
    await itemRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });

    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible();
    await customerPage.getByRole("button", { name: "Place order" }).click();
    await expect(customerPage).toHaveURL("http://localhost:5173/orders", { timeout: 10_000 });
    // listMyOrders sorts newest-first, so the order this test just placed is always first —
    // matters because repeated local runs accumulate earlier pending orders from this same
    // seeded customer account.
    const placedOrderText = await customerPage.locator("li", { hasText: "ORD-" }).first().innerText();
    const orderNumber = placedOrderText.match(/ORD-\d+/)![0];

    // --- Restaurant staff sees the order and progresses it through the full status lifecycle ---
    // Client-side nav (not page.goto, a full reload) — a full reload remounts AuthProvider, whose
    // mount effect calls POST /auth/refresh. Under React StrictMode (dev only) that effect double-
    // fires, and the API's refresh token is single-use: two near-simultaneous refresh calls racing
    // on the same not-yet-rotated cookie can revoke the session, intermittently bouncing this page
    // back to /login under parallel test load. Clicking the in-app nav link avoids the reload (and
    // thus the race) entirely, matching how the "Menu" step above already navigates.
    await ownerPage.getByRole("link", { name: "Orders" }).click();
    const orderRow = ownerPage.locator("tr", { hasText: orderNumber });
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText("pending");

    for (const label of ["Mark confirmed", "Mark preparing", "Mark ready", "Mark completed"]) {
      await orderRow.getByRole("button", { name: label }).click();
      await expect(orderRow).toContainText(label.replace("Mark ", ""));
    }

    // Clean up the category/item this run created — the demo-restaurant is shared with other
    // e2e specs (see storefront.spec.ts), and leaving them behind would keep growing the
    // dataset and shift "first item" assumptions in other tests on every local run.
    await ownerPage.getByRole("link", { name: "Menu" }).click();
    const itemLi = ownerPage.locator("li", { hasText: itemName });
    await itemLi.getByRole("button", { name: "Delete" }).click();
    await expect(itemLi).toHaveCount(0);
    const categoryLi = ownerPage.locator("li", { hasText: categoryName });
    await categoryLi.getByRole("button", { name: "Delete" }).click();
    await expect(categoryLi).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await customerContext.close();
  }
});

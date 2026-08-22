import { test, expect } from "@playwright/test";

/**
 * End-to-end proof of the online-payment domain added in Phase 5: customer selects "Pay online"
 * at checkout, the order is created unpaid, and the SAME mock-provider-driven, signed-webhook
 * pipeline the Jest suite exercises server-side is driven here through the real UI — "Simulate
 * successful/failed payment" in OrderPaymentPanel calls the mock-complete endpoint, which
 * constructs and verifies a real HMAC-signed event through the real webhook processing path
 * before flipping Payment/Order state. No step here fakes a real provider; every button is
 * clearly labelled as a simulation (see docs/payment-provider-decision.md).
 *
 * Reuses the seeded demo-restaurant/owner and an existing demo menu item (Margherita Pizza)
 * rather than creating one — keeps this spec focused on the payment flow itself, not menu setup
 * (already covered by full-order-flow.spec.ts).
 */

/** Margherita Pizza has a required "Size" modifier group in seed data — "Add to cart" expands an
 *  in-place selector rather than adding directly, exactly like full-order-flow.spec.ts's item. */
async function addMargheritaToCart(page: import("@playwright/test").Page) {
  const itemRow = page.locator("li", { hasText: "Margherita Pizza" });
  await itemRow.scrollIntoViewIfNeeded();
  await itemRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
  await itemRow.getByText("Small", { exact: false }).click();
  await itemRow.getByRole("button", { name: "Confirm add to cart" }).click();
}

test.describe("online payment", () => {
  test.describe.configure({ timeout: 60_000 });

  test("customer pays online, order becomes payable only after a simulated successful payment", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
      await ownerPage.getByLabel("Password").fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Orders" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Orders" })).toBeVisible();

      await customerPage.goto("http://localhost:5173/login");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
      await customerPage.getByRole("button", { name: "Log in" }).click();
      if ((await loginRes).status() !== 200) {
        await customerPage.goto("http://localhost:5173/register");
        await customerPage.getByLabel("Name").fill("E2E Payment Customer");
        await customerPage.getByLabel("Email").fill("customer1@test.local");
        await customerPage.getByLabel("Password").fill("Customer123!");
        await customerPage.getByRole("button", { name: "Create account" }).click();
      }
      // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
      await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/);

      await customerPage.goto("http://localhost:5173/");
      await addMargheritaToCart(customerPage);

      await customerPage.getByRole("link", { name: /Cart/ }).click();
      // The radio input itself is visually hidden (sr-only) — the visible, clickable surface is
      // its enclosing label, exactly how a sighted user would actually interact with it.
      await customerPage.locator("label", { hasText: "Pay online" }).click();
      await expect(customerPage.getByRole("button", { name: /Continue to payment/ })).toBeVisible();
      await customerPage.getByRole("button", { name: /Continue to payment/ }).click();

      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(customerPage.getByText("Complete payment below")).toBeVisible();
      await expect(customerPage.getByText("Unpaid")).toBeVisible();

      // --- Staff should not be able to accept this order yet — it hasn't been paid ---
      const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
      const orderNumber = heading.match(/ORD-\d+/)![0];
      // The owner's Orders page was loaded before this order existed and doesn't poll — a
      // client-side nav (not a full reload, see the comment further down) re-fetches it.
      await ownerPage.getByRole("link", { name: "Dashboard" }).click();
      await ownerPage.getByRole("link", { name: "Orders" }).click();
      const orderGroup = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(orderGroup).toBeVisible({ timeout: 10_000 });
      await expect(orderGroup.getByText("Waiting for payment")).toBeVisible();
      await expect(orderGroup.getByRole("button", { name: "Accept" })).toHaveCount(0);

      // --- Customer drives the mock payment flow through the real UI ---
      await customerPage.getByRole("button", { name: "Pay now" }).click();
      await expect(customerPage.getByRole("button", { name: "Simulate successful payment" })).toBeVisible({
        timeout: 10_000,
      });
      await customerPage.getByRole("button", { name: "Simulate successful payment" }).click();
      await expect(customerPage.getByText("Paid", { exact: true })).toBeVisible({ timeout: 10_000 });

      // --- Now staff can see it's paid and accept it ---
      // Client-side nav (Dashboard -> Orders), not a full reload: a full reload remounts
      // AuthProvider, whose refresh-token call can race under React StrictMode and intermittently
      // bounce back to /login (see the identical comment in full-order-flow.spec.ts). Navigating
      // away and back remounts OrdersManagementPage's own data fetch without touching auth.
      await ownerPage.getByRole("link", { name: "Dashboard" }).click();
      await ownerPage.getByRole("link", { name: "Orders" }).click();
      const orderGroupAfter = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(orderGroupAfter).toBeVisible();
      await expect(orderGroupAfter.getByRole("button", { name: "Accept" })).toBeVisible({ timeout: 10_000 });
      await orderGroupAfter.getByRole("button", { name: "Accept" }).click();
      await expect(orderGroupAfter.getByRole("button", { name: "Start preparing" })).toBeVisible();
    } finally {
      await ownerContext.close();
      await customerContext.close();
    }
  });

  test("a failed simulated payment leaves the order clearly unpaid, with a retry available", async ({ browser }) => {
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();

    try {
      await customerPage.goto("http://localhost:5173/login");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      await customerPage.getByRole("button", { name: "Log in" }).click();
      await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });

      await customerPage.goto("http://localhost:5173/");
      await addMargheritaToCart(customerPage);

      await customerPage.getByRole("link", { name: /Cart/ }).click();
      // The radio input itself is visually hidden (sr-only) — the visible, clickable surface is
      // its enclosing label, exactly how a sighted user would actually interact with it.
      await customerPage.locator("label", { hasText: "Pay online" }).click();
      await customerPage.getByRole("button", { name: /Continue to payment/ }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

      await customerPage.getByRole("button", { name: "Pay now" }).click();
      await expect(customerPage.getByRole("button", { name: "Simulate failed payment" })).toBeVisible({
        timeout: 10_000,
      });
      await customerPage.getByRole("button", { name: "Simulate failed payment" }).click();

      // Failure must not be presented as success — still "Unpaid", and a fresh "Pay now" (retry)
      // is offered rather than the page silently looking like nothing happened.
      await expect(customerPage.getByText("Unpaid")).toBeVisible({ timeout: 10_000 });
      await expect(customerPage.getByRole("button", { name: "Pay now" })).toBeVisible();
    } finally {
      await customerContext.close();
    }
  });
});

import { test, expect } from "@playwright/test";

/**
 * Proves the Phase 6 real-time wiring actually works end to end through the real UI: a customer
 * places an order, and the restaurant's Kitchen Display System shows it WITHOUT a manual reload —
 * driven by the Socket.IO event → useRestaurantOrderEvents → re-fetch pipeline, not a page
 * refresh. Then the reverse direction: the kitchen accepts the order through the KDS, and the
 * customer's own tracking page updates live too.
 *
 * Reuses the seeded demo-restaurant/owner and an existing demo item (Margherita Pizza) — same
 * fixtures as full-order-flow.spec.ts and online-payment.spec.ts.
 */
test.describe("kitchen display — real-time order flow", () => {
  test.describe.configure({ timeout: 60_000 });

  test("a new order appears on the KDS live, and kitchen actions reflect live on customer tracking", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
      await ownerPage.getByLabel("Password").fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Kitchen" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Kitchen" })).toBeVisible();

      await customerPage.goto("http://localhost:5173/login");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
      await customerPage.getByRole("button", { name: "Log in" }).click();
      if ((await loginRes).status() !== 200) {
        await customerPage.goto("http://localhost:5173/register");
        await customerPage.getByLabel("Name").fill("E2E Kitchen Customer");
        await customerPage.getByLabel("Email").fill("customer1@test.local");
        await customerPage.getByLabel("Password").fill("Customer123!");
        await customerPage.getByRole("button", { name: "Create account" }).click();
      }
      // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
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

      // No reload on the owner/KDS page at all — this must arrive via the live socket event.
      const kdsCard = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(kdsCard).toBeVisible({ timeout: 15_000 });

      // --- Kitchen accepts the order through the KDS itself ---
      await kdsCard.getByRole("button", { name: "Accept" }).click();

      // --- Customer's tracking page reflects it live, without any manual reload ---
      await expect(customerPage.getByText("Accepted", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await ownerContext.close();
      await customerContext.close();
    }
  });
});

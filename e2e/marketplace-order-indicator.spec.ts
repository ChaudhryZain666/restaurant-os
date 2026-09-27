import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 82 Workstream F — the known product UX gap: a marketplace-sourced order was
 * indistinguishable from a regular online order in Orders Management (only "· POS" existed,
 * nothing for "· Uber Eats"/"· DoorDash"/"· foodpanda"). Seeds a real, schema-valid Order document
 * directly (channel: "marketplace", a real MarketplaceProviderName) rather than driving the full
 * webhook-ingestion pipeline — that pipeline itself is already covered by
 * marketplaceOrderIngestion.service.test.ts; this spec is specifically about the admin UI's own
 * rendering of an order that pipeline would have produced.
 */
test.describe.serial("marketplace order indicator", () => {
  let db: mongoose.Connection;
  let orderId: mongoose.Types.ObjectId;
  let orderNumber: string;
  let restaurantId: mongoose.Types.ObjectId;
  let hadToEnablePos = false;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;

    const restaurant = await db.collection("restaurants").findOne({ slug: "demo-restaurant" });
    if (!restaurant) throw new Error("demo-restaurant fixture not found");
    restaurantId = restaurant._id;
    const menuItem = await db.collection("menuitems").findOne({ restaurantId: restaurant._id });
    if (!menuItem) throw new Error("demo-restaurant has no menu items to seed an order line item from");
    const customer = await db.collection("users").findOne({ role: "customer" });
    if (!customer) throw new Error("no seeded customer user found");

    // The POS orders view (pos/OrdersPage.tsx) hard-blocks itself when settings.posEnabled is
    // false — this spec's second test needs it on to reach that page at all. Restored in afterAll
    // so this doesn't leave the shared demo-restaurant fixture in a changed state for other specs.
    if (restaurant.settings?.posEnabled !== true) {
      hadToEnablePos = true;
      await db.collection("restaurants").updateOne({ _id: restaurant._id }, { $set: { "settings.posEnabled": true } });
    }

    orderId = new mongoose.Types.ObjectId();
    orderNumber = `E2E-MKT-${Date.now()}`;
    await db.collection("orders").insertOne({
      _id: orderId,
      restaurantId: restaurant._id,
      customerId: customer._id,
      orderNumber,
      items: [
        {
          menuItemId: menuItem._id,
          name: menuItem.name ?? "Test Item",
          unitPrice: 10,
          quantity: 1,
          selectedModifiers: [],
          lineTotal: 10,
        },
      ],
      status: "pending",
      statusHistory: [{ status: "pending", at: new Date() }],
      orderType: "delivery",
      channel: "marketplace",
      paymentMethod: "online",
      paymentStatus: "paid",
      currency: "USD",
      subtotal: 10,
      taxAmount: 0,
      deliveryFee: 0,
      discount: 0,
      loyaltyPointsEarned: 0,
      loyaltyPointsRedeemed: 0,
      total: 10,
      marketplace: {
        provider: "uber_eats",
        integrationId: new mongoose.Types.ObjectId(),
        externalOrderId: "uber-e2e-test-order",
        externalStoreId: "uber-e2e-test-store",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    await db.collection("orders").deleteOne({ _id: orderId });
    if (hadToEnablePos) {
      await db.collection("restaurants").updateOne({ _id: restaurantId }, { $set: { "settings.posEnabled": false } });
    }
    await db.close();
  });

  test("shows a clear Uber Eats source indicator in Orders Management, matching the existing POS convention", async ({ page }) => {
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/orders");
    const orderCard = page.getByRole("group", { name: `Order ${orderNumber}` });
    await expect(orderCard).toBeVisible({ timeout: 10_000 });
    await expect(orderCard.getByText("· Uber Eats")).toBeVisible();
  });

  test("shows the same Uber Eats source indicator in the POS orders view", async ({ page }) => {
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/pos/orders");
    const orderRow = page.locator("li", { hasText: orderNumber });
    await expect(orderRow).toBeVisible({ timeout: 10_000 });
    await expect(orderRow.getByText("· Uber Eats")).toBeVisible();
  });
});

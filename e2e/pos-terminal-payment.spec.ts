import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 74 — the terminal-ready card-payment state machine, driven through the real UI end to end
 * against the real (mock, dev/test-only) PaymentTerminalProvider. Requires the API server to be
 * running with POS_TERMINAL_PROVIDER=mock (apps/api/.env) — if it isn't, PaymentConfirmation falls
 * back to Phase 73's honest staff-attestation card flow instead, and the "Start card payment"
 * button this spec looks for simply won't appear (a real, meaningful signal, not a silent skip).
 *
 * posTerminalEnabled has no Settings UI yet (nothing to configure without a real provider — see
 * docs/pos-architecture.md's Phase 74 section), so this spec sets it directly via Mongo, the same
 * documented exception this project's other e2e specs already use for fields with no UI affordance
 * yet (e.g. restaurant-provisioning-golden-path.spec.ts's invite token).
 *
 * The mock terminal has no UI of its own to simulate an outcome (a real terminal is a physical
 * device, not a button in this app) — outcomes are driven via the real dev-only mock-complete
 * endpoint, called with the Authorization header captured off the page's own real
 * POST .../terminal-payment request (the same technique menu-rbac.spec.ts already uses to drive a
 * direct API call with a real, non-exposed session token), never a shortcut around the real
 * create/poll/apply pipeline.
 */
test.describe.serial("POS card-terminal payment (Phase 74)", () => {
  let db: mongoose.Connection;
  let restaurantId: string;
  let slug: string;
  let staffAuthHeader: string | null = null;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("owner provisions a terminal-enabled location; staff starts, approves, declines/retries, and cancels a card-terminal payment", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    slug = `e2e-pos-terminal-${stamp}`;
    const restaurantName = `E2E POS Terminal ${stamp}`;
    const ownerEmail = `e2e-pos-terminal-owner-${stamp}@test.local`;
    const itemName = `Terminal Test Burger ${stamp}`;
    const categoryName = `Terminal Test Category ${stamp}`;

    // --- Platform admin provisions the restaurant; owner accepts and configures it. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Terminal Test Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: createHash("sha256").update(rawToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("PosTerminalOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Ordering", exact: true }).click();
    await page.locator("label", { hasText: "Enable the staff POS terminal" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    const restaurantDoc = await db.collection("restaurants").findOne({ slug });
    restaurantId = restaurantDoc!._id.toString();
    // The one field with no Settings UI yet — see this spec's own doc comment above.
    await db.collection("restaurants").updateOne({ _id: restaurantDoc!._id }, { $set: { "settings.posTerminalEnabled": true } });

    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("18");
    await page.getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Customize this item")).toBeVisible();
    await page.getByRole("button", { name: "Back to menu" }).click();

    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // Capture a real Authorization header from the page's own traffic — reused below to drive the
    // dev-only mock-complete endpoint directly, the same technique menu-rbac.spec.ts already uses.
    page.on("request", (req) => {
      if (!staffAuthHeader && req.url().includes("/pos/orders")) staffAuthHeader = req.headers()["authorization"] ?? null;
    });

    async function ringUpCardOrder() {
      await page.goto("http://localhost:5174/pos");
      await page.getByText(itemName).click();
      await page.getByRole("button", { name: "Select customer" }).click();
      await page.getByRole("button", { name: "Continue without a name" }).click();
      await page.getByRole("button", { name: "Card" }).click();
      await page.getByRole("button", { name: /Charge/ }).click();
    }

    async function mockComplete(orderId: string, paymentId: string, outcome: "paid" | "failed" | "cancelled") {
      await expect.poll(() => staffAuthHeader).not.toBeNull();
      const res = await context.request.post(
        `http://localhost:4000/api/v1/restaurants/${restaurantId}/pos/orders/${orderId}/terminal-payment/${paymentId}/mock-complete`,
        { headers: { Authorization: staffAuthHeader! }, data: { outcome } }
      );
      expect(res.ok()).toBe(true);
    }

    // =========================================================================================
    // 1. Terminal configured -> the real state-machine UI appears, not the honest fallback.
    // =========================================================================================
    await ringUpCardOrder();
    await expect(page.getByRole("button", { name: "Start card payment" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Send \$18\.00 to the card terminal/)).toBeVisible();

    const createResPromise = page.waitForResponse(
      (res) => res.url().includes("/terminal-payment") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Start card payment" }).click();
    await expect(page.getByText("Waiting for card...")).toBeVisible({ timeout: 10_000 });
    const createBody = await (await createResPromise).json();
    const orderId1: string = createBody.data.payment.orderId;
    const paymentId1: string = createBody.data.payment.id;

    // --- Approved: the real poll (not a client-side assumption) picks up the mock's outcome. ---
    await mockComplete(orderId1, paymentId1, "paid");
    await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });
    const paidOrder = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId1) });
    expect(paidOrder!.paymentStatus).toBe("paid");
    const paidPayment = await db.collection("payments").findOne({ _id: new mongoose.Types.ObjectId(paymentId1) });
    expect(paidPayment!.status).toBe("paid");
    expect(paidPayment!.method).toBe("pos_terminal");

    // =========================================================================================
    // 2. Declined -> order stays unpaid; Retry starts a genuinely new attempt.
    // =========================================================================================
    await page.getByRole("button", { name: "New sale" }).click();
    await ringUpCardOrder();
    const declineResPromise = page.waitForResponse(
      (res) => res.url().includes("/terminal-payment") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Start card payment" }).click();
    await expect(page.getByText("Waiting for card...")).toBeVisible({ timeout: 10_000 });
    const declineBody = await (await declineResPromise).json();
    const orderId2: string = declineBody.data.payment.orderId;
    const paymentId2: string = declineBody.data.payment.id;

    await mockComplete(orderId2, paymentId2, "failed");
    await expect(page.getByText("Payment declined")).toBeVisible({ timeout: 10_000 });
    const declinedOrder = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId2) });
    expect(declinedOrder!.paymentStatus).toBe("unpaid");
    expect((await db.collection("payments").findOne({ _id: new mongoose.Types.ObjectId(paymentId2) }))!.status).toBe("failed");

    // Retry immediately starts a genuinely new attempt (not a reset back to "idle") — this one
    // succeeds, proving a decline is recoverable, not a dead end.
    const retryResPromise = page.waitForResponse((res) => res.url().includes("/terminal-payment") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Retry card payment" }).click();
    await expect(page.getByText("Waiting for card...")).toBeVisible({ timeout: 10_000 });
    const retryBody = await (await retryResPromise).json();
    const retryPaymentId: string = retryBody.data.payment.id;
    expect(retryPaymentId).not.toBe(paymentId2);

    await mockComplete(orderId2, retryPaymentId, "paid");
    await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });
    expect((await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId2) }))!.paymentStatus).toBe("paid");
    expect(await db.collection("payments").countDocuments({ orderId: new mongoose.Types.ObjectId(orderId2) })).toBe(2);

    // A separate, third order proves "cancel sale" directly from the declined screen also works
    // (without retrying first).
    await page.getByRole("button", { name: "New sale" }).click();
    await ringUpCardOrder();
    const secondDeclineResPromise = page.waitForResponse((res) => res.url().includes("/terminal-payment") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Start card payment" }).click();
    await expect(page.getByText("Waiting for card...")).toBeVisible({ timeout: 10_000 });
    const secondDeclineBody = await (await secondDeclineResPromise).json();
    await mockComplete(secondDeclineBody.data.payment.orderId, secondDeclineBody.data.payment.id, "failed");
    await expect(page.getByText("Payment declined")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Cancel sale" }).click();
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 10_000 }); // back to a fresh register
    const cancelledSaleOrder = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(secondDeclineBody.data.payment.orderId) });
    expect(cancelledSaleOrder!.status).toBe("cancelled");

    // =========================================================================================
    // 3. Staff cancels a still-in-flight payment directly (never mock-complete) — order stays
    //    unpaid, and the underlying Payment is genuinely cancelled server-side.
    // =========================================================================================
    await ringUpCardOrder();
    const cancelInFlightPromise = page.waitForResponse(
      (res) => res.url().includes("/terminal-payment") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Start card payment" }).click();
    await expect(page.getByText("Waiting for card...")).toBeVisible({ timeout: 10_000 });
    const cancelBody = await (await cancelInFlightPromise).json();
    const orderId3: string = cancelBody.data.payment.orderId;
    const paymentId3: string = cancelBody.data.payment.id;

    await page.getByRole("button", { name: "Cancel payment" }).click();
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 10_000 });
    const cancelledPayment = await db.collection("payments").findOne({ _id: new mongoose.Types.ObjectId(paymentId3) });
    expect(cancelledPayment!.status).toBe("cancelled");
    const cancelledOrder3 = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId3) });
    expect(cancelledOrder3!.status).toBe("cancelled");
    expect(cancelledOrder3!.paymentStatus).not.toBe("paid");
  });
});

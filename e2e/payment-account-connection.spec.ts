import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 42 — the redesigned "Online Payments" connection experience (Settings > Payment >
 * PaymentAccountSettingsPanel.tsx): a plain connected/not-connected state, no raw provider IDs or
 * "shared platform account" language, and a ConfirmDialog (not a native confirm()) for disconnect.
 *
 * Two of the three real states are exercised without depending on any live external network call
 * (this environment has no real Stripe/Safepay credentials configured):
 *  - "Connect payment account" deterministically surfaces a real, clean validation error when
 *    clicked on a restaurant with no country set yet (connectStripeConnect's own precondition
 *    check, which fires before any network call) — proves the button starts the real server-side
 *    flow rather than doing nothing, without depending on Stripe's actual API being reachable.
 *  - The "connected" state is reached by seeding an active RestaurantPaymentAccount directly via
 *    Mongo (disconnect never calls the provider at all — a pure status flip — so this exercises the
 *    real disconnect endpoint end to end), the same "seed what a real external step can't exercise"
 *    convention payment-settings-and-loyalty.spec.ts already uses for invite tokens.
 *
 * Provisions its own fresh restaurant rather than mutating the shared demo restaurant's payment
 * account state, which other specs don't expect to change.
 */
test.describe.serial("payment account connection experience (Phase 42)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("disconnected state, connect attempt, seeded connected state, and disconnect via ConfirmDialog", async ({ browser }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-payment-account-${stamp}`;
    const restaurantName = `E2E Payment Account ${stamp}`;
    const ownerEmail = `e2e-payment-account-owner-${stamp}@test.local`;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      // --- Provision a fresh restaurant + owner. ---
      await adminPage.goto("http://localhost:5174/login");
      await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
      await adminPage.locator('input[type="password"]').fill("Admin123!");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await expect(adminPage).toHaveURL(/\/platform$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Restaurants" }).click();
      await adminPage.getByRole("button", { name: "Create restaurant" }).click();
      await adminPage.getByLabel("Name", { exact: true }).fill(restaurantName);
      await adminPage.getByLabel("Slug").fill(slug);
      await adminPage.getByLabel("Full name").fill("Payment Account Owner");
      await adminPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await adminPage.getByRole("button", { name: "Create restaurant & send invite" }).click();
      await expect(adminPage.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await db.collection("users").updateOne(
        { email: ownerEmail },
        { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      await adminPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await adminPage.locator('input[type="password"]').fill("PaymentAccountOwner123!");
      await adminPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(adminPage).toHaveURL(/\/$/, { timeout: 10_000 });

      // --- Disconnected state: plain "Connect payment account" CTA, no jargon. ---
      await adminPage.getByRole("link", { name: "Settings" }).click();
      await adminPage.getByRole("button", { name: "Payment" }).click();
      await expect(adminPage.getByRole("heading", { name: "Online Payments" })).toBeVisible();
      await expect(adminPage.getByText(/we don't take a commission/i)).toBeVisible();
      const connectButton = adminPage.getByRole("button", { name: "Connect payment account" });
      await expect(connectButton).toBeVisible();

      // --- Clicking Connect genuinely starts the real Stripe Connect flow server-side; a
      // freshly-provisioned restaurant has no country set yet, so connectStripeConnect's own
      // precondition check rejects it cleanly (before any network call) — proves the button is
      // wired to the real endpoint, not a no-op. ---
      await connectButton.click();
      await expect(adminPage.getByText(/Set this restaurant's country/i)).toBeVisible({ timeout: 10_000 });

      // --- Seed an active connected account directly (no real Stripe/Safepay account available
      // in this environment) and reload to reach the connected state. ---
      const restaurant = await db.collection("restaurants").findOne({ slug });
      const business = await db.collection("businesses").findOne({ _id: restaurant!.businessId });
      const owner = await db.collection("users").findOne({ email: ownerEmail });
      await db.collection("restaurantpaymentaccounts").insertOne({
        restaurantId: restaurant!._id,
        businessId: business?._id ?? restaurant!._id,
        provider: "stripe",
        connectionMode: "platform_connect",
        status: "active",
        connectedAccountId: "acct_e2e_seeded",
        chargesEnabled: true,
        payoutsEnabled: true,
        connectedByUserId: owner!._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adminPage.reload();
      await adminPage.getByRole("button", { name: "Payment" }).click();
      await expect(adminPage.getByText("Payment account connected")).toBeVisible({ timeout: 10_000 });
      await expect(adminPage.getByText("Your account is connected and ready to accept online payments.")).toBeVisible();
      // No raw provider account id anywhere on the page.
      await expect(adminPage.getByText("acct_e2e_seeded")).toHaveCount(0);

      // --- Disconnect goes through the real ConfirmDialog, not a native confirm(). ---
      await adminPage.getByRole("button", { name: "Manage connection" }).click();
      await adminPage.getByRole("button", { name: "Disconnect" }).click();
      await expect(adminPage.getByRole("heading", { name: "Disconnect payment account?" })).toBeVisible();
      await expect(adminPage.getByText(/Online payments will stop working/i)).toBeVisible();
      await adminPage.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
      await expect(adminPage.getByRole("heading", { name: "Disconnect payment account?" })).toHaveCount(0);
      await expect(adminPage.getByRole("button", { name: "Connect payment account" })).toBeVisible({ timeout: 10_000 });
    } finally {
      await adminContext.close();
    }
  });
});

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 78 — the real, restaurant-facing Uber Eats connect experience: "Connect Uber Eats" redirects
 * the browser to a real authorize URL server-side (never a manual store-ID form for this provider),
 * and MARKETPLACE_PROVIDER_MODE=mock (this environment's default) makes that authorize URL point
 * straight back at this same admin app's own callback route with a canned code — so this spec drives
 * the ENTIRE real code path (state mint -> redirect -> callback -> token exchange -> store discovery
 * -> persistence) via genuine browser clicks, with zero third-party origin involved, mirroring
 * payment-account-connection.spec.ts's own "real click-through in mock mode" structure.
 *
 * Provisions its own fresh restaurant rather than mutating the shared demo restaurant's marketplace
 * connection state, which other specs don't expect to change.
 */
test.describe.serial("marketplace Uber Eats connect experience (Phase 78)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("connect via real redirect, verify connected state, disconnect, and reconnect", async ({ browser }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-uber-eats-connect-${stamp}`;
    const restaurantName = `E2E Uber Eats Connect ${stamp}`;
    const ownerEmail = `e2e-uber-eats-owner-${stamp}@test.local`;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    // MarketplaceIntegrationsPage.tsx's disconnect action still uses a native window.confirm — not
    // yet migrated to the ConfirmDialog component the payment panel uses. Auto-accept it.
    adminPage.on("dialog", (dialog) => dialog.accept());

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
      await adminPage.getByLabel("Full name").fill("Uber Eats Connect Owner");
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
      await adminPage.locator('input[type="password"]').fill("UberEatsConnectOwner123!");
      await adminPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(adminPage).toHaveURL(/\/$/, { timeout: 10_000 });

      // --- Not-connected state: a real "Connect Uber Eats" button, never a manual store-ID form. ---
      await adminPage.getByRole("link", { name: "Marketplace" }).click();
      await expect(adminPage.getByRole("heading", { name: "Marketplace integrations" })).toBeVisible();
      const uberEatsCard = adminPage.locator(".rounded-xl").filter({ hasText: "Uber Eats" });
      await expect(uberEatsCard.getByText("Not connected")).toBeVisible();
      const connectButton = adminPage.getByRole("button", { name: "Connect Uber Eats" });
      await expect(connectButton).toBeVisible();

      // --- Click through the REAL flow: server mints state, redirects to Uber's authorize URL,
      // which in mock mode points straight back at our own callback with a canned code. ---
      await connectButton.click();
      await expect(adminPage).toHaveURL(/\/marketplace\/oauth-callback/, { timeout: 10_000 });
      await expect(adminPage.getByText("Uber Eats connected ✓")).toBeVisible({ timeout: 10_000 });

      // --- Auto-navigates back to /marketplace once connected. ---
      await expect(adminPage).toHaveURL(/\/marketplace$/, { timeout: 10_000 });
      await expect(adminPage.getByText("Connected", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(adminPage.getByText(/Store ID/)).toBeVisible();
      await expect(adminPage.getByText(/mock_store_/)).toBeVisible();
      // No raw credential ever rendered anywhere on the page.
      await expect(adminPage.getByText(/mock_access_token/)).toHaveCount(0);

      // --- Disconnect (native confirm auto-accepted above). ---
      await adminPage.getByRole("button", { name: "Disconnect" }).click();
      await expect(adminPage.getByText(/mock_store_/)).toHaveCount(0, { timeout: 10_000 });
      await expect(adminPage.getByRole("button", { name: "Connect Uber Eats" })).toBeVisible();

      // --- Reconnecting works again, and leaves exactly one active integration. ---
      await adminPage.getByRole("button", { name: "Connect Uber Eats" }).click();
      await expect(adminPage).toHaveURL(/\/marketplace$/, { timeout: 15_000 });
      await expect(adminPage.getByText(/mock_store_/)).toBeVisible({ timeout: 10_000 });

      const restaurant = await db.collection("restaurants").findOne({ slug });
      const activeCount = await db
        .collection("restaurantmarketplaceintegrations")
        .countDocuments({ restaurantId: restaurant!._id, provider: "uber_eats", status: "active" });
      expect(activeCount).toBe(1);
    } finally {
      await adminContext.close();
    }
  });
});

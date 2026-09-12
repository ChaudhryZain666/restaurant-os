import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 73 — proves the two biggest gaps the audit found in the existing POS, both fixed this
 * phase, through the real UI end to end:
 *
 * 1. A staff member with NO prior Owner Portal session can open the POS URL directly in a fresh
 *    browser, sign in, and land on the actual register — not on Orders Management, not on the
 *    Dashboard (see RequireAuth.tsx/LoginPage.tsx's new location.state.from return-path). A role
 *    without restaurant.pos.operate (kitchen_staff) hitting the same URL is still correctly turned
 *    away after authenticating, proving the return-path convenience never bypasses the real
 *    permission gate.
 * 2. Every POS sale — cash or card — now requires an explicit payment-confirmation step before
 *    the order is marked paid (PaymentConfirmation.tsx), instead of the previous one-tap-instantly-
 *    paid behavior. Covers: an insufficient cash amount cannot complete the sale, a sufficient one
 *    computes the right change due, and a declined/cancelled card sale leaves no paid order behind.
 *
 * Lock/switch-staff (also new this phase, LockScreen.tsx) is covered in the same spec since it
 * shares this file's already-provisioned restaurant/staff fixtures.
 */
test.describe.serial("POS direct access, lock/switch, and payment confirmation (Phase 73)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("direct /pos access, RBAC on the return path, lock/switch, and cash/card payment confirmation", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const slug = `e2e-pos-direct-${stamp}`;
    const restaurantName = `E2E POS Direct ${stamp}`;
    const ownerEmail = `e2e-pos-direct-owner-${stamp}@test.local`;
    const staffEmail = `e2e-pos-direct-staff-${stamp}@test.local`;
    const kitchenEmail = `e2e-pos-direct-kitchen-${stamp}@test.local`;
    const ownerPassword = "PosDirectOwner123!";
    const staffPassword = "PosDirectStaff123!";
    const kitchenPassword = "PosDirectKitchen123!";
    const itemName = `Direct Access Sandwich ${stamp}`;
    const categoryName = `Direct Access Category ${stamp}`;

    async function acceptInviteFor(email: string, password: string) {
      const rawToken = randomBytes(32).toString("hex");
      await db.collection("users").updateOne(
        { email },
        { $set: { inviteTokenHash: createHash("sha256").update(rawToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
      );
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await p.locator('input[type="password"]').fill(password);
      await p.getByRole("button", { name: "Accept invitation" }).click();
      await expect(p).toHaveURL(/\/(orders|kitchen)$/, { timeout: 10_000 });
      await ctx.close();
    }

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
    await page.getByLabel("Full name").fill("Direct Access Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const ownerRawToken = randomBytes(32).toString("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: createHash("sha256").update(ownerRawToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${ownerRawToken}`);
    await page.locator('input[type="password"]').fill(ownerPassword);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Enable POS. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Ordering", exact: true }).click();
    await page.locator("label", { hasText: "Enable the staff POS terminal" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    // --- Invite a POS-permitted staff member (default role) and a kitchen_staff member. ---
    await page.getByRole("link", { name: "Staff" }).click();
    await page.getByRole("button", { name: "Add staff member" }).click();
    await page.getByLabel("Name").fill("Direct Access Staff");
    await page.getByLabel("Email").fill(staffEmail);
    await page.getByRole("button", { name: "Send invite", exact: true }).click();
    await expect(page.getByText(`Invitation sent to ${staffEmail}`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add staff member" }).click();
    await page.getByLabel("Name").fill("Direct Access Kitchen");
    await page.getByLabel("Email").fill(kitchenEmail);
    await page.getByLabel("Role").selectOption({ label: "Kitchen staff" });
    await page.getByRole("button", { name: "Send invite", exact: true }).click();
    await expect(page.getByText(`Invitation sent to ${kitchenEmail}`)).toBeVisible({ timeout: 10_000 });

    await acceptInviteFor(staffEmail, staffPassword);
    await acceptInviteFor(kitchenEmail, kitchenPassword);

    // --- Owner adds a real menu item and publishes. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("15");
    await page.getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Customize this item")).toBeVisible();
    await page.getByRole("button", { name: "Back to menu" }).click();

    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // =========================================================================================
    // 1. Direct URL access — a genuinely fresh, unauthenticated browser context hits /pos first.
    // =========================================================================================
    const freshStaffCtx = await browser.newContext();
    const staffPage = await freshStaffCtx.newPage();
    try {
      await staffPage.goto("http://localhost:5174/pos");
      // No prior session anywhere — RequireAuth bounces to /login, remembering /pos.
      await expect(staffPage).toHaveURL(/\/login$/, { timeout: 10_000 });
      await staffPage.locator('input[type="email"]').fill(staffEmail);
      await staffPage.locator('input[type="password"]').fill(staffPassword);
      await staffPage.getByRole("button", { name: "Sign in" }).click();
      // Lands back on /pos itself — never Orders Management, never the Dashboard.
      await expect(staffPage).toHaveURL(/\/pos$/, { timeout: 10_000 });
      await expect(staffPage.getByRole("heading", { name: "Register" })).toBeVisible({ timeout: 10_000 });
      await expect(staffPage.getByText(itemName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Left open deliberately — reused below for the lock/switch and payment sections.
    }

    // A role WITHOUT restaurant.pos.operate hitting the same URL is still correctly turned away
    // after authenticating — the return-path convenience never bypasses the real permission gate.
    const freshKitchenCtx = await browser.newContext();
    const kitchenPage = await freshKitchenCtx.newPage();
    try {
      await kitchenPage.goto("http://localhost:5174/pos");
      await expect(kitchenPage).toHaveURL(/\/login$/, { timeout: 10_000 });
      await kitchenPage.locator('input[type="email"]').fill(kitchenEmail);
      await kitchenPage.locator('input[type="password"]').fill(kitchenPassword);
      await kitchenPage.getByRole("button", { name: "Sign in" }).click();
      await expect(kitchenPage).not.toHaveURL(/\/pos$/, { timeout: 10_000 });
      await expect(kitchenPage).toHaveURL(/\/kitchen$/, { timeout: 10_000 });
    } finally {
      await freshKitchenCtx.close();
    }

    // =========================================================================================
    // 2. Lock / switch staff member, on the staff member's already-authenticated /pos session.
    // =========================================================================================
    await staffPage.getByRole("button", { name: "Lock POS" }).click();
    await expect(staffPage.getByRole("heading", { name: "POS locked" })).toBeVisible();
    // The register underneath is genuinely inert while locked, not just visually covered by the
    // overlay — a real click at its coordinates cannot reach it (Playwright's own actionability
    // check refuses to click an element another one is intercepting).
    await expect(staffPage.getByText(itemName).click({ timeout: 2_000 })).rejects.toThrow();

    await staffPage.locator('input[type="password"]').fill("WrongPassword123!");
    await staffPage.getByRole("button", { name: "Unlock" }).click();
    await expect(staffPage.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(staffPage.getByRole("heading", { name: "POS locked" })).toBeVisible();

    await staffPage.locator('input[type="password"]').fill(staffPassword);
    await staffPage.getByRole("button", { name: "Unlock" }).click();
    await expect(staffPage.getByRole("heading", { name: "POS locked" })).not.toBeVisible({ timeout: 10_000 });
    await expect(staffPage.getByText(itemName)).toBeVisible();

    // Switch to the owner (a different staff member with the same POS permission) from the lock
    // screen — the "same POS context" the terminal was locked from.
    await staffPage.getByRole("button", { name: "Lock POS" }).click();
    await staffPage.getByRole("button", { name: "Not you? Switch staff member" }).click();
    await staffPage.getByLabel("Email").fill(ownerEmail);
    await staffPage.locator('input[type="password"]').fill(ownerPassword);
    await staffPage.getByRole("button", { name: "Sign in" }).click();
    await expect(staffPage.getByRole("heading", { name: "POS locked" })).not.toBeVisible({ timeout: 10_000 });
    await expect(staffPage).toHaveURL(/\/pos$/);
    await expect(staffPage.getByText("Direct Access Owner")).toBeVisible();

    // =========================================================================================
    // 3. Payment confirmation — cash: an insufficient amount cannot complete the sale.
    // =========================================================================================
    await staffPage.getByText(itemName).click();
    await staffPage.getByRole("button", { name: "Select customer" }).click();
    await staffPage.getByRole("button", { name: "Continue without a name" }).click();
    await staffPage.getByRole("button", { name: /Take .* cash/ }).click();
    await expect(staffPage.getByText("Order #")).not.toBeVisible();

    await staffPage.getByLabel("Cash received").fill("5"); // less than the $15 item
    await expect(staffPage.getByRole("button", { name: "Complete payment" })).toBeDisabled();

    await staffPage.getByLabel("Cash received").fill("20");
    await expect(staffPage.getByText("$5.00")).toBeVisible(); // change due
    await staffPage.getByRole("button", { name: "Complete payment" }).click();
    await expect(staffPage.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });

    const restaurantDoc = await db.collection("restaurants").findOne({ slug });
    const cashOrder = await db.collection("orders").findOne({ restaurantId: restaurantDoc!._id }, { sort: { createdAt: -1 } });
    expect(cashOrder!.paymentStatus).toBe("paid");
    expect(cashOrder!.paymentMethod).toBe("cash");

    // =========================================================================================
    // 4. Payment confirmation — card: declining/cancelling never leaves a paid order behind.
    // =========================================================================================
    await staffPage.getByRole("button", { name: "New sale" }).click();
    await staffPage.getByText(itemName).click();
    await staffPage.getByRole("button", { name: "Select customer" }).click();
    await staffPage.getByRole("button", { name: "Continue without a name" }).click();
    await staffPage.getByRole("button", { name: "Card" }).click();
    await staffPage.getByRole("button", { name: /Charge/ }).click();
    await expect(staffPage.getByRole("button", { name: "Payment approved" })).toBeVisible({ timeout: 10_000 });

    const ordersBeforeDecline = await db.collection("orders").countDocuments({ restaurantId: restaurantDoc!._id, paymentStatus: "paid" });
    await staffPage.getByRole("button", { name: "Payment declined / cancel sale" }).click();
    await expect(staffPage.getByText(itemName)).toBeVisible({ timeout: 10_000 }); // back to a fresh register
    const declinedOrder = await db.collection("orders").findOne({ restaurantId: restaurantDoc!._id }, { sort: { createdAt: -1 } });
    expect(declinedOrder!.status).toBe("cancelled");
    expect(declinedOrder!.paymentStatus).not.toBe("paid");
    const ordersAfterDecline = await db.collection("orders").countDocuments({ restaurantId: restaurantDoc!._id, paymentStatus: "paid" });
    expect(ordersAfterDecline).toBe(ordersBeforeDecline); // no new paid order from the declined sale

    // A real "approved" card sale does mark the order paid.
    await staffPage.getByText(itemName).click();
    await staffPage.getByRole("button", { name: "Select customer" }).click();
    await staffPage.getByRole("button", { name: "Continue without a name" }).click();
    await staffPage.getByRole("button", { name: "Card" }).click();
    await staffPage.getByRole("button", { name: /Charge/ }).click();
    await staffPage.getByRole("button", { name: "Payment approved" }).click();
    await expect(staffPage.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });
    const approvedOrder = await db.collection("orders").findOne({ restaurantId: restaurantDoc!._id }, { sort: { createdAt: -1 } });
    expect(approvedOrder!.paymentMethod).toBe("card");
    expect(approvedOrder!.paymentStatus).toBe("paid");

    await staffPage.close();
    await freshStaffCtx.close();
  });
});

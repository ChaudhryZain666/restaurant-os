import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 14 golden path — the exact scenario the Phase 13 audit found impossible without a
 * developer manually calling the API: a brand-new restaurant, created entirely through the admin
 * UI (never seed.ts, never a raw API call from this test), goes from zero to a completed,
 * printable order.
 *
 * One deliberate, documented exception: the owner's invite token only ever leaves the server via
 * a real outbound email (apps/api's ConsoleEmailProvider just logs it server-side — there's no
 * test-capture mailbox in this codebase, and building one is exactly the kind of new
 * infrastructure Phase 14 says not to add for its own sake). Rather than skip proving the
 * accept-invite step, this test reads/writes that one field directly against the same MongoDB the
 * dev API already uses (see apps/api/.env's MONGO_URI) — mirroring exactly what
 * restaurant.controller.test.ts's Jest coverage already does for the identical token mechanics.
 * Everything else — every click, every page, every status transition — goes through the real UI.
 */
test.describe.serial("restaurant provisioning golden path (Phase 14)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("platform admin provisions a restaurant -> owner sets up and publishes -> customer orders -> kitchen fulfills -> receipt prints", async ({
    browser,
  }) => {
    // Genuinely the longest single flow in this suite — provisioning, invite acceptance, menu
    // creation, publish, a real order, and both print views, all in sequence.
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slug = `e2e-golden-${stamp}`;
    const restaurantName = `E2E Golden Path ${stamp}`;
    const ownerEmail = `e2e-golden-owner-${stamp}@test.local`;
    const itemName = `Golden Burger ${stamp}`;
    const categoryName = `Golden Category ${stamp}`;
    const customerEmail = `e2e-golden-customer-${stamp}@test.local`;

    const adminContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      // --- Platform admin creates the restaurant through the real UI (the workflow that
      // previously didn't exist at all — Phase 13's headline finding). ---
      await adminPage.goto("http://localhost:5174/login");
      await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
      await adminPage.locator('input[type="password"]').fill("Admin123!");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await expect(adminPage).toHaveURL(/\/platform$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Restaurants" }).click();
      await adminPage.getByRole("button", { name: "Create restaurant" }).click();
      await expect(adminPage).toHaveURL(/\/platform\/restaurants\/new$/);

      await adminPage.getByLabel("Name", { exact: true }).fill(restaurantName);
      // Auto-slugified from the name — overwrite with our own unique, deterministic slug. Not
      // an exact-name match: the Slug field's <label> also wraps its helper hint text, so its
      // full computed accessible name is longer than just "Slug".
      await adminPage.getByLabel("Slug").fill(slug);
      await adminPage.getByLabel("Full name").fill("Golden Owner");
      await adminPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await adminPage.getByRole("button", { name: "Create restaurant & send invite" }).click();

      await expect(adminPage.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });
      await expect(adminPage.getByText(ownerEmail)).toBeVisible();

      await adminPage.getByRole("button", { name: "Back to Restaurants" }).click();
      const newRow = adminPage.locator("tr", { hasText: restaurantName });
      await expect(newRow).toBeVisible();
      // Pending, not live — the whole point of the publish gate (Phase 14's P0-3).
      await expect(newRow.getByText("pending", { exact: true })).toBeVisible();
      await expect(newRow.getByText("Invite pending")).toBeVisible();

      // A customer cannot reach this restaurant while it's still pending — the exact enforcement
      // getRestaurantBySlug already had, now doing real work for a restaurant nothing but a
      // rewritten status default ever used to reach.
      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByText("We can't find that restaurant")).toBeVisible({ timeout: 10_000 });

      // --- Owner accepts their invitation. The raw token only ever reached a real inbox (never
      // this test's HTTP traffic) — see this file's top comment for why the next few lines read
      // it directly from Mongo rather than skipping this step. ---
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const usersCollection = db.collection("users");
      const updateResult = await usersCollection.updateOne(
        { email: ownerEmail },
        { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      expect(updateResult.matchedCount).toBe(1);

      await adminPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await adminPage.locator('input[type="password"]').fill("GoldenOwner123!");
      await adminPage.getByRole("button", { name: "Accept invitation" }).click();

      // A pending restaurant's owner lands on Setup, not the analytics Dashboard (Phase 14 —
      // DashboardPage.tsx redirects here for exactly this case).
      await expect(adminPage).toHaveURL(/\/setup$/, { timeout: 10_000 });
      await expect(adminPage.getByText("Not published yet")).toBeVisible();
      await expect(adminPage.getByRole("button", { name: "Publish restaurant" })).toBeDisabled();

      // --- Owner builds a menu through the real Menu page. ---
      await adminPage.getByRole("link", { name: "Menu", exact: true }).click();
      await adminPage.getByPlaceholder("New category name").fill(categoryName);
      await adminPage.getByRole("button", { name: "Add category" }).click();
      await expect(adminPage.locator("li", { hasText: categoryName })).toBeVisible();

      await adminPage.getByRole("button", { name: "+ Add menu item" }).click();
      await adminPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
      await adminPage.getByPlaceholder("Base price").fill("12");
      await adminPage.getByRole("combobox").selectOption({ label: categoryName });
      await adminPage.getByRole("button", { name: "Create item & continue" }).click();
      // No modifier groups configured — a plain item, "Add to cart" will add it directly.
      await expect(adminPage.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
      await adminPage.getByRole("button", { name: "Done" }).click();

      // --- Back to Setup: readiness now passes, publish becomes available and works. ---
      await adminPage.getByRole("link", { name: "Setup" }).click();
      await expect(adminPage.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
      await adminPage.getByRole("button", { name: "Publish restaurant" }).click();
      await expect(adminPage.getByText("Published")).toBeVisible({ timeout: 10_000 });
      await expect(adminPage.getByRole("link", { name: "View live storefront" })).toBeVisible();

      // --- Customer discovers the now-live restaurant and places a real order. ---
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("Golden Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("GoldenCustomer1!");
      const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
      await customerPage.getByRole("button", { name: "Create account" }).click();
      // Wait for the actual response before navigating away — a hard page.goto() right after the
      // click would cancel the still-in-flight register request, leaving the customer anonymous.
      expect((await registerRes).status()).toBe(201);

      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByRole("heading", { name: restaurantName })).toBeVisible({ timeout: 10_000 });
      const itemRow = customerPage.locator("li", { hasText: itemName });
      await itemRow.getByRole("button", { name: "Add to cart" }).click();

      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible();
      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(customerPage.getByText("Order placed successfully!")).toBeVisible();
      const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
      const orderNumber = heading.match(/ORD-\d+/)![0];

      // --- Kitchen processes the order and prints a ticket. ---
      await adminPage.getByRole("link", { name: "Kitchen" }).click();
      const kitchenCard = adminPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(kitchenCard).toBeVisible({ timeout: 10_000 });

      const ticketPopup = adminPage.waitForEvent("popup");
      await kitchenCard.getByRole("button", { name: "Print ticket" }).click();
      const ticketPage = await ticketPopup;
      await expect(ticketPage.getByText("KITCHEN TICKET")).toBeVisible({ timeout: 10_000 });
      await expect(ticketPage.getByText(itemName, { exact: false })).toBeVisible();
      await ticketPage.close();

      await kitchenCard.getByRole("button", { name: "Accept" }).click();
      await expect(kitchenCard.getByRole("button", { name: "Start preparing" })).toBeVisible();
      await kitchenCard.getByRole("button", { name: "Start preparing" }).click();
      await expect(kitchenCard.getByRole("button", { name: "Mark ready" })).toBeVisible();
      await kitchenCard.getByRole("button", { name: "Mark ready" }).click();
      await expect(kitchenCard.getByRole("button", { name: "Complete" })).toBeVisible();
      await kitchenCard.getByRole("button", { name: "Complete" }).click();
      await expect(kitchenCard).toHaveCount(0, { timeout: 10_000 });

      // --- Customer sees the completed order and prints a receipt. ---
      await customerPage.getByRole("link", { name: "Orders" }).click();
      await customerPage.getByRole("link", { name: orderNumber }).click();
      await expect(customerPage.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      const receiptPopup = customerPage.waitForEvent("popup");
      await customerPage.getByRole("button", { name: "Print receipt" }).click();
      const receiptPage = await receiptPopup;
      await expect(receiptPage.getByText("RECEIPT")).toBeVisible({ timeout: 10_000 });
      await expect(receiptPage.getByText(itemName, { exact: false })).toBeVisible();
      await expect(receiptPage.getByText(restaurantName)).toBeVisible();
      await receiptPage.close();
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});

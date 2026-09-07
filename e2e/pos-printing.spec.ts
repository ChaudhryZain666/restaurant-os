import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 57 — the printer/receipt/reprint architecture, driven through the real UI end to end.
 * Reuses the exact platform-admin-provisions-a-restaurant boilerplate established by
 * restaurant-provisioning-golden-path.spec.ts / pos-delivery-order.spec.ts (same documented
 * invite-token-via-Mongo exception — no real outbound email in this environment).
 *
 * Covers: printer configuration (CRUD + default-per-purpose), a real POS order, the automatic
 * kitchen-ticket print attempt (which — honestly, not a bug — cannot open a popup without a user
 * gesture, see adapters.ts's ExecuteContext comment, so it predictably reports "failed" here), a
 * manual retry that DOES have a real click and succeeds (asserted via the real opened print tab's
 * content), a manual receipt print (same), reprint tracking (second print of the same order/kind is
 * visibly marked REPRINT on the printed page), and a genuine, deterministic printer failure (an
 * unreachable local_bridge address — a real fetch() that really fails, not a fabricated one) via
 * Test Print. Role/tenant-isolation for printers is covered at the API integration-test level
 * (printer.controller.test.ts, printJob.controller.test.ts) and is not duplicated here.
 */
test.describe.serial("POS printing (Phase 57)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("owner configures printers, rings up an order, prints/reprints receipts and kitchen tickets, and a real printer failure is visible and retryable", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-pos-printing-${stamp}`;
    const restaurantName = `E2E POS Printing ${stamp}`;
    const ownerEmail = `e2e-pos-printing-owner-${stamp}@test.local`;
    const itemName = `Printing Test Sandwich ${stamp}`;
    const categoryName = `Printing Test Category ${stamp}`;

    // --- Platform admin provisions the restaurant (golden-path pattern). ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Printing Test Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("PrintingTestOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Enable POS through the real Settings UI. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Ordering", exact: true }).click();
    await page.locator("label", { hasText: "Enable the staff POS terminal" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    // --- Configure printers through the real Printers page. ---
    await page.getByRole("link", { name: "Printers" }).click();
    await expect(page.getByText("No printers configured yet")).toBeVisible();

    await page.getByRole("button", { name: "Add a printer" }).click();
    await page.getByLabel("Name").fill("Front Counter");
    await page.getByLabel("Used for").selectOption({ label: "Receipt" });
    await page.getByLabel("Connection").selectOption({ label: "Browser / OS print" });
    await page.locator("label", { hasText: "Use as the default receipt printer" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Add printer" }).click();
    await expect(page.getByText("Front Counter")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Default")).toBeVisible();

    await page.getByRole("button", { name: "Add a printer" }).click();
    await page.getByLabel("Name").fill("Kitchen 1");
    await page.getByLabel("Used for").selectOption({ label: "Kitchen" });
    await page.getByLabel("Connection").selectOption({ label: "Browser / OS print" });
    await page.locator("label", { hasText: "Use as the default kitchen printer" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Add printer" }).click();
    await expect(page.getByText("Kitchen 1")).toBeVisible({ timeout: 10_000 });

    // A genuine, deterministic printer failure — a real fetch() to a local_bridge address nothing
    // is listening on, never a fabricated status. See adapters.ts's localBridgeAdapter.
    await page.getByRole("button", { name: "Add a printer" }).click();
    await page.getByLabel("Name").fill("Broken Bridge");
    await page.getByLabel("Used for").selectOption({ label: "Bar" });
    await page.getByLabel("Connection").selectOption({ label: "Network printer via local bridge" });
    await page.getByLabel("Bridge address").fill("http://localhost:19999");
    await page.getByRole("button", { name: "Add printer" }).click();
    await expect(page.getByText("Broken Bridge")).toBeVisible({ timeout: 10_000 });

    const brokenBridgeCard = page.getByTestId("printer-card-Broken Bridge");
    await brokenBridgeCard.getByRole("button", { name: "Test print" }).click();
    await expect(page.getByText("Print failed").first()).toBeVisible({ timeout: 10_000 });

    // --- Owner adds a menu item and publishes. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("12");
    await page.getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // --- Ring up a real POS order (pickup, cash — the default order type needs no extra click). ---
    await page.goto("http://localhost:5174/pos");
    await page.getByText(itemName).click();
    await page.getByRole("button", { name: "Select customer" }).click();
    await page.getByRole("button", { name: "Continue without a name" }).click();
    await page.getByRole("button", { name: /Take .* cash/ }).click();
    await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });

    // The order itself is unconditionally successful regardless of anything about printing.
    const restaurantDoc = await db.collection("restaurants").findOne({ slug });
    const order = await db.collection("orders").findOne({ restaurantId: restaurantDoc!._id }, { sort: { createdAt: -1 } });
    expect(order).toBeTruthy();
    expect(order!.paymentStatus).toBe("paid");

    // --- The automatic kitchen-ticket attempt genuinely cannot open a popup with no user gesture
    // behind it — an honest browser limitation, not a bug — so it reports failed, visibly, with a
    // Retry action right there on the completed-sale screen. ---
    await expect(page.getByText("Kitchen ticket:")).toBeVisible();
    await expect(page.getByText("Print failed")).toBeVisible({ timeout: 10_000 });
    const ticketPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Retry" }).click();
    const ticketPage = await ticketPopup;
    await expect(ticketPage.getByText("KITCHEN TICKET")).toBeVisible({ timeout: 10_000 });
    await expect(ticketPage.getByText(itemName, { exact: false })).toBeVisible();
    // A kitchen ticket never shows price/payment information (Section 6).
    await expect(ticketPage.getByText("$12.00")).not.toBeVisible();
    await ticketPage.close();

    // --- A real, explicit receipt print — this one is a genuine click, so it succeeds directly. ---
    const receiptPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Print receipt" }).click();
    const receiptPage = await receiptPopup;
    await expect(receiptPage.getByText("RECEIPT")).toBeVisible({ timeout: 10_000 });
    await expect(receiptPage.getByText(itemName, { exact: false })).toBeVisible();
    await expect(receiptPage.getByText("$12.00").first()).toBeVisible();
    await expect(receiptPage.getByText("REPRINT")).not.toBeVisible();
    await receiptPage.close();

    // --- Reprinting the same receipt is clearly marked as a reprint on the printed page itself,
    // and never creates a second order/payment. ---
    const ordersBefore = await db.collection("orders").countDocuments({ restaurantId: restaurantDoc!._id });
    const reprintPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Reprint receipt" }).click();
    const reprintPage = await reprintPopup;
    await expect(reprintPage.getByText("REPRINT")).toBeVisible({ timeout: 10_000 });
    await expect(reprintPage.getByText("RECEIPT")).toBeVisible();
    await reprintPage.close();
    const ordersAfter = await db.collection("orders").countDocuments({ restaurantId: restaurantDoc!._id });
    expect(ordersAfter).toBe(ordersBefore);

    // --- Server-side: real, tracked PrintJob rows exist for this order, distinguishing the failed
    // automatic attempt, the retried success, the receipt print, and the reprint. ---
    const jobs = await db.collection("printjobs").find({ orderId: order!._id }).toArray();
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs.some((j) => j.kind === "kitchen_ticket")).toBe(true);
    expect(jobs.some((j) => j.kind === "receipt" && j.isReprint === true)).toBe(true);
    expect(jobs.every((j) => j.status !== "queued")).toBe(true); // every job was actually attempted, not left dangling
  });
});

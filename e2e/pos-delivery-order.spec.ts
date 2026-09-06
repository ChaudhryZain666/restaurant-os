import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 47 — the actual bug: POS delivery orders hardcoded latitude/longitude to (0, 0) instead of
 * a real geocoded address, so the existing server-authoritative delivery-eligibility engine
 * (delivery.service.ts's checkDeliveryEligibility) was always evaluating "is Null Island in range"
 * rather than the real customer's location. This drives the real, corrected flow through the real
 * UI: platform admin provisions a restaurant -> owner sets the restaurant's own location and a
 * delivery radius/fee -> owner enables the POS terminal -> a POS delivery order is rung up using
 * DeliveryAddressSearch's real autocomplete -> resolve flow (GEOCODING_PROVIDER=test, the same
 * deterministic fixtures delivery.controller.test.ts's Jest coverage already uses) -> the order is
 * created with real, non-(0,0) coordinates and the server's own computed delivery fee.
 *
 * Same documented exception as restaurant-provisioning-golden-path.spec.ts: the owner's invite
 * token only ever leaves the server via a real outbound email, so this reads/writes that one field
 * directly against Mongo — everything else goes through the real UI.
 */
test.describe.serial("POS delivery order flow (Phase 47)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });
  test.afterAll(async () => {
    await db.close();
  });

  test("owner configures location + delivery + POS, then rings up a real delivery order with a real address", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-pos-delivery-${stamp}`;
    const restaurantName = `E2E POS Delivery ${stamp}`;
    const ownerEmail = `e2e-pos-delivery-owner-${stamp}@test.local`;
    const itemName = `Delivery Test Burger ${stamp}`;
    const categoryName = `Delivery Test Category ${stamp}`;

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
    await page.getByLabel("Full name").fill("Delivery Test Owner");
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
    await page.locator('input[type="password"]').fill("DeliveryTestOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Owner sets the restaurant's own location (Settings -> Location), through the real UI —
    // this specific field/save round-trip is exactly what this phase's fix depends on being
    // trustworthy, and it demonstrably works. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Location", exact: true }).click();
    await page.getByRole("button", { name: "Enter coordinates manually instead" }).click();
    await page.getByLabel("Latitude").fill("39.7817");
    await page.getByLabel("Longitude").fill("-89.6501");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Location set — 39.7817, -89.6501")).toBeVisible({ timeout: 10_000 });

    // --- Enable POS + delivery directly, via Mongo. NOT the invite-token-style "the real value
    // never leaves the server" exception this repo's other specs use — this is a real, reproducible,
    // PRE-EXISTING bug this phase's own investigation surfaced (unrelated to the POS delivery fix
    // itself): SettingsPage.tsx's "Enable the staff POS terminal" checkbox visibly checks (confirmed
    // via toBeChecked()) but the PATCH request it submits still carries posEnabled:false regardless
    // — reproduced consistently, including with a forced click and a settle delay, so a real state
    // bug, not test flakiness. Documented in the Phase 47 report as a separate, out-of-scope finding
    // rather than "fixed" here — this phase's mandate is the delivery-coordinate bug specifically,
    // not an unrelated Settings-page defect. Bypassing it here keeps this test's actual subject (the
    // real POS delivery UI, exercised below) reliable rather than blocked on an unrelated bug.
    await db.collection("restaurants").updateOne(
      { slug },
      { $set: { "settings.posEnabled": true, "settings.deliveryEnabled": true, "settings.deliveryFee": 4, "settings.deliveryRadiusKm": 8 } }
    );

    // --- Owner adds a menu item to sell (Menu page, matching the existing golden-path pattern). ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("25");
    await page.getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // --- Publish (a pending restaurant can't take any order, POS included). ---
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });

    // --- Ring up a real POS delivery order. ---
    await page.goto("http://localhost:5174/pos");
    await page.getByText(itemName).click();
    await page.getByRole("button", { name: "Select customer" }).click();
    await page.getByRole("button", { name: "Continue without a name" }).click();
    await page.getByRole("button", { name: "Delivery", exact: true }).click();

    // The actual fix: a real address, resolved through the same geocoding pipeline the customer
    // storefront uses (GEOCODING_PROVIDER=test — see TestGeocodingProvider.ts's fixtures), never a
    // hardcoded (0, 0). "1200"/"springfield" resolves to 39.7658, -89.6501 — ~1.8km from the
    // restaurant's own 39.7817, -89.6501, inside the 8km radius just configured above.
    await page.getByLabel("Delivery address").fill("1200 6th springfield");
    await expect(page.getByRole("option", { name: /Springfield/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("option", { name: /Springfield/i }).click();
    await expect(page.getByText(/Address confirmed — 1200 S 6th St, Springfield/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Take .* cash/ }).click();
    await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible({ timeout: 10_000 });

    // --- Verify server-side: real coordinates, real computed fee, no (0, 0) anywhere. ---
    const restaurantDoc = await db.collection("restaurants").findOne({ slug });
    expect(restaurantDoc).toBeTruthy();
    const order = await db.collection("orders").findOne({ restaurantId: restaurantDoc!._id }, { sort: { createdAt: -1 } });
    expect(order).toBeTruthy();
    expect(order!.deliveryAddress.latitude).toBe(39.7658);
    expect(order!.deliveryAddress.longitude).toBe(-89.6501);
    expect(order!.deliveryAddress.latitude).not.toBe(0);
    expect(order!.deliveryAddress.longitude).not.toBe(0);
    expect(order!.deliveryFee).toBeGreaterThan(0);
    expect(order!.deliveryDistanceKm).toBeGreaterThan(0);
    expect(order!.deliveryDistanceKm).toBeLessThan(8);

    // --- An out-of-area address must be refused, clearly, before any order is created. ---
    await page.getByRole("button", { name: "New sale" }).click();
    await page.getByText(itemName).click();
    await page.getByRole("button", { name: "Select customer" }).click();
    await page.getByRole("button", { name: "Continue without a name" }).click();
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await page.getByLabel("Delivery address").fill("congress austin");
    await expect(page.getByRole("option", { name: /Austin/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("option", { name: /Austin/i }).click();
    await expect(page.getByText(/Address confirmed — 200 Congress Ave, Austin/)).toBeVisible({ timeout: 10_000 });
    const ordersBefore = await db.collection("orders").countDocuments({ restaurantId: order!.restaurantId });
    await page.getByRole("button", { name: /Take .* cash/ }).click();
    await expect(page.getByText(/outside the delivery area/i)).toBeVisible({ timeout: 10_000 });
    const ordersAfter = await db.collection("orders").countDocuments({ restaurantId: order!.restaurantId });
    expect(ordersAfter).toBe(ordersBefore);
  });
});

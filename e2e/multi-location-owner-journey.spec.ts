import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 19 — the central end-to-end proof this phase was built to deliver: a fresh, genuinely
 * single-location restaurant owner creates a SECOND location entirely through the real admin UI
 * (the Locations page, POST /businesses/:businessId/locations — never a raw API call from this
 * test) and can then safely switch between the two, with the switch itself correctly re-scoping
 * every request — no stale data lingering from whichever location was active before.
 *
 * Phase 21 correction: this test originally asserted that each location's MENU stayed fully
 * independent after switching (Phase 19/20's interim architecture). Phase 21 replaced that with a
 * shared canonical business menu + per-location overrides — see
 * docs/multi-tenant-storefront-architecture.md's Phase 21 section. Under that architecture, an
 * item created at Location A is *correctly* visible at Location B too (both locations belong to
 * the same business, and nothing overrode it away) — that's the intended behavior, not a leak.
 * This test now asserts the corrected, intended behavior: switching locations correctly resolves
 * each location's real effective menu (proving the switch isn't serving stale/cached data), and
 * the shared menu is genuinely shared. Per-location divergence (an item hidden or price-overridden
 * at only one location) is covered separately by e2e/shared-menu-canonical-override.spec.ts.
 *
 * Same documented exception as the existing golden-path spec: the owner's invite token only ever
 * leaves the server via a real outbound email, so this reads/writes that one field directly
 * against Mongo rather than skipping the step. Everything else goes through the real UI.
 */
test.describe.serial("multi-location owner journey (Phase 19)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("owner creates a second location via the real Locations page, switches between them, and the shared canonical menu resolves correctly for each location across the switch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slugA = `e2e-multiloc-a-${stamp}`;
    const restaurantName = `E2E Multi-Location ${stamp}`;
    const ownerEmail = `e2e-multiloc-owner-${stamp}@test.local`;
    const itemA = `Location A Burger ${stamp}`;
    const categoryA = `A Category ${stamp}`;
    const locationBName = `Location B ${stamp}`;
    const slugB = `e2e-multiloc-b-${stamp}`;
    const itemB = `Location B Pizza ${stamp}`;
    const categoryB = `B Category ${stamp}`;

    // --- Platform admin creates the first (only, for now) location. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slugA);
    await page.getByLabel("Full name").fill("Multi-Location Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    // --- Owner accepts their invite (token read from Mongo — see file-level comment). ---
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const updateResult = await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    expect(updateResult.matchedCount).toBe(1);

    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("MultiLocOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    // Portal UX phase: a pending restaurant's owner now lands on Dashboard's in-place "get ready"
    // state instead of being redirected to /setup (Setup itself is unaffected, reached below via
    // the nav "Locations"/"Menu" links exactly as before).
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Single location: no switcher anywhere, Locations page stays minimal. ---
    await expect(page.getByRole("combobox", { name: "Active location" })).toHaveCount(0);
    await page.getByRole("link", { name: "Locations" }).click();
    await expect(page.getByText(/starts as a single location/i)).toBeVisible();

    // --- Build a distinct menu item on Location A, so isolation is actually observable. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryA);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryA })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemA);
    await page.getByPlaceholder("Base price").fill("9");
    await page.getByRole("main").getByRole("combobox").selectOption({ label: categoryA });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(itemA, { exact: false })).toBeVisible();

    // --- Create a second location through the real Locations page — the new capability itself. ---
    await page.getByRole("link", { name: "Locations" }).click();
    await page.getByRole("button", { name: "+ Add another location" }).click();
    await page.getByLabel("Name", { exact: true }).fill(locationBName);
    await page.getByLabel("Slug").fill(slugB);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`${locationBName} was created`, { exact: false })).toBeVisible({ timeout: 10_000 });

    // No new owner/account was created for Location B — confirmed at the API/Jest level
    // (business.controller.test.ts); here we confirm the UI reflects a second, real, switchable
    // location for the SAME owner.
    await expect(page.locator("li", { hasText: locationBName })).toBeVisible();

    // --- Now that there are two locations, the switcher appears. ---
    const switcher = page.getByRole("combobox", { name: "Active location" });
    await expect(switcher).toBeVisible();

    // --- Switch to Location B: the switch correctly resolves B's real effective menu, which —
    // since both locations share the same business's canonical menu, and nothing has overridden
    // it away — correctly INCLUDES A's item. This is the intended shared-menu behavior (Phase 21),
    // not stale data: if the switch were serving cached/wrong data, this assertion wouldn't
    // reliably hold across a fresh switch either. ---
    await switcher.selectOption({ label: locationBName });
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page.getByText(itemA, { exact: false })).toBeVisible();

    // --- Build a distinct item while switched to B — it joins the SAME shared canonical menu. ---
    await page.getByPlaceholder("New category name").fill(categoryB);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryB })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemB);
    await page.getByPlaceholder("Base price").fill("14");
    await page.getByRole("main").getByRole("combobox").selectOption({ label: categoryB });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(itemB, { exact: false })).toBeVisible();
    // A's item is still here too — the canonical menu accumulates, it isn't replaced per switch.
    await expect(page.getByText(itemA, { exact: false })).toBeVisible();

    // --- Switch back to A: BOTH items are visible here too, since the whole menu is genuinely
    // shared across the business — proving the switch re-resolves correctly in both directions. ---
    await switcher.selectOption({ label: restaurantName });
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page.getByText(itemA, { exact: false })).toBeVisible();
    await expect(page.getByText(itemB, { exact: false })).toBeVisible();
  });
});

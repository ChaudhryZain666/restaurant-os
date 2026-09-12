import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 21 — the end-to-end proof this phase was built to deliver: a real, already-migrated
 * single-location owner (Spice Route) manages their canonical menu through the real admin UI with
 * no independent-menu concept ever surfacing, then adds a second real location (through the real
 * Locations page) which automatically inherits the shared canonical menu with zero setup, then
 * sets a price override at that new location only — proving canonical edits, per-location
 * overrides, override removal, and correct customer-facing/checkout pricing all work through the
 * real UI end to end.
 *
 * Phase 75 — this spec used to leave the location it creates behind forever: no `afterAll`, no
 * mongoose import, no cleanup of the real `Restaurant` document `+ Add another location` creates.
 * Confirmed against the shared dev database: 20 orphaned "Spice Route Downtown <timestamp>"
 * locations had accumulated from repeated past runs, and — because `reserveLocationSlot`
 * (business.controller.ts) increments a real, persisted `Business.locationCount` counter that
 * nothing was ever decrementing back down — this had already driven Spice Route's location count
 * to exactly `NO_SUBSCRIPTION_DEFAULT_MAX_LOCATIONS` (20), one more run away from this very test
 * failing outright with "This business has reached its location limit." It also never followed
 * this repo's own documented convention (docs/development-setup.md: "a spec-created restaurant's
 * slug always starts with `e2e-`"), which is why nothing else here already caught it. Both are
 * fixed below: the created location's slug/name now uses the `e2e-` prefix, and `afterAll` deletes
 * the `Restaurant` it created and reconciles `Business.locationCount` back to the real, live count
 * of that business's remaining locations (not a blind decrement — Spice Route's stored counter was
 * already found to be 1 lower than its actual restaurant count, so recomputing from the real data
 * is the only way this doesn't just bake in a second, different drift).
 */
test.describe.serial("shared canonical menu + per-location overrides (Phase 21)", () => {
  let db: mongoose.Connection;
  let createdRestaurantId: string | undefined;
  let spiceRouteBusinessId: string | undefined;

  test.beforeAll(async () => {
    db = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
  });

  test.afterAll(async () => {
    if (createdRestaurantId) {
      await db.collection("restaurants").deleteOne({ _id: new mongoose.Types.ObjectId(createdRestaurantId) });
    }
    if (spiceRouteBusinessId) {
      const businessObjectId = new mongoose.Types.ObjectId(spiceRouteBusinessId);
      const realCount = await db.collection("restaurants").countDocuments({ businessId: businessObjectId });
      await db.collection("businesses").updateOne({ _id: businessObjectId }, { $set: { locationCount: realCount } });
    }
    await db.close();
  });

  test("owner manages the canonical menu, adds a second location that inherits it automatically, overrides a price at the new location only, and the storefront/checkout reflect it correctly per location", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // --- Sign in as Spice Route's owner — already a real, migrated, single-location business. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("amara@spice-route.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });

    // --- The Menu page shows the canonical menu directly — no independent-per-location concept
    // ever surfaces for a single-location owner, even though it's canonical underneath. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
    await expect(page.getByText("Butter Chicken", { exact: false })).toBeVisible({ timeout: 10_000 });

    // --- Add a second location through the real Locations page. ---
    await page.getByRole("link", { name: "Locations" }).click();
    await page.getByRole("button", { name: "+ Add another location" }).click();
    const stamp = Date.now();
    // Phase 75 — `e2e-` prefix per docs/development-setup.md's documented convention (every other
    // spec in this suite already follows it; this was the one exception, and its slug was the reason
    // nothing swept it up automatically).
    const secondLocationName = `e2e-Spice Route Downtown ${stamp}`;
    const secondLocationSlug = `e2e-spice-route-downtown-${stamp}`;
    const createLocationResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/locations") && res.request().method() === "POST"
    );
    await page.getByLabel("Name", { exact: true }).fill(secondLocationName);
    await page.getByLabel("Slug").fill(secondLocationSlug);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`${secondLocationName} was created`, { exact: false })).toBeVisible({ timeout: 10_000 });
    const createLocationBody = await (await createLocationResponsePromise).json();
    createdRestaurantId = createLocationBody.data.restaurant.id;
    spiceRouteBusinessId = createLocationBody.data.restaurant.businessId;

    // --- Switch to the new location. Its menu already shows the shared canonical items — no
    // clone step was needed, proving the "inherits automatically" promise. ---
    const switcher = page.getByRole("button", { name: /Switch location/ });
    await switcher.click();
    await page.getByRole("option", { name: new RegExp(secondLocationName) }).click();

    // --- Publish it — readiness already passes with zero setup, since it inherits the canonical
    // menu automatically (this is also a live proof of the Phase 21 computeReadiness fix: a
    // non-anchor location with no restaurantId-scoped documents of its own must still resolve as
    // ready, not incorrectly blocked). ---
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish restaurant" }).click();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page.getByText("Butter Chicken", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("$13.50", { exact: false })).toBeVisible();

    // --- Override Butter Chicken's price at this new location only. ---
    const itemRow = page.locator("li", { hasText: "Butter Chicken" }).first();
    await itemRow.getByRole("button", { name: "Edit" }).click();
    const overridePriceInput = page.getByPlaceholder("$13.50");
    await overridePriceInput.fill("16");
    await page.getByRole("button", { name: "Save price here" }).click();
    await expect(page.getByText("overridden here", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    // Phase 75 — the item editor is a drawer with a full-viewport backdrop (ItemEditorDrawer.tsx)
    // that stays open after "Save price here" (by design, so the "Overridden here" badge is visible
    // in place) and intercepts clicks anywhere else on the page until explicitly closed. This spec
    // never closed it before trying to use the location switcher again — a real, pre-existing bug in
    // this spec (unrelated to the pollution/naming fix above), only surfaced now that this spec was
    // actually run to completion.
    await page.getByRole("button", { name: "Back to menu" }).click();

    // --- The canonical value (and the original location) must be unaffected. Filtered by
    // hasNotText (matching platform-admin's own established pattern for this exact ambiguity) since
    // the option's accessible name is "Spice Route" plus its status label, and this business has
    // accumulated several "Spice Route Downtown ..." locations from repeated past test runs. ---
    await switcher.click();
    await page.getByRole("option").filter({ hasText: "Spice Route" }).filter({ hasNotText: "Downtown" }).click();
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page.locator("li", { hasText: "Butter Chicken" }).first().getByText("$13.50", { exact: false })).toBeVisible();

    // --- Customer storefronts: original location still $13.50, new location shows $16.00. ---
    const customerContext = await page.context().browser()!.newContext();
    const customerPage = await customerContext.newPage();
    await customerPage.goto("http://localhost:5173/r/spice-route");
    await expect(customerPage.getByText("Butter Chicken", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(customerPage.getByText("13.50", { exact: false })).toBeVisible();

    await customerPage.goto(`http://localhost:5173/r/${secondLocationSlug}`);
    await expect(customerPage.getByText("Butter Chicken", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(customerPage.getByText("16.00", { exact: false })).toBeVisible();
    await customerContext.close();

    // --- Reset the override: back to the canonical price at the new location. ---
    await switcher.click();
    await page.getByRole("option", { name: new RegExp(secondLocationName) }).click();
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    const itemRowAfterReset = page.locator("li", { hasText: "Butter Chicken" }).first();
    await itemRowAfterReset.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Reset to canonical" }).click();
    await expect(page.getByText("overridden here", { exact: false })).toHaveCount(0);
    await expect(itemRowAfterReset.getByText("$13.50", { exact: false })).toBeVisible({ timeout: 10_000 });
  });
});

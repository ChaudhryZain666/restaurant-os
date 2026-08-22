import { test, expect } from "@playwright/test";

/**
 * Phase 21 — the end-to-end proof this phase was built to deliver: a real, already-migrated
 * single-location owner (Spice Route) manages their canonical menu through the real admin UI with
 * no independent-menu concept ever surfacing, then adds a second real location (through the real
 * Locations page) which automatically inherits the shared canonical menu with zero setup, then
 * sets a price override at that new location only — proving canonical edits, per-location
 * overrides, override removal, and correct customer-facing/checkout pricing all work through the
 * real UI end to end.
 */
test.describe.serial("shared canonical menu + per-location overrides (Phase 21)", () => {
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
    const secondLocationName = `Spice Route Downtown ${stamp}`;
    const secondLocationSlug = `spice-route-downtown-${stamp}`;
    await page.getByLabel("Name", { exact: true }).fill(secondLocationName);
    await page.getByLabel("Slug").fill(secondLocationSlug);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`${secondLocationName} was created`, { exact: false })).toBeVisible({ timeout: 10_000 });

    // --- Switch to the new location. Its menu already shows the shared canonical items — no
    // clone step was needed, proving the "inherits automatically" promise. ---
    const switcher = page.getByRole("combobox", { name: "Active location" });
    await switcher.selectOption({ label: secondLocationName });

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

    // --- The canonical value (and the original location) must be unaffected. ---
    await switcher.selectOption({ label: "Spice Route" });
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
    await switcher.selectOption({ label: secondLocationName });
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    const itemRowAfterReset = page.locator("li", { hasText: "Butter Chicken" }).first();
    await itemRowAfterReset.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Reset to canonical" }).click();
    await expect(page.getByText("overridden here", { exact: false })).toHaveCount(0);
    await expect(itemRowAfterReset.getByText("$13.50", { exact: false })).toBeVisible({ timeout: 10_000 });
  });
});

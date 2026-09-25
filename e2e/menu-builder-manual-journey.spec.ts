import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 81 Stage 3 — Journey 5 (brief §37): manual menu -> create category -> create item -> add
 * modifier -> reorder -> preview. Exercises the redesigned menu-builder workspace end to end
 * without going through any importer — the "build manually" path the brief's own §25 insists must
 * stay excellent.
 */
test.describe.serial("menu builder — manual journey", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("create category -> create item -> add modifier -> reorder -> preview", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-manual-menu-${stamp}`;
    const restaurantName = `E2E Manual Menu ${stamp}`;
    const ownerEmail = `e2e-manual-menu-owner-${stamp}@test.local`;
    const categoryName = `Small Plates ${stamp}`;
    const firstItemName = `Charred Octopus ${stamp}`;
    const secondItemName = `Whipped Feta ${stamp}`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Manual Menu Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("ManualMenuOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/menu");
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    // --- Create category — the empty-state's own "Create category" affordance (brief §33). ---
    await page.getByRole("button", { name: "Create category" }).click();
    await page.locator("#new-category-input").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByText(categoryName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // --- Create item, via the category's own inline "+ Quick add" (brief §17's "use inline
    // interactions" requirement). ---
    await page.getByRole("button", { name: "+ Quick add" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(firstItemName);
    await page.getByPlaceholder("Base price").fill("14");
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Customize this item")).toBeVisible({ timeout: 10_000 });

    // --- Add modifier — the item editor's own ModifierGroupsEditor, live in the same panel
    // (brief §14's "don't force multiple pages for simple edits"). ---
    await page.getByRole("button", { name: "+ New option group" }).click();
    await page.getByPlaceholder("e.g. Size, Toppings").fill("Extra toppings");
    await page.getByRole("button", { name: "Create option group" }).click();
    await expect(page.getByLabel("Option group name")).toHaveValue("Extra toppings", { timeout: 10_000 });
    await expect(page.getByPlaceholder("Option name").first()).toHaveValue("Option 1");

    await page.getByRole("button", { name: "Back to menu" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByRole("main").getByText(firstItemName, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1 option").first()).toBeVisible();

    // --- A second item, so reordering actually has something to reorder. ---
    await page.getByRole("button", { name: "+ Quick add" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(secondItemName);
    await page.getByPlaceholder("Base price").fill("9");
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await page.getByRole("button", { name: "Back to menu" }).click();
    // Scoped to main (not a bare page-wide search): the item editor drawer stays mounted during
    // its own slide-out close transition (by design, so the animation has a "closed" frame to
    // play), so its still-present h2 title would otherwise also match this same text briefly.
    await expect(page.getByRole("main").getByText(secondItemName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Reorder — the grip handle's keyboard path (Arrow Up/Down), the same real reorder logic
    // drag-and-drop uses (see MenuManagementPage.tsx's GripHandle). Second item starts below the
    // first; Arrow Up on it should swap them. ---
    const secondItemGrip = page.getByRole("button", { name: new RegExp(`Reorder ${secondItemName}`) });
    await secondItemGrip.focus();
    await page.keyboard.press("ArrowUp");
    const itemRows = page.locator("li", { hasText: /Charred Octopus|Whipped Feta/ }).filter({ has: page.locator("p.font-medium") });
    await expect(itemRows.first()).toContainText(secondItemName, { timeout: 10_000 });

    // --- Preview — the real storefront iframe (brief §23). ---
    await page.getByRole("button", { name: "Live preview" }).click();
    await expect(page.getByRole("dialog", { name: "Storefront live preview" })).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();
  });
});

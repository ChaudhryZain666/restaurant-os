import { test, expect } from "@playwright/test";

/**
 * Phase 81 Stage 3 — Journey 6 (brief §37): mobile menu-builder workflow. Verifies the redesigned
 * 3-pane workspace genuinely collapses to a usable mobile layout (brief §30) rather than forcing
 * the desktop 3-column interface into a phone viewport — against the demo restaurant's real,
 * already-populated menu, not a fresh empty one, since the mobile experience of a menu with real
 * content is what actually matters here.
 */
test.describe("menu builder — mobile journey", () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12-class viewport

  test("left rail collapses to a drawer, item editing is full-screen, no horizontal overflow", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

    await page.goto("http://localhost:5174/menu");
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    // --- No horizontal page scroll at mobile width (brief §30/§32's own "don't force desktop
    // onto mobile" instruction). ---
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);

    // --- The persistent desktop left rail is hidden; its content lives behind a trigger instead
    // (the drawer/dialog it opens doesn't exist in the DOM at all until triggered). ---
    await expect(page.getByRole("dialog", { name: "Menu sections" })).toHaveCount(0);
    const sectionsTrigger = page.getByRole("button", { name: "Menu sections" });
    await expect(sectionsTrigger).toBeVisible();

    // --- Opening it reveals the real CategoryNavRail (search, filters, jump-list) as a drawer,
    // not a second copy of the page. ---
    await sectionsTrigger.click();
    const drawer = page.getByRole("dialog", { name: "Menu sections" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByPlaceholder("Search items")).toBeVisible();
    await expect(drawer.getByText("Wood-Fired Pizza", { exact: true })).toBeVisible();

    // --- Tapping a category jumps the canvas and closes the drawer (mobile nav pattern). ---
    await drawer.getByRole("button", { name: /Wood-Fired Pizza/ }).click();
    await expect(drawer).toBeHidden();

    // --- Editing an item is a full-screen overlay on mobile, not a 3rd persistent column
    // (brief §30's "mobile should prioritize menu items -> edit -> save"). ---
    await page.getByRole("button", { name: "Edit" }).first().click();
    const editorDialog = page.getByRole("dialog", { name: /item-editor-title|./ }).filter({ has: page.getByRole("button", { name: "Save item" }) });
    await expect(editorDialog).toBeVisible({ timeout: 10_000 });
    const editorBox = await editorDialog.boundingBox();
    expect(editorBox?.width).toBeGreaterThan(350); // fills the phone width, not a squeezed sidebar
    await page.getByRole("button", { name: "Back to menu" }).click();
    await expect(editorDialog).toBeHidden();
  });
});

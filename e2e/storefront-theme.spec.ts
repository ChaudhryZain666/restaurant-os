import { test, expect } from "@playwright/test";

/**
 * Phase 31 — the storefront theme engine end to end: an owner customizes a theme in Theme Studio
 * (apps/admin), the draft is visible ONLY via the authenticated Preview route (never the public
 * one), publishing makes it live on the real customer-facing storefront, and a completely
 * different restaurant is never affected by another restaurant's theme change.
 *
 * Runs as ONE serial test (not several independent ones) because it deliberately mutates
 * demo-restaurant's PUBLISHED theme mid-run — the one piece of shared state other e2e specs also
 * render against — and explicitly reverts it to Classic (with no overrides, every section on) in a
 * `finally` block so a failed assertion still leaves the shared fixture clean for the rest of the
 * regression suite, matching this repo's existing small-batch-with-restart discipline around
 * demo-restaurant.
 */
test.describe("storefront theme engine", () => {
  test.describe.configure({ timeout: 180_000 });

  test("draft is preview-only until published, then goes live on the public storefront without affecting a different restaurant", async ({
    page,
    browser,
  }) => {
    // A genuinely separate, cookie-less browsing context — the honest stand-in for an anonymous
    // customer, never sharing the owner's session with the admin/preview pages below.
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();

    try {
      // --- Owner customizes a theme (draft only) ---
      await page.goto("http://localhost:5174/login");
      await page.locator('input[type="email"]').fill("owner@demo-restaurant.local");
      await page.locator('input[type="password"]').fill("Owner123!");
      await page.getByRole("button", { name: "Sign in" }).click();
      // Wait for the login redirect to actually land before navigating away — jumping straight to
      // another route can race ahead of the async login/redirect (same pattern as the existing
      // menu-import.spec.ts).
      await page.waitForURL(/^http:\/\/localhost:5174\/(?!login)/, { timeout: 10_000 });
      await page.goto("http://localhost:5174/theme-studio");
      await expect(page.getByRole("heading", { name: "Theme Studio" })).toBeVisible();

      // Baseline: the public storefront starts on Classic (this repo's default), with the Classic
      // hero's own CTA copy — used below as a structural fingerprint of WHICH theme actually
      // rendered, not just a color check. "Popular picks" (the new optional Featured section) is
      // OFF by default — an un-configured restaurant must render exactly what it always has, never
      // gaining a new section it never asked for.
      await publicPage.goto("http://localhost:5173/r/demo-restaurant");
      await expect(publicPage.getByRole("button", { name: "Start your order" }).first()).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).not.toBeVisible();

      const editorialCard = page.getByRole("button", { name: "Select Editorial theme" });
      await editorialCard.click();
      await expect(editorialCard).toHaveAttribute("aria-pressed", "true");

      const primaryHexInput = page.locator('input[placeholder="Theme default"]').first();
      await primaryHexInput.fill("#0ea5e9");

      // Explicitly opt IN to the Featured section — proves the toggle actually works, not just
      // that the default is off.
      await page
        .getByText("Popular picks", { exact: true })
        .locator("xpath=ancestor::label")
        .locator('input[type="checkbox"]')
        .check();

      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Draft saved")).toBeVisible();
      await expect(page.getByText("Unpublished changes")).toBeVisible();

      // "View the menu" appears twice on a published Editorial page (the Hero's CTA button and the
      // closing Cta section's text link) — .first() (the Hero's) is enough to prove which theme
      // rendered; both instances existing at all is itself proof Editorial rendered, since no
      // other theme uses this copy.
      async function primaryColorRgb(target: typeof publicPage): Promise<string> {
        return target.evaluate(() => getComputedStyle(document.querySelector("main")!).getPropertyValue("--color-primary").trim());
      }

      // --- The public storefront is completely unaffected by an unpublished draft ---
      await publicPage.reload();
      await expect(publicPage.getByRole("button", { name: "Start your order" }).first()).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).not.toBeVisible();
      await expect(publicPage.getByText("View the menu").first()).not.toBeVisible();
      expect(await primaryColorRgb(publicPage)).not.toBe("#0ea5e9");

      // --- Preview (same authenticated browser context as the admin login) DOES show the draft —
      //     the real production renderer with the draft substituted in, not a second fake one. ---
      const previewPage = await page.context().newPage();
      await previewPage.goto("http://localhost:5173/r/demo-restaurant/preview");
      await expect(previewPage.getByText("Preview mode")).toBeVisible();
      await expect(previewPage.getByRole("button", { name: "View the menu" }).first()).toBeVisible();
      await expect(previewPage.getByLabel("Featured items")).toBeVisible();
      expect(await primaryColorRgb(previewPage)).toBe("#0ea5e9");
      await previewPage.close();

      // --- Publish: the real storefront now shows Editorial, with the custom color and the
      //     newly-enabled section, for a genuinely anonymous visitor. ---
      await page.getByRole("button", { name: "Publish" }).click();
      await expect(page.getByText("Theme published")).toBeVisible();
      await expect(page.getByText("Unpublished changes")).not.toBeVisible();

      await publicPage.reload();
      await expect(publicPage.getByRole("button", { name: "View the menu" }).first()).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).toBeVisible();
      expect(await primaryColorRgb(publicPage)).toBe("#0ea5e9");

      // --- Tenant isolation: a completely different restaurant is untouched by the above. ---
      await publicPage.goto("http://localhost:5173/r/spice-route");
      await expect(publicPage.getByRole("heading", { name: "Spice Route" })).toBeVisible();
      await expect(publicPage.getByText("View the menu")).not.toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).not.toBeVisible();
      await expect(publicPage.getByRole("button", { name: "Start your order" }).first()).toBeVisible();
      expect(await primaryColorRgb(publicPage)).not.toBe("#0ea5e9");
    } finally {
      // Revert demo-restaurant to a clean Classic baseline regardless of pass/fail above, so the
      // rest of the regression suite keeps seeing the DOM structure it was written against. Done
      // via direct API calls (a fresh login, not the already-used `page`) rather than re-driving
      // the Theme Studio UI: the preview page above shares its refresh-token cookie (same
      // hostname, different port) with the admin session, and the two independently refreshing
      // around the same time can rotate the admin session's token out from under it — a real but
      // narrow cross-origin-dev-session interaction, not worth fighting for a cleanup step that's
      // more robust as a direct API call anyway.
      const loginRes = await fetch("http://localhost:4000/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@demo-restaurant.local", password: "Owner123!" }),
      });
      const { data } = await loginRes.json();
      const authHeader = { Authorization: `Bearer ${data.accessToken}` };
      const restaurantId = data.user.restaurantId;
      await fetch(`http://localhost:4000/api/v1/restaurants/${restaurantId}/theme/draft`, {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ themeKey: "classic", colors: {}, sections: {} }),
      });
      await fetch(`http://localhost:4000/api/v1/restaurants/${restaurantId}/theme/publish`, {
        method: "POST",
        headers: authHeader,
      });
      await publicContext.close();
    }
  });
});

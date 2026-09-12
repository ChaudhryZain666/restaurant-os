import { test, expect } from "@playwright/test";

/**
 * Phase 31 — the storefront theme engine end to end: an owner customizes a theme in Theme Studio
 * (apps/admin), the draft is visible ONLY via the authenticated Preview route (never the public
 * one), publishing makes it live on the real customer-facing storefront, and a completely
 * different restaurant is never affected by another restaurant's theme change.
 *
 * Phase 33 — switches through Theme Studio's five current showcase directions (Cinematic/Luxury/
 * Contemporary/Urban/Minimal — see apps/admin's themeCatalog.ts), even though the Classic/Modern/
 * Editorial registry entries themselves are still kept and still render correctly for any
 * restaurant with one already persisted (see apps/web/src/theme/registry.tsx's own doc comment on
 * why they were deliberately NOT deleted).
 *
 * Phase 65 — demo-restaurant's real PUBLISHED theme is now Cinematic (the platform's flagship —
 * see seed-demo-data.ts), not Classic, since this is also what the marketing site's real live
 * iframe renders. The baseline/fingerprint below is updated accordingly: "Reserve the menu"
 * (Cinematic's own Hero CTA) is now the PUBLISHED-state fingerprint, and the draft below switches
 * to Contemporary ("Start an order" — a string no other theme in this test's path uses, so it
 * can't collide with Cinematic's own "Reserve the menu"/"View the menu" vocabulary) as the
 * DRAFT-state fingerprint instead. The Featured ("Popular picks") toggle now starts ON (Cinematic's
 * real published config enables it), so this test proves the toggle mechanism by switching it OFF
 * in the draft instead of on — an equally real proof the control works, just the other direction.
 *
 * Runs as ONE serial test (not several independent ones) because it deliberately mutates
 * demo-restaurant's PUBLISHED theme mid-run — the one piece of shared state other e2e specs also
 * render against — and explicitly reverts it to the real Cinematic flagship baseline (matching
 * seed-demo-data.ts exactly) in a `finally` block so a failed assertion still leaves the shared
 * fixture clean for the rest of the regression suite, matching this repo's existing
 * small-batch-with-restart discipline around demo-restaurant.
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

      // Baseline (Phase 65): the public storefront starts on Cinematic (this platform's real
      // flagship theme, matching seed-demo-data.ts), with Cinematic's own hero CTA copy — used
      // below as a structural fingerprint of WHICH theme actually rendered, not just a color check.
      // "Popular picks" (the optional Featured section) starts ON — the real published config this
      // phase deliberately set, so the fuller flagship storefront is what a real visitor sees.
      await publicPage.goto("http://localhost:5173/r/demo-restaurant");
      await expect(publicPage.getByRole("button", { name: "Reserve the menu" }).first()).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).toBeVisible();

      const contemporaryCard = page.getByRole("button", { name: "Select Contemporary theme" });
      await contemporaryCard.click();
      await expect(contemporaryCard).toHaveAttribute("aria-pressed", "true");

      const primaryHexInput = page.locator('input[placeholder="Theme default"]').first();
      await primaryHexInput.fill("#0ea5e9");

      // Explicitly opt OUT of the Featured section this time — the draft inherits the published
      // config's sections (themeKey alone changes; ThemeStudioPage.tsx never resets `sections` on
      // a theme switch), so it starts checked here too — unchecking it proves the toggle mechanism
      // in the other direction from this file's original "opt in" proof.
      await page
        .getByText("Popular picks", { exact: true })
        .locator("xpath=ancestor::label")
        .locator('input[type="checkbox"]')
        .uncheck();

      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Draft saved")).toBeVisible();
      await expect(page.getByText("Unpublished changes")).toBeVisible();

      // "Start an order" is Contemporary's own Hero CTA copy — distinct from Cinematic's own
      // "Reserve the menu"/"View the menu" vocabulary (Cinematic's closing Cta section is also
      // live on the published baseline above), so its presence alone is unambiguous proof
      // Contemporary actually rendered.
      async function primaryColorRgb(target: typeof publicPage): Promise<string> {
        return target.evaluate(() => getComputedStyle(document.querySelector("main")!).getPropertyValue("--color-primary").trim());
      }

      // --- The public storefront is completely unaffected by an unpublished draft ---
      await publicPage.reload();
      await expect(publicPage.getByRole("button", { name: "Reserve the menu" }).first()).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).toBeVisible();
      await expect(publicPage.getByRole("button", { name: "Start an order" })).not.toBeVisible();
      expect(await primaryColorRgb(publicPage)).not.toBe("#0ea5e9");

      // --- Preview (same authenticated browser context as the admin login) DOES show the draft —
      //     the real production renderer with the draft substituted in, not a second fake one. ---
      const previewPage = await page.context().newPage();
      await previewPage.goto("http://localhost:5173/r/demo-restaurant/preview");
      await expect(previewPage.getByText("Preview mode")).toBeVisible();
      await expect(previewPage.getByRole("button", { name: "Start an order" })).toBeVisible();
      await expect(previewPage.getByLabel("Featured items")).not.toBeVisible();
      expect(await primaryColorRgb(previewPage)).toBe("#0ea5e9");
      await previewPage.close();

      // --- Publish: the real storefront now shows Contemporary, with the custom color and the
      //     newly-disabled section, for a genuinely anonymous visitor. ---
      await page.getByRole("button", { name: "Publish" }).click();
      await expect(page.getByText("Theme published")).toBeVisible();
      await expect(page.getByText("Unpublished changes")).not.toBeVisible();

      await publicPage.reload();
      await expect(publicPage.getByRole("button", { name: "Start an order" })).toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).not.toBeVisible();
      expect(await primaryColorRgb(publicPage)).toBe("#0ea5e9");

      // --- Tenant isolation: a completely different restaurant is untouched by the above. ---
      await publicPage.goto("http://localhost:5173/r/spice-route");
      await expect(publicPage.getByRole("heading", { name: "Spice Route" })).toBeVisible();
      await expect(publicPage.getByRole("button", { name: "Start an order" })).not.toBeVisible();
      await expect(publicPage.getByLabel("Featured items")).not.toBeVisible();
      await expect(publicPage.getByRole("button", { name: "Start your order" }).first()).toBeVisible();
      expect(await primaryColorRgb(publicPage)).not.toBe("#0ea5e9");
    } finally {
      // Revert demo-restaurant to the real Cinematic flagship baseline (Phase 65 — matching
      // seed-demo-data.ts exactly, every optional section on) regardless of pass/fail above, so
      // the rest of the regression suite — and the marketing site's own live iframe — keeps seeing
      // the same flagship storefront this phase deliberately set, not a stale Classic fallback.
      // Done via direct API calls (a fresh login, not the already-used `page`) rather than
      // re-driving the Theme Studio UI: the preview page above shares its refresh-token cookie
      // (same hostname, different port) with the admin session, and the two independently
      // refreshing around the same time can rotate the admin session's token out from under it —
      // a real but narrow cross-origin-dev-session interaction, not worth fighting for a cleanup
      // step that's more robust as a direct API call anyway.
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
        body: JSON.stringify({
          themeKey: "cinematic",
          colors: {},
          sections: { featured: true, about: true, gallery: true, cta: true },
        }),
      });
      await fetch(`http://localhost:4000/api/v1/restaurants/${restaurantId}/theme/publish`, {
        method: "POST",
        headers: authHeader,
      });
      await publicContext.close();
    }
  });
});

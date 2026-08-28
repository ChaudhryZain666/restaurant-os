import { test, expect } from "@playwright/test";

/**
 * Phase 32 — the public storefront-playground demo (/r/demo-restaurant/experience). Proves this is
 * genuinely the real product, not a mockup:
 *  - theme switching and color overrides change the SAME renderer real restaurants use, live,
 *    with zero backend mutation (the client-only ThemeOverrideContext never calls the theme
 *    draft/publish endpoints — unlike storefront-theme.spec.ts's Theme Studio flow).
 *  - a visitor can add a real item with a real modifier and complete a real (mock-payment, zero
 *    real-money) order through the real order-creation pipeline via an ephemeral demo session.
 *  - that demo order never appears on the real owner's Orders Management page — the isDemo
 *    exclusion actually works end to end, not just in a unit test.
 *  - one visitor's customization never leaks to a different visitor (separate browser contexts,
 *    same discipline as storefront-theme.spec.ts's publicContext).
 *
 * No `finally`-block cleanup of shared demo-restaurant state is needed here (unlike
 * storefront-theme.spec.ts): the theme override is entirely client-side sessionStorage and never
 * touches the restaurant's real settings.theme, and the order this test places is real but
 * correctly excluded from every staff-facing view by the isDemo flag — same "leave real orders
 * behind" precedent full-order-flow.spec.ts already establishes for this shared fixture.
 */
test.describe("storefront demo playground", () => {
  test.describe.configure({ timeout: 180_000 });

  test("theme customization is live and isolated, and a demo checkout stays invisible to real staff", async ({ page, browser }) => {
    await page.goto("http://localhost:5173/r/demo-restaurant/experience");
    // Generous timeout on this first assertion only — the lazy-loaded experience chunk plus the
    // restaurant/menu fetches it triggers can take a few seconds on a cold dev-server compile.
    await expect(page.getByRole("heading", { name: /This is Demo Restaurant/ })).toBeVisible({ timeout: 15_000 });

    // --- Add a real item with a real (required) modifier to the real cart, from inside the
    //     device frame, WHILE still on Cinematic (the playground's default seed theme — see
    //     PlaygroundPanel.tsx) — its button labels ("Add to order"/"Confirm") are the ones asserted
    //     below. Done before switching themes further down: each theme's menu interaction uses
    //     genuinely different labels (see LuxuryMenuSection's plain "Add"/hairline-bordered
    //     "Confirm"), which is itself proof the themes are structurally different, not just
    //     re-colored — but that means this add-to-cart step must happen on a known theme, not after
    //     switching away from it. ---
    const itemRow = page.locator("li", { hasText: "Margherita Pizza" }).first();
    await itemRow.scrollIntoViewIfNeeded();
    await itemRow.getByRole("button", { name: "Add to order" }).click({ timeout: 15_000 });
    await expect(itemRow.getByText("Size", { exact: false })).toBeVisible();
    await itemRow.getByText("Small", { exact: false }).click();
    await itemRow.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: /Try a real checkout \(1\)/ })).toBeVisible();

    // --- Theme switching changes the real renderer's structural fingerprint, live — the cart
    //     state above is untouched by this (CartContext is fully decoupled from theme). ---
    const minimalCard = page.getByRole("button", { name: "Select Minimal theme" });
    await minimalCard.click();
    await expect(minimalCard).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "View the menu" }).first()).toBeVisible();

    // --- Color override changes a CSS custom property live ---
    const primaryHexInput = page.locator('input[placeholder="Default"]').first();
    await primaryHexInput.fill("#0ea5e9");
    await expect
      .poll(async () =>
        page.evaluate(() => getComputedStyle(document.querySelector("main")!).getPropertyValue("--color-primary").trim())
      )
      .toBe("#0ea5e9");

    // --- Section toggle shows a section live ---
    await page.getByText("Popular picks", { exact: true }).locator("xpath=ancestor::label").locator('input[type="checkbox"]').check();
    await expect(page.getByLabel("Featured items")).toBeVisible();

    // --- Device-width toggle actually changes the frame's rendered width ---
    const frame = page.getByTestId("device-frame");
    const desktopBox = await frame.boundingBox();
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    await expect
      .poll(async () => (await frame.boundingBox())?.width)
      .toBeLessThan(desktopBox!.width);

    // --- Complete a real, safe demo checkout: clicking through mints an ephemeral demo session
    //     (POST /auth/demo-session) and lands on the real, unmodified cart page. ---
    await page.getByRole("button", { name: /Try a real checkout/ }).click();
    await expect(page).toHaveURL(/\/r\/demo-restaurant\/cart$/);
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(page.getByText("Order placed successfully!")).toBeVisible();
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    const orderNumber = heading.match(/ORD-\d+/)![0];

    // --- That demo order is invisible on the real owner's Orders Management page ---
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
      await ownerPage.getByLabel("Password").fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Orders" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
      await expect(ownerPage.getByRole("group", { name: `Order ${orderNumber}` })).not.toBeVisible();
    } finally {
      await ownerContext.close();
    }

    // --- Cross-visitor isolation: a completely separate browser context never inherits the
    //     Minimal/blue customization made above — sessionStorage is per-tab by construction. ---
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await freshPage.goto("http://localhost:5173/r/demo-restaurant/experience");
      // Cinematic is the playground's default seed (see PlaygroundPanel.tsx) whenever the
      // restaurant's real published theme isn't one of the five current showcase directions — the
      // real demo-restaurant fixture stays on the legacy "classic" key for other e2e specs'
      // structural-fingerprint safety (see registry.tsx's doc comment), so a fresh visitor here
      // always lands on Cinematic, never on whatever the previous visitor picked.
      await expect(freshPage.getByRole("button", { name: "Select Cinematic theme" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      await freshContext.close();
    }
  });
});

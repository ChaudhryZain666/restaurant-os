import { test, expect } from "@playwright/test";

/**
 * Phase 77 — the three public legal pages (Terms, Privacy, Refund & Cancellation) added to close
 * one of this project's two launch blockers ("no Terms of Service, Privacy Policy, or refund
 * policy exists anywhere in the product"). Runs against the marketing site (apps/marketing,
 * port 5175 by default — see playwright.config.ts's baseURL and this repo's other marketing
 * specs), not the customer storefront or admin app, since that's where these pages actually live.
 */
const MARKETING_BASE = "http://localhost:5175";

test.describe("Legal pages (Phase 77)", () => {
  test("Terms, Privacy, and Refund & Cancellation pages all load with real content, correct metadata, and working cross-links", async ({ page }) => {
    await page.goto(`${MARKETING_BASE}/terms`);
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Terms of Service/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${MARKETING_BASE}/terms`);
    await expect(page.getByText(/Last updated/)).toBeVisible();

    await page.getByRole("link", { name: "Privacy Policy" }).first().click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/privacy`);
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Privacy Policy/);

    await page.getByRole("link", { name: "Refund & Cancellation Policy" }).first().click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/refund-policy`);
    await expect(page.getByRole("heading", { name: "Refund & Cancellation Policy", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Refund & Cancellation Policy/);

    // Back to Terms via the cross-link row, proving all three link to each other, not just forward.
    await page.getByRole("link", { name: "Terms of Service" }).first().click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/terms`);
  });

  test("footer links to all three legal pages from the homepage", async ({ page }) => {
    await page.goto(MARKETING_BASE);
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms", exact: true }).click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/terms`);

    await page.goto(MARKETING_BASE);
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/privacy`);

    await page.goto(MARKETING_BASE);
    await page.getByRole("contentinfo").getByRole("link", { name: "Refunds", exact: true }).click();
    await expect(page).toHaveURL(`${MARKETING_BASE}/refund-policy`);
  });

  test("mobile viewport (390px) shows the legal page with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${MARKETING_BASE}/privacy`);
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });

  test("does not apply the private-page noindex meta tag", async ({ page }) => {
    await page.goto(`${MARKETING_BASE}/terms`);
    const robotsMeta = await page.locator('meta[name="robots"]').count();
    expect(robotsMeta).toBe(0);
  });

  // Phase 79 (second pass) — this app previously had no catch-all route at all: an unmatched URL
  // rendered a blank page with no noindex signal, exactly the "404 accidentally becomes
  // indexable" failure mode this audit pass flagged.
  test("an unmatched URL shows a real 404 page and is noindexed", async ({ page }) => {
    await page.goto(`${MARKETING_BASE}/this-page-does-not-exist-${Date.now()}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that page", level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
});

import { test, expect } from "@playwright/test";

/**
 * Phase 89 (legal option C) — what PRODUCTION shows on the legal pages while the five founder-
 * supplied legal values are not configured. The dev server (legal-pages.spec.ts) always renders the
 * full draft with its markers, so this needs a production build served by `vite preview`:
 *
 *   VITE_SITE_URL=https://garnishtable.com VITE_STOREFRONT_URL=https://order.garnishtable.com \
 *     VITE_ADMIN_URL=https://app.garnishtable.com npm run build -w apps/marketing
 *   npx vite preview --port 4175 --strictPort   (in apps/marketing)
 *   LEGAL_PREVIEW_BASE=http://localhost:4175 npx playwright test e2e/legal-pending-notice.spec.ts
 *
 * Skipped when LEGAL_PREVIEW_BASE is unset, so the normal dev-server E2E run is unaffected.
 */
const BASE = process.env.LEGAL_PREVIEW_BASE;

test.describe("Legal pages while the legal values are not configured (production build)", () => {
  test.skip(!BASE, "set LEGAL_PREVIEW_BASE to a `vite preview` of an unconfigured production build");

  for (const [path, title] of [
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
    ["/refund-policy", "Refund & Cancellation Policy"],
  ] as const) {
    test(`${path} shows its title and the 'being finalized' notice, noindexed, with no placeholders or draft text`, async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
      await expect(page.getByText("Legal documents are being finalized.")).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/\[[A-Z_/ ]+\]/);
      expect(body).not.toMatch(/Last updated/);
      // None of the draft document itself is presented as published.
      expect(body).not.toMatch(/These Terms of Service \("Terms"\) govern|1\. Acceptance of these Terms/);
    });
  }
});

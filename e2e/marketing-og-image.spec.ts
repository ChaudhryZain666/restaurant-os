import { test, expect } from "@playwright/test";

const MARKETING_BASE = "http://localhost:5175";

/**
 * Phase 82 Workstream I — og:image previously fell back to favicon.svg, which most real
 * social-preview crawlers (Facebook/Twitter/LinkedIn/Slack) don't reliably render for og:image at
 * all — shared marketing links were likely showing no preview image whatsoever. Now points at a
 * real, dedicated 1200x630 branded PNG (public/og-image.png).
 */
test.describe("marketing site OG image (Phase 82)", () => {
  test("homepage's og:image points at the real branded PNG asset, which is genuinely reachable", async ({ page }) => {
    await page.goto(MARKETING_BASE);
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute("content", `${MARKETING_BASE}/og-image.png`);

    const res = await page.request.get(`${MARKETING_BASE}/og-image.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("a second, non-homepage marketing page uses the same real og:image, not the old SVG favicon", async ({ page }) => {
    await page.goto(`${MARKETING_BASE}/pricing`);
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute("content", `${MARKETING_BASE}/og-image.png`);
    await expect(ogImage).not.toHaveAttribute("content", /favicon\.svg/);
  });
});

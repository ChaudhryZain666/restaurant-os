import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 88 — production QA found the marketing footer's "View live demo restaurant" pointing at the
 * storefront ROOT, which has no restaurant ("This link doesn't specify a restaurant."). It must open
 * the demo restaurant itself. Defaults to the local dev servers; set E2E_MARKETING_URL /
 * E2E_STOREFRONT_URL to run the same check against a preview build or a deployed environment.
 */
const MARKETING_BASE = process.env.E2E_MARKETING_URL ?? "http://localhost:5175";
const STOREFRONT_BASE = process.env.E2E_STOREFRONT_URL ?? "http://localhost:5173";
const DEMO_URL = `${STOREFRONT_BASE}/r/demo-restaurant`;

async function followDemoCta(page: Page) {
  await page.goto(MARKETING_BASE);
  const cta = page.getByRole("contentinfo").getByRole("link", { name: "View live demo restaurant" });
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", DEMO_URL);

  const navigations: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await cta.click();
  await page.waitForURL(`${DEMO_URL}**`);
  await page.waitForLoadState("networkidle");

  const finalUrl = new URL(page.url());
  expect(`${finalUrl.origin}${finalUrl.pathname}`).toBe(DEMO_URL);
  // No redirect loop: the click is one navigation (a client-side route settle may add one more).
  expect(navigations.length).toBeLessThanOrEqual(2);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/doesn.t specify a restaurant/i)).toHaveCount(0);
}

test.describe("Marketing → live demo restaurant CTA (Phase 88)", () => {
  test("desktop: the footer CTA opens the demo restaurant storefront", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await followDemoCta(page);
  });

  test("mobile (390px): the footer CTA opens the demo restaurant storefront", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await followDemoCta(page);
  });
});

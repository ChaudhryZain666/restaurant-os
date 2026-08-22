import { test, expect } from "@playwright/test";

/**
 * Phase 12: JSON-LD Restaurant+Menu structured data, Twitter Card metadata, and a generalized
 * noindex hook applied to every private page (previously only the /t/ QR route had one).
 */
test("storefront emits real Restaurant+Menu JSON-LD and Twitter Card metadata", async ({ page }) => {
  await page.goto("http://localhost:5173/r/demo-restaurant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

  const ldJson = await page.locator('script[type="application/ld+json"]').textContent();
  expect(ldJson).toBeTruthy();
  const data = JSON.parse(ldJson!);
  expect(data["@type"]).toBe("Restaurant");
  expect(data.name).toBeTruthy();
  expect(data.url).toContain("/r/demo-restaurant");
  expect(data.hasMenu["@type"]).toBe("Menu");
  expect(data.hasMenu.hasMenuSection.length).toBeGreaterThan(0);
  const firstItem = data.hasMenu.hasMenuSection[0].hasMenuItem[0];
  expect(firstItem["@type"]).toBe("MenuItem");
  expect(firstItem.offers.price).toBeGreaterThan(0);

  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", /summary/);
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", data.name);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/r\/demo-restaurant$/);
});

test("private pages carry a real noindex meta tag, not just a robots.txt entry", async ({ page }) => {
  await page.goto("http://localhost:5173/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

  await page.goto("http://localhost:5173/register");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("the storefront itself is NOT noindexed", async ({ page }) => {
  await page.goto("http://localhost:5173/r/demo-restaurant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

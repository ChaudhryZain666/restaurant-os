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

test("Phase 79 SEO fix — the seeded demo-restaurant storefront IS noindexed", async ({ page }) => {
  await page.goto("http://localhost:5173/r/demo-restaurant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("a real (non-demo) restaurant storefront is NOT noindexed", async ({ page }) => {
  await page.goto("http://localhost:5173/r/spice-route");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

// Phase 79 (second pass) — this app previously had no catch-all route at all: an unmatched URL
// rendered a blank page, no noindex signal, exactly the "404 accidentally becomes indexable"
// failure mode this audit pass flagged.
test("an unmatched URL shows a real not-found page and is noindexed", async ({ page }) => {
  await page.goto(`http://localhost:5173/this-page-does-not-exist-${Date.now()}`);
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

// A bad/mistyped restaurant slug previously showed the same real "we can't find that restaurant"
// message with no noindex tag — a thin, identical-looking error page indexable by default at a
// unique URL per bad slug.
test("a bad restaurant slug shows the not-found state and is noindexed", async ({ page }) => {
  await page.goto(`http://localhost:5173/r/this-slug-does-not-exist-${Date.now()}`);
  await expect(page.getByText("We can't find that restaurant")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

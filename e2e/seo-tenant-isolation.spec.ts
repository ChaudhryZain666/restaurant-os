import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 79 — SEO tenant-isolation proofs, mapped to the SEO audit's tenant-isolation requirements.
 * Reuses the seeded spice-route/bella-vista fixtures (also used by e2e/multi-tenant.spec.ts and
 * others) rather than creating fresh restaurants through the UI — these are the two independent,
 * fully-seeded real restaurants this repo already relies on for cross-tenant proofs.
 */

test("two real restaurants each get their own title, canonical URL, and JSON-LD identity", async ({ page }) => {
  await page.goto("http://localhost:5173/r/spice-route");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(/Spice Route/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/r\/spice-route$/);
  const spiceLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(spiceLd.name).toContain("Spice Route");
  expect(spiceLd.url).toContain("/r/spice-route");

  await page.goto("http://localhost:5173/r/bella-vista");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(/Bella Vista/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/r\/bella-vista$/);
  const bellaLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(bellaLd.name).toContain("Bella Vista");
  expect(bellaLd.url).toContain("/r/bella-vista");
  expect(bellaLd.name).not.toContain("Spice Route");
});

test("a query parameter cannot override the canonical host or path", async ({ page }) => {
  await page.goto("http://localhost:5173/r/spice-route?utm_source=newsletter&ref=evil.example.com");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:5173/r/spice-route");
});

/**
 * Both tests below read/write bella-vista's canonical-URL state (one via its DomainMapping, one via
 * its rendered canonical tag) — grouped into one describe.serial block (this repo's
 * playwright.config.ts sets `fullyParallel: true`, so ungrouped tests in the same file can otherwise
 * land in different workers and race each other over that shared restaurant's state; confirmed by a
 * real observed collision between these two specific tests before this grouping was added).
 */
test.describe.serial("bella-vista canonical-state proofs (Phase 79)", () => {
  /**
   * Proves the fix for a real tenant-isolation bug found during the SEO audit: MenuPage.tsx's
   * menu-fetch effect had no `cancelled` guard, so a restaurant A menu response that resolved AFTER
   * the page had already navigated to restaurant B could still call `setMenu`, painting A's menu
   * content (and JSON-LD `hasMenu`) under B's page.
   *
   * This app uses <BrowserRouter> (apps/web/src/main.tsx), which listens for `popstate` but not raw
   * `pushState` — dispatching a manual `popstate` after `history.pushState` is the standard technique
   * to force a same-page-load client-side route transition with no real link between two tenants (none
   * exists by design; a customer only ever lands on one restaurant's URL).
   *
   * Sequencing is deterministic, not sleep-driven: restaurant A's own /menu response is held via
   * page.route() until restaurant B's real menu has already rendered, and only released after that —
   * proving A's late arrival cannot corrupt B's already-rendered content.
   */
  test("a restaurant A menu response that resolves after navigating away cannot contaminate restaurant B's JSON-LD", async ({ page }) => {
  let menuRequestCount = 0;
  let releaseFirstMenuResponse: () => void = () => {};
  const firstMenuResponseReleased = new Promise<void>((resolve) => {
    releaseFirstMenuResponse = resolve;
  });

  await page.route("**/api/v1/restaurants/*/menu", async (route) => {
    menuRequestCount += 1;
    if (menuRequestCount === 1) {
      // This is restaurant A's (spice-route) menu request — hold it until we explicitly release it,
      // well after restaurant B has already rendered. `route.continue()` still forwards to the real
      // backend once released, so this exercises the real menu payload, not a fabricated one.
      await firstMenuResponseReleased;
    }
    await route.continue();
  });

  // Restaurant identity (title/canonical, set by useStorefrontSeo's first effect) resolves
  // independently of the held /menu request — the page itself stays on its loading skeleton the
  // whole time (menu never arrives), so waiting on the title (not the heading, which only renders
  // once the menu has loaded) is what actually confirms we're on spice-route before switching away.
  await page.goto("http://localhost:5173/r/spice-route");
  await expect(page).toHaveTitle(/Spice Route/, { timeout: 15_000 });

  // Client-side transition to restaurant B, exactly as a BrowserRouter-driven navigation would
  // update the URL — no full page reload, so React state (menu, restaurant) carries over exactly
  // as it would for any other in-app navigation.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/r/bella-vista");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page).toHaveTitle(/Bella Vista/, { timeout: 15_000 });
  // Restaurant B's own (non-held, second) menu request has resolved by now — its JSON-LD carries a
  // real hasMenu block built from bella-vista's actual seeded items.
  await expect
    .poll(
      async () => {
        const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
        return ld.hasMenu?.hasMenuSection?.length ?? 0;
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0);

  const beforeRelease = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(beforeRelease.name).toContain("Bella Vista");
  const bellaItemNames = beforeRelease.hasMenu.hasMenuSection.flatMap((s: { hasMenuItem: { name: string }[] }) => s.hasMenuItem.map((i) => i.name));
  expect(bellaItemNames).toContain("Spaghetti Carbonara");
  expect(bellaItemNames).not.toContain("Butter Chicken");

  // Now let spice-route's stale response land — the actual race. Give it a real round trip's worth
  // of time to be processed, then assert the page still shows only bella-vista's identity and menu.
  releaseFirstMenuResponse();
  await page.waitForTimeout(2_000);

  const afterRelease = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(afterRelease.name).toContain("Bella Vista");
  expect(afterRelease.url).toContain("/r/bella-vista");
  const afterItemNames = afterRelease.hasMenu.hasMenuSection.flatMap((s: { hasMenuItem: { name: string }[] }) => s.hasMenuItem.map((i) => i.name));
    expect(afterItemNames).toContain("Spaghetti Carbonara");
    expect(afterItemNames).not.toContain("Butter Chicken");
  });

  /**
   * Real-DNS navigation to an arbitrary custom hostname isn't achievable in this environment (no DNS
   * control over a test hostname — same documented limitation e2e/custom-domain-management.spec.ts
   * already accepts). What's achievable and meaningful: seed an active DomainMapping directly via
   * Mongo (same idiom that spec already uses), then visit the *platform* /r/:slug URL and confirm the
   * rendered canonical tag actually points at the custom domain — proving the activeCustomDomain-
   * preferred-canonical path renders correctly end-to-end, not just returns correctly from the API
   * (already covered directly by apps/api/src/controllers/restaurant.controller.test.ts).
   */
  let db: mongoose.Connection;
  const hostname = `seo-canonical-${Date.now()}.e2e-test.example`;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.collection("domainmappings").deleteOne({ hostname });
    await db.close();
  });

  test("a platform /r/:slug visit for a restaurant with an active custom domain canonicalizes to that domain", async ({ page }) => {
    const bellaVista = await db.collection("restaurants").findOne({ slug: "bella-vista" });
    expect(bellaVista).not.toBeNull();

    await db.collection("domainmappings").insertOne({
      hostname,
      businessId: bellaVista!.businessId,
      locationId: bellaVista!._id,
      status: "active",
      verificationToken: "e2e-test-token",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await page.goto("http://localhost:5173/r/bella-vista");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://${hostname}`);
  });
});

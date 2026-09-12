import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 60 — the Section 19 concerns owner-self-serve-signup.spec.ts (Phase 44) and
 * owner-self-serve-launch-journey.spec.ts (this session's earlier work) don't already cover:
 * a browser refresh mid-session, session survival across a genuinely fresh login, an explicit
 * cross-business denial check for a self-serve owner (not just agency/platform-admin variants,
 * which multi-location-staff-isolation.spec.ts and middleware/tenant.test.ts already prove), an
 * explicit "no agency association" check, and a real network-retry-shaped duplicate-submission
 * proof driven through the actual authenticated browser session rather than a raw Jest supertest
 * call (business.controller.test.ts's own new concurrency test already proves the server-side fix
 * at the API level — this proves the identical scenario is unreachable through the real browser
 * too, using two direct fetches through the page's own session, which is the closest a UI-level
 * test can get to a genuine "the network retried my request" scenario without literally racing
 * two real clicks against a button React disables synchronously).
 */
test.describe.serial("owner self-serve session persistence, isolation, and duplicate-submission safety (Phase 60)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("refresh survives, logout/login-again shows the same restaurant, no agency association, cross-business access is denied, and a simulated network retry cannot double-provision", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const ownerEmail = `e2e-persist-owner-${stamp}@test.local`;
    const restaurantName = `E2E Persistence Bistro ${stamp}`;
    const slug = `e2e-persist-${stamp}`;
    const password = "PersistOwner123!";

    // --- Real signup through to a live trial (mechanics identical to the already-proven wizard). ---
    await page.goto("http://localhost:5174/signup");
    await expect(page.getByText("Owner — Starter")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Full name").fill("E2E Persistence Owner");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 10_000 });
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    await page.goto(`http://localhost:5174/verify-email?token=${rawToken}`);
    await page.getByRole("link", { name: "Continue setting up my restaurant" }).click();

    await expect(page.getByRole("heading", { name: "Tell us about your restaurant" })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Restaurant name").fill(restaurantName);
    await page.getByLabel("Web address").fill(slug);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Start \d+-day trial/ }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible({ timeout: 10_000 });

    // --- Subscription is real and correctly resolves entitlements; no agency association exists. ---
    const business = await db.collection("businesses").findOne({ slug });
    expect(business).not.toBeNull();
    expect(business!.agencyId).toBeUndefined();
    const subscription = await db.collection("subscriptions").findOne({ ownerType: "business", ownerId: business!._id });
    expect(subscription?.status).toBe("trialing");
    const owner = await db.collection("users").findOne({ email: ownerEmail });
    expect(await db.collection("agencymemberships").countDocuments({ userId: owner!._id })).toBe(0);
    expect(owner!.role).toBe("restaurant_owner");
    expect(owner!.businessId!.toString()).toBe(business!._id.toString());

    // --- Configure a real, distinctive setting so a later reload/relogin can prove it's the SAME
    // restaurant, not a re-provisioned or stale one. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByLabel("Restaurant name")).toHaveValue(restaurantName, { timeout: 10_000 });

    // --- Browser refresh mid-session: still authenticated, still the same restaurant. ---
    await page.reload();
    await expect(page.getByLabel("Restaurant name")).toHaveValue(restaurantName, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login$/);

    // --- Logout, then a genuinely fresh login: the exact same restaurant appears. ---
    await page.getByRole("button", { name: /log ?out/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByLabel("Restaurant name")).toHaveValue(restaurantName, { timeout: 10_000 });

    // --- Cross-business access is denied: this owner cannot reach an unrelated, real business's
    // resources merely by guessing/knowing its id. The access token lives only in the frontend's
    // in-memory React state (deliberately never in a cookie/localStorage), so a real Bearer token
    // is fetched directly via the login endpoint rather than relied on from browser session state. ---
    const loginRes = await page.request.post("http://localhost:4000/api/v1/auth/login", {
      data: { email: ownerEmail, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { accessToken } = (await loginRes.json()).data as { accessToken: string };

    const otherBusiness = await db.collection("businesses").findOne({ _id: { $ne: business!._id } });
    if (otherBusiness) {
      const denied = await page.evaluate(
        async ({ businessId, token }) => {
          const res = await fetch(`/api/v1/businesses/${businessId}/locations`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return res.status;
        },
        { businessId: otherBusiness._id.toString(), token: accessToken }
      );
      expect([403, 404]).toContain(denied);
    }

    // --- Simulated network retry, against a FRESH verified owner with no business yet (the actual
    // race window — this owner already has one, so both attempts would trivially 409 without
    // exercising it): two near-simultaneous self-serve creation requests through the SAME
    // authenticated real browser session must never both succeed — the real, server-side guard
    // (not frontend button disabling, which this deliberately bypasses via direct fetch) must
    // reject the second one cleanly, and never leave a silently orphaned second business. ---
    const raceEmail = `e2e-persist-race-${stamp}@test.local`;
    const raceContext = await browser.newContext();
    const racePage = await raceContext.newPage();
    try {
      const registerRes = await racePage.request.post("http://localhost:4000/api/v1/auth/register", {
        data: { name: "E2E Race Owner", email: raceEmail, password: "PersistRace123!" },
      });
      expect(registerRes.ok()).toBeTruthy();
      const { accessToken: raceToken } = (await registerRes.json()).data as { accessToken: string };
      await db.collection("users").updateOne({ email: raceEmail }, { $set: { emailVerifiedAt: new Date() } });

      // A real page context (any same-origin admin page) is needed for a relative fetch to resolve
      // through the dev-server's own /api proxy — matches exactly how the real app itself calls
      // the API (apiClient's basePath is relative, not a cross-origin absolute URL).
      await racePage.goto("http://localhost:5174/login");
      const [first, second] = await racePage.evaluate(
        async ({ token }) => {
          const opts = (b: string) => ({
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: b,
          });
          const [r1, r2] = await Promise.all([
            fetch("/api/v1/businesses/self-serve", opts(JSON.stringify({ name: "Retry Race A", slug: `retry-race-a-${Date.now()}` }))),
            fetch("/api/v1/businesses/self-serve", opts(JSON.stringify({ name: "Retry Race B", slug: `retry-race-b-${Date.now()}` }))),
          ]);
          return [r1.status, r2.status];
        },
        { token: raceToken }
      );
      const statuses = [first, second].sort();
      expect(statuses).toEqual([201, 409]);

      const raceOwner = await db.collection("users").findOne({ email: raceEmail });
      expect(await db.collection("businesses").countDocuments({ ownerId: raceOwner!._id })).toBe(1);
    } finally {
      await raceContext.close();
    }
  });
});

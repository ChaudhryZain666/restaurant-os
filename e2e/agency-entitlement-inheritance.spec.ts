import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 59 (entitlement/pricing audit), corrected by Phase 63 — proves, through the real browser UI
 * (not just the Jest service-level tests in agencyEntitlementInheritance.service.test.ts and
 * subscriptionResolution.service.ts's own tests), that a managed business's entitlement-gated pages
 * actually reflect its managing agency's real, live subscription — and, critically, that once that
 * agency subscription expires, the managed business does NOT silently regain the feature through the
 * generous no-subscription fallback. Phase 61/Phase 59 originally asserted the OPPOSITE (expiring
 * "unlocks" the feature again) — that was the exact commercial-safety bug Phase 63 found and fixed:
 * an agency that HAS had a real subscription is never treated the same as one that never subscribed.
 * Core operability (the restaurant/storefront itself) is still never broken — only the specific
 * paid-tier feature this plan excludes stays gated, exactly as it should.
 *
 * No restrictive AGENCY-type plan is selectable through the real signup/checkout UI (the only
 * active agency plan in the real catalog, agency_growth_v2, grants custom_domains), so this test
 * seeds a real Plan + Subscription directly against MongoDB — the same "seed what a real external
 * step can't exercise" convention already established throughout this suite (e.g.
 * restaurant-provisioning-golden-path.spec.ts's invite-token seeding) — then drives every actual
 * check through the real UI.
 */
test.describe.serial("agency-managed business entitlement inheritance, live in the UI (Phase 59)", () => {
  let db: mongoose.Connection;
  // Phase 61 audit fix — this spec seeds a real AGENCY-type Plan (isActive:true) directly via
  // MongoDB (no restrictive agency plan is selectable through the real UI). The original version
  // of this test never deleted it, leaking a real, isActive:true "Test Plan" into the shared dev
  // database's actual /public/plans catalog on every run — the exact class of pollution
  // e2e/agency-management.spec.ts's own Phase 40.1 fix and apps/api/src/scripts/
  // cleanupOrphanedTestPlans.ts already exist to prevent elsewhere. Tracked and deleted here now,
  // matching that established convention.
  const createdPlanIds: mongoose.mongo.BSON.ObjectId[] = [];
  const createdSubscriptionIds: mongoose.mongo.BSON.ObjectId[] = [];

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    if (createdSubscriptionIds.length) await db.collection("subscriptions").deleteMany({ _id: { $in: createdSubscriptionIds } });
    if (createdPlanIds.length) await db.collection("plans").deleteMany({ _id: { $in: createdPlanIds } });
    await db.close();
  });

  test("a restrictive agency plan locks Domains in-workspace; the agency's subscription expiring keeps it locked — it must never silently unlock via the no-subscription fallback (Phase 63)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const agencySlug = `entitlement-agency-${stamp}`;

    // --- Register a fresh agency and provision one client business (Commercial/Owner-access steps
    // skipped — this test's concern is entitlements, not provisioning or commercial terms). ---
    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Entitlement Agency Owner");
    await page.getByLabel("Email").fill(`entitlement-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("EntitlementOwner1!");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await page.getByLabel("Agency name").fill(`Entitlement Agency ${stamp}`);
    await page.getByLabel("Slug").fill(agencySlug);
    await page.getByLabel("Contact email").fill(`entitlement-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Entitlement Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    const clientName = `Entitlement Client ${stamp}`;
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Business name").fill(clientName);
    await page.getByLabel("Business slug").fill(`entitlement-client-${stamp}`);
    await page.getByLabel("Owner full name").fill("Entitlement Client Owner");
    await page.getByLabel("Owner email").fill(`entitlement-client-owner-${stamp}@test.local`);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("First location name").fill(`${clientName} Main`);
    await page.getByLabel("Location slug").fill(`entitlement-client-main-${stamp}`);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click(); // skip Commercial
    await page.getByRole("button", { name: "Next" }).click(); // skip Owner access (default invite)
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });

    const agency = await db.collection("agencies").findOne({ slug: agencySlug });
    expect(agency).not.toBeNull();

    // --- Seed a restrictive AGENCY-type plan and an ACTIVE subscription for this agency. ---
    const planResult = await db.collection("plans").insertOne({
      code: `entitlement-restrictive-agency-${stamp}`,
      name: "Entitlement Test — Restrictive Agency",
      type: "AGENCY",
      pricing: [],
      entitlements: [
        { key: "custom_domains", value: false },
        { key: "max_businesses", value: 5 },
        { key: "managed_business_max_locations", value: 3 },
      ],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdPlanIds.push(planResult.insertedId);
    const now = new Date();
    const subResult = await db.collection("subscriptions").insertOne({
      ownerType: "agency",
      ownerId: agency!._id,
      planId: planResult.insertedId,
      status: "active",
      billingInterval: "monthly",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      provider: "mock",
      createdAt: now,
      updatedAt: now,
    });
    createdSubscriptionIds.push(subResult.insertedId);

    // --- Enter the client workspace and open Settings > Domain — the entitlement this agency's
    // restrictive plan excludes. ---
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });

    // --- Locations page: the exact page whose businessId bug this phase found and fixed — must
    // render normally for an agency member in-workspace, never blank/broken. ---
    await page.getByRole("link", { name: "Locations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByText("Requires an active plan")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Custom domains require an active plan on this account/i)).toBeVisible();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toHaveCount(0);

    // --- The agency's subscription expires (the real, existing state machine — no second lifecycle
    // invented). Phase 63 fix: this business's managed-entitlement source is now "lapsed" — the
    // agency HAS a real subscription history, just not a live one — which must NEVER be treated the
    // same as "this business's chain never had a subscription at all." The feature must stay denied,
    // not silently re-granted through the generous no-subscription fallback. ---
    await db.collection("subscriptions").updateOne({ _id: subResult.insertedId }, { $set: { status: "expired" } });

    // A full page.reload() races AuthProvider's mount-time refresh under React StrictMode and can
    // intermittently bounce the session to /login (the same documented gotcha full-order-flow.spec.ts
    // avoids) — in-app client-side navigation away and back re-mounts the entitlement fetch without
    // that risk.
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    // Still locked — the core Phase 63 safety proof, live in the real UI, not just at the Jest
    // service level. Core operability (this page rendering at all, Menu/Locations still reachable)
    // is unaffected either way — only this specific paid-tier feature stays gated.
    await expect(page.getByText("Requires an active plan")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toHaveCount(0);
  });
});

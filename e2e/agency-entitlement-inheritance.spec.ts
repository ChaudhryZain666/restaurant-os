import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 59 (entitlement/pricing audit) — proves, through the real browser UI (not just the Jest
 * service-level tests in agencyEntitlementInheritance.service.test.ts), that a managed business's
 * entitlement-gated pages actually reflect its managing agency's real, live subscription — and that
 * the storefront/functionality is never broken when that agency subscription later expires.
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

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("a restrictive agency plan locks Domains in-workspace; the agency's subscription expiring unlocks it again, never breaking the page", async ({
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
    await expect(page.getByText("Upgrade required")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Custom domains aren't included on your current plan/i)).toBeVisible();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toHaveCount(0);

    // --- The agency's subscription expires (the real, existing state machine — no second lifecycle
    // invented). Inherited entitlements must stop immediately, falling through to the generous
    // no-subscription default, so the managed business's storefront/functionality is never broken by
    // its agency's billing lapsing (Section 5's explicit safety requirement). ---
    await db.collection("subscriptions").updateOne({ _id: subResult.insertedId }, { $set: { status: "expired" } });

    // A full page.reload() races AuthProvider's mount-time refresh under React StrictMode and can
    // intermittently bounce the session to /login (the same documented gotcha full-order-flow.spec.ts
    // avoids) — in-app client-side navigation away and back re-mounts the entitlement fetch without
    // that risk.
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByText("Upgrade required")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toBeVisible();
  });
});

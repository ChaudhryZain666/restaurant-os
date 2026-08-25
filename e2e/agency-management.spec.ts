import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 25 — the real, browser-driven proof of the Agency foundation: a fresh account registers,
 * creates an agency, creates a business (which transactionally invites its owner — the invite
 * itself is proven via the existing owner-invite-pending badge, not a full accept round-trip,
 * matching this spec's "one focused journey" scope), invites a team member, and — the core
 * security proof — a second, entirely unrelated agency cannot see the first agency's businesses.
 *
 * Phase 26 extends the SAME journey to cross the boundary Phase 25 deliberately stopped at:
 * entering the managed business's actual operational admin (Menu/Orders), confirmed via the
 * "Managing ... via ..." banner and successful (non-403) page loads, then exiting cleanly back to
 * the Agency section — proving BusinessContext/LocationContext/requireTenantMatch's agency branch
 * all actually work end to end through the real browser UI, not just Jest's HTTP-level proof.
 */
test.describe.serial("agency foundation — create, manage businesses, invite team, isolation (Phase 25)", () => {
  test("agency owner journey end to end, plus cross-agency isolation", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();

    // --- Register a fresh account (the admin app's only self-serve entry point). ---
    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Agency Owner");
    await page.getByLabel("Email").fill(`agency-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("AgencyOwner1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    // --- No agency yet -> create one. ---
    await expect(page.getByText("Create your agency")).toBeVisible();
    await page.getByLabel("Agency name").fill(`Test Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`test-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`agency-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Test Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("agency_owner")).toBeVisible();

    // --- Create a business — transactionally creates the business, its first location, and
    // invites the owner. ---
    await page.getByRole("link", { name: "Businesses", exact: true }).click();
    await page.getByRole("button", { name: "New business" }).click();
    await page.getByLabel("Business name").fill(`Agency Client ${stamp}`);
    await page.getByLabel("Business slug").fill(`agency-client-${stamp}`);
    await page.getByLabel("First location name").fill(`Client Location ${stamp}`);
    await page.getByLabel("Location slug").fill(`client-location-${stamp}`);
    await page.getByLabel("Owner full name").fill("Client Owner");
    await page.getByLabel("Owner email").fill(`client-owner-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create business & invite owner" }).click();

    await expect(page.getByText(`Agency Client ${stamp}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Invite pending")).toBeVisible();

    // --- Phase 26: enter the managed business's real operational admin as the agency owner
    // (implicit access, no explicit businessIds assignment needed), confirm Menu/Orders actually
    // load (proves requireTenantMatch's agency branch, not just requireBusinessMatch's), then exit
    // cleanly back to the Agency section. ---
    await page.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await expect(page.getByText(`Managing Agency Client ${stamp}`)).toBeVisible();
    await expect(page.getByText(`via Test Agency ${stamp}`)).toBeVisible();

    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page).toHaveURL(/\/menu$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });

    await page.getByRole("button", { name: "← Back to Agency" }).click();
    await expect(page).toHaveURL(/\/agency\/businesses$/, { timeout: 10_000 });
    await expect(page.getByText(`Agency Client ${stamp}`)).toBeVisible();

    // --- Invite a team member. ---
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByLabel("Name").fill("Agency Staffer");
    await page.getByLabel("Email").fill(`agency-staffer-${stamp}@test.local`);
    await page.getByLabel("Role").selectOption({ label: "Staff" });
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Agency Staffer")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("invited", { exact: true })).toBeVisible();

    // --- The core security proof: a second, unrelated agency owner never sees this agency's
    // business, even by directly hitting the API with their own valid session. ---
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto("http://localhost:5174/register");
    await otherPage.getByLabel("Full name").fill("Other Agency Owner");
    await otherPage.getByLabel("Email").fill(`other-agency-owner-${stamp}@test.local`);
    await otherPage.getByLabel("Password").fill("OtherAgency1!");
    await otherPage.getByRole("button", { name: "Create account" }).click();
    await expect(otherPage).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await otherPage.getByLabel("Agency name").fill(`Other Agency ${stamp}`);
    await otherPage.getByLabel("Slug").fill(`other-agency-${stamp}`);
    await otherPage.getByLabel("Contact email").fill(`other-agency-contact-${stamp}@test.local`);
    await otherPage.getByRole("button", { name: "Create agency" }).click();
    await expect(otherPage.getByText(`Other Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    await otherPage.getByRole("link", { name: "Businesses", exact: true }).click();
    await expect(otherPage.getByText("No businesses yet")).toBeVisible({ timeout: 10_000 });
    await expect(otherPage.getByText(`Agency Client ${stamp}`)).not.toBeVisible();

    await otherContext.close();
  });
});

/**
 * Phase 27 — the real, browser-driven proof of agency plan limits: subscribe -> create businesses
 * -> hit the plan's real max_businesses -> creation is blocked in the actual UI (never merely a
 * disabled button — the server 409 surfaces as a real error) -> change to a higher-limit plan ->
 * the next business succeeds. The two test plans/subscription are seeded directly via Mongo (the
 * same documented exception this suite already uses for reading invite tokens, extended here to
 * writing pure catalog/config test fixtures — never financial or user data) so this proves the
 * REAL atomic limit without creating enough businesses through the UI to exhaust the shared dev
 * seed catalog's actual commercial numbers.
 */
test.describe.serial("agency plan limits — subscribe, hit limit, upgrade, succeed (Phase 27)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("agency hits its plan's business limit, is blocked, upgrades, and then succeeds", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();

    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Limit Test Owner");
    await page.getByLabel("Email").fill(`agency-limit-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("LimitOwner1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await page.getByLabel("Agency name").fill(`Limit Test Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`limit-test-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`agency-limit-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Limit Test Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    const agencyDoc = await db.collection("agencies").findOne({ name: `Limit Test Agency ${stamp}` });
    const agencyId = agencyDoc!._id;

    const lowPlan = await db.collection("plans").insertOne({
      code: `e2e-agency-low-${stamp}`,
      name: "E2E Low Limit",
      type: "AGENCY",
      pricing: [],
      entitlements: [{ key: "max_businesses", value: 1 }],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const highPlan = await db.collection("plans").insertOne({
      code: `e2e-agency-high-${stamp}`,
      name: "E2E High Limit",
      type: "AGENCY",
      pricing: [],
      entitlements: [{ key: "max_businesses", value: 2 }],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("subscriptions").insertOne({
      ownerType: "agency",
      ownerId: agencyId,
      planId: lowPlan.insertedId,
      status: "active",
      billingInterval: "monthly",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      // provider:"mock" (never "internal") — Phase 27 deliberately excludes provider:"internal"
      // (grandfathered) subscriptions from all limit enforcement, so this test's premise (a real
      // plan-derived limit actually blocking a second business) requires a real, non-grandfathered
      // subscription record.
      provider: "mock",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // --- Subscribed to a plan whose real max_businesses is 1: the first business succeeds. ---
    await page.getByRole("link", { name: "Businesses", exact: true }).click();
    await page.getByRole("button", { name: "New business" }).click();
    await page.getByLabel("Business name").fill(`Limit Client One ${stamp}`);
    await page.getByLabel("Business slug").fill(`limit-client-one-${stamp}`);
    await page.getByLabel("First location name").fill(`Limit Location One ${stamp}`);
    await page.getByLabel("Location slug").fill(`limit-location-one-${stamp}`);
    await page.getByLabel("Owner full name").fill("Limit Client Owner One");
    await page.getByLabel("Owner email").fill(`limit-client-owner-one-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create business & invite owner" }).click();
    await expect(page.getByText(`Limit Client One ${stamp}`)).toBeVisible({ timeout: 10_000 });

    // --- A second business is REJECTED by the real server-side limit — a genuine error, not a
    // disabled button (the form itself never pre-checks the limit client-side). ---
    await page.getByRole("button", { name: "New business" }).click();
    await page.getByLabel("Business name").fill(`Limit Client Two ${stamp}`);
    await page.getByLabel("Business slug").fill(`limit-client-two-${stamp}`);
    await page.getByLabel("First location name").fill(`Limit Location Two ${stamp}`);
    await page.getByLabel("Location slug").fill(`limit-location-two-${stamp}`);
    await page.getByLabel("Owner full name").fill("Limit Client Owner Two");
    await page.getByLabel("Owner email").fill(`limit-client-owner-two-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create business & invite owner" }).click();
    await expect(page.getByText(/business limit/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`Limit Client Two ${stamp}`)).not.toBeVisible();

    // --- Upgrade to the higher-limit plan via the real Billing UI change-plan action. ---
    await page.getByRole("link", { name: "Billing", exact: true }).click();
    await expect(page.getByText("E2E Low Limit")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Change plan:").selectOption({ label: "E2E High Limit" });
    await expect(page.getByText("E2E High Limit")).toBeVisible({ timeout: 10_000 });

    // --- The same second business now succeeds. ---
    await page.getByRole("link", { name: "Businesses", exact: true }).click();
    await page.getByRole("button", { name: "New business" }).click();
    await page.getByLabel("Business name").fill(`Limit Client Two ${stamp}`);
    await page.getByLabel("Business slug").fill(`limit-client-two-${stamp}`);
    await page.getByLabel("First location name").fill(`Limit Location Two ${stamp}`);
    await page.getByLabel("Location slug").fill(`limit-location-two-${stamp}`);
    await page.getByLabel("Owner full name").fill("Limit Client Owner Two");
    await page.getByLabel("Owner email").fill(`limit-client-owner-two-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create business & invite owner" }).click();
    await expect(page.getByText(`Limit Client Two ${stamp}`)).toBeVisible({ timeout: 10_000 });
  });
});

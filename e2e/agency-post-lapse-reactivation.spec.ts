import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 64, Section 9 (Agency) — the full agency-side post-lapse recovery journey proven live in
 * the browser: the agency's own subscription lapses -> its managed business loses the entitlement
 * it only ever had through inheritance (custom_domains, granted by agency_growth_v2 — see
 * planCatalogSeed.service.ts) -> the Agency Dashboard shows a clear recovery state -> the agency
 * reactivates through the real plan picker/checkout flow (never a shortcut) -> the subscription
 * becomes active again -> the managed business regains the inherited entitlement -> the managed
 * business and its owner account are untouched throughout.
 *
 * Only one AGENCY-type plan is active in the real catalog today (agency_growth_v2 — see
 * agency-entitlement-inheritance.spec.ts's own doc comment), so this drives the entire lifecycle
 * through the real self-serve UI rather than seeding a synthetic plan. The agency's trial expiry
 * itself is seeded directly against Mongo (status: "expired", trialEnd in the past) — the same
 * "seed what only real time passage / a background sweep job could otherwise produce" convention
 * already established by agency-entitlement-inheritance.spec.ts and owner-post-lapse-reactivation.spec.ts.
 */
test.describe.serial("agency post-lapse experience and reactivation (Phase 64)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("agency subscription lapses -> managed business loses inherited entitlement -> agency recovery UI -> real mock-checkout reactivation -> entitlement and data restored", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const agencySlug = `e2e-agency-lapse-${stamp}`;
    const clientName = `E2E Agency Lapse Client ${stamp}`;

    // --- Register a fresh agency and provision one client business. ---
    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Agency Lapse Owner");
    await page.getByLabel("Email").fill(`agency-lapse-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("AgencyLapseOwner1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await page.getByLabel("Agency name").fill(`Agency Lapse ${stamp}`);
    await page.getByLabel("Slug").fill(agencySlug);
    await page.getByLabel("Contact email").fill(`agency-lapse-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Agency Lapse ${stamp}`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Business name").fill(clientName);
    await page.getByLabel("Business slug").fill(`e2e-agency-lapse-client-${stamp}`);
    await page.getByLabel("Owner full name").fill("Agency Lapse Client Owner");
    await page.getByLabel("Owner email").fill(`agency-lapse-client-owner-${stamp}@test.local`);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("First location name").fill(`${clientName} Main`);
    await page.getByLabel("Location slug").fill(`e2e-agency-lapse-client-main-${stamp}`);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click(); // skip Commercial
    await page.getByRole("button", { name: "Next" }).click(); // skip Owner access (default invite)
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });

    const agency = await db.collection("agencies").findOne({ slug: agencySlug });
    expect(agency).not.toBeNull();
    const business = await db.collection("businesses").findOne({ name: clientName });
    expect(business).not.toBeNull();

    // --- Agency starts a real no-card trial on the one active AGENCY plan. ---
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Plan").selectOption({ value: "agency_growth_v2" });
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- The managed business genuinely inherits the entitlement while the agency is live (proves
    // the later "locked" state is a real change, not a page that was always locked). ---
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("link", { name: "Manage" }).click();
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Requires an active plan")).toHaveCount(0);

    // --- Back to the agency portal (exiting the workspace, not logging out). ---
    await page.getByRole("button", { name: /Back to Agency/ }).click();
    await expect(page).toHaveURL(/\/agency\/businesses$/, { timeout: 10_000 });

    // --- The agency's subscription lapses — seeded directly (see file header). ---
    const subDoc = await db.collection("subscriptions").findOne({ ownerType: "agency", ownerId: agency!._id });
    expect(subDoc).not.toBeNull();
    await db
      .collection("subscriptions")
      .updateOne({ _id: subDoc!._id }, { $set: { status: "expired", trialEnd: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

    // --- The managed business loses the inherited entitlement — must never silently fall back to
    // the generous no-subscription default (the exact Phase 63 safety property; here proven through
    // the real reactivation lifecycle rather than a one-way expiry). ---
    await page.getByRole("link", { name: "Manage" }).click();
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByText("Requires an active plan")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toHaveCount(0);

    // --- The agency sees a clear recovery state on its own Dashboard, never a full-page takeover. ---
    await page.getByRole("button", { name: /Back to Agency/ }).click();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByText("Your agency subscription has ended")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Your agency account, every managed client, and their restaurant data are all still here", { exact: false })).toBeVisible();

    // --- Agency reactivates through the banner's own CTA -> the real plan picker/checkout flow. ---
    await page.getByRole("link", { name: "Choose a plan" }).click();
    await expect(page).toHaveURL(/\/agency\/billing$/, { timeout: 10_000 });
    await expect(page.getByText("Trial expired", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Ready to pick back up?")).toBeVisible();
    await expect(page.getByText("Choose a plan below to pick up where you left off.")).toBeVisible();

    await page.getByLabel("Plan").selectOption({ value: "agency_growth_v2" });
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page).toHaveURL(/\/mock-checkout\//, { timeout: 10_000 });
    await page.getByRole("button", { name: "Confirm mock payment" }).click();
    await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Back to billing" }).click();
    await expect(page).toHaveURL(/\/agency\/billing$/, { timeout: 10_000 });
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- The managed business regains the inherited entitlement. ---
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("link", { name: "Manage" }).click();
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Requires an active plan")).toHaveCount(0);

    // --- The managed business and its owner account are untouched throughout. ---
    const businessAfter = await db.collection("businesses").findOne({ _id: business!._id });
    expect(businessAfter).not.toBeNull();
    expect(businessAfter!.name).toBe(clientName);
    expect(businessAfter!.status).not.toBe("suspended");
    const ownerAfter = await db.collection("users").findOne({ email: `agency-lapse-client-owner-${stamp}@test.local` });
    expect(ownerAfter).not.toBeNull();
    expect(ownerAfter!.businessId?.toString()).toBe(business!._id.toString());

    // --- No duplicate subscription: exactly one LIVE subscription for this agency, ever. ---
    const liveCount = await db.collection("subscriptions").countDocuments({
      ownerType: "agency",
      ownerId: agency!._id,
      status: { $in: ["trialing", "active", "past_due", "cancelling"] },
    });
    expect(liveCount).toBe(1);
  });
});

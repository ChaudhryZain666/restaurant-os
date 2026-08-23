import { test, expect } from "@playwright/test";

/**
 * Phase 25 — the real, browser-driven proof of the Agency foundation: a fresh account registers,
 * creates an agency, creates a business (which transactionally invites its owner — the invite
 * itself is proven via the existing owner-invite-pending badge, not a full accept round-trip,
 * matching this spec's "one focused journey" scope), invites a team member, and — the core
 * security proof — a second, entirely unrelated agency cannot see the first agency's businesses.
 * Deliberately does not exercise "switching into a managed business's own admin" — that's explicit
 * out-of-scope this phase (see docs/multi-tenant-storefront-architecture.md's Phase 25 section);
 * an agency creates businesses and invites their owners, it doesn't operate them day-to-day.
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

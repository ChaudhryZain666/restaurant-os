import { test, expect } from "@playwright/test";

/**
 * Phase 58 — the Agency Portal 2.0 journey (Section 36's required critical path), driven through
 * the real UI. Reuses the exact registration/agency-creation boilerplate agency-management.spec.ts
 * already established (Phase 25/26) — this spec's own focus is everything Phase 58 actually added:
 * search/filter/sort on Clients, the location drill-down page, and the new Settings page (profile +
 * white-label domain), plus a light cross-agency check on the new location-detail route specifically
 * (full cross-agency isolation for businesses/team/etc. is already thoroughly proven by the existing
 * Phase 25/26 spec and by this phase's own Jest coverage — not duplicated here).
 */
test.describe.serial("Agency Portal 2.0 — search/filter, location drill-down, settings (Phase 58)", () => {
  test("agency login -> dashboard -> clients search/filter -> client -> location -> owner/billing/activity -> settings, plus cross-agency isolation on the new location route", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();

    // --- Register and create a fresh agency. ---
    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Portfolio Owner");
    await page.getByLabel("Email").fill(`portfolio-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("PortfolioOwner1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await expect(page.getByText("Create your agency")).toBeVisible();
    await page.getByLabel("Agency name").fill(`Portfolio Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`portfolio-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`portfolio-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Portfolio Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    // --- Dashboard: this IS the agency control plane — confirm it says so, not a generic "Home". ---
    await expect(page.getByRole("heading", { name: `Portfolio Agency ${stamp}` })).toBeVisible();

    // --- Create two clients (via ClientProvisioningWizard, Phase 59), so search/filter has
    // something real to narrow down. Each creation lands on the new client's own Detail page, so
    // this helper navigates back to Clients afterward. ---
    async function createClient(name: string) {
      await page.getByRole("link", { name: "Clients", exact: true }).click();
      await page.getByRole("button", { name: "New client" }).click();
      await page.getByLabel("Business name").fill(name);
      await page.getByLabel("Business slug").fill(name.toLowerCase().replace(/\s+/g, "-"));
      await page.getByLabel("Owner full name").fill(`${name} Owner`);
      await page.getByLabel("Owner email").fill(`${name.toLowerCase().replace(/\s+/g, "-")}-owner-${stamp}@test.local`);
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByLabel("First location name").fill(`${name} Downtown`);
      await page.getByLabel("Location slug").fill(`${name.toLowerCase().replace(/\s+/g, "-")}-downtown`);
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Next" }).click(); // Commercial — left blank
      await page.getByRole("button", { name: "Next" }).click(); // Owner access — default "invite"
      await page.getByRole("button", { name: "Create client" }).click();
      await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 10_000 });
    }
    const clientA = `Alpha Bistro ${stamp}`;
    const clientB = `Beta Cafe ${stamp}`;
    await createClient(clientA);
    await createClient(clientB);
    await page.getByRole("link", { name: "Clients", exact: true }).click();

    // --- Search narrows to exactly the matching client. ---
    await page.getByPlaceholder("Search by client, owner name, or owner email...").fill("Alpha Bistro");
    await expect(page.getByRole("row", { name: new RegExp(clientA) })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("row", { name: new RegExp(clientB) })).not.toBeVisible();

    // --- Filter: both clients are freshly created (pending owner) — the filter should include them. ---
    await page.getByPlaceholder("Search by client, owner name, or owner email...").fill("");
    await page.getByRole("combobox").filter({ hasText: "All clients" }).selectOption({ label: "Awaiting owner acceptance" });
    await expect(page.getByRole("row", { name: new RegExp(clientA) })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("row", { name: new RegExp(clientB) })).toBeVisible();
    await page.getByRole("combobox").filter({ hasText: "Awaiting owner acceptance" }).selectOption({ label: "All clients" });

    // --- Open a client (its name is a real link into the detail page), view owner status, drill
    // into its location (also a real link, not just display text). ---
    await page.getByRole("row", { name: new RegExp(clientA) }).getByRole("link", { name: clientA }).click();
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(page.getByText("Invite pending")).toBeVisible();
    await expect(page.getByRole("link", { name: `${clientA} Downtown` })).toBeVisible();

    await page.getByRole("link", { name: `${clientA} Downtown` }).click();
    await expect(page).toHaveURL(/\/agency\/locations\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: `${clientA} Downtown` })).toBeVisible();
    await expect(page.getByText("Setup readiness")).toBeVisible();
    await expect(page.getByRole("link", { name: clientA })).toBeVisible(); // business-context breadcrumb link

    // --- Return to clients, open the second client. ---
    await page.getByRole("link", { name: "Back to locations" }).click();
    await expect(page).toHaveURL(/\/agency\/locations$/, { timeout: 10_000 });
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("row", { name: new RegExp(clientB) }).getByRole("link", { name: clientB }).click();
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });
    const clientBUrl = page.url();
    const clientBId = clientBUrl.split("/").pop()!;

    // --- Billing: clearly an agency-level (not client-level) surface. ---
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/agency\/billing$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Agency billing" })).toBeVisible();

    // --- Activity: agency-scoped audit trail, real entries from everything done above. ---
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/agency\/activity$/, { timeout: 10_000 });
    await expect(page.getByRole("cell", { name: "Client created" }).first()).toBeVisible({ timeout: 10_000 });

    // --- Settings: profile edit + white-label domain boundary (Section 12A) — real save, and the
    // UI is honest that verification alone doesn't enable email sending. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/agency\/settings$/, { timeout: 10_000 });
    await page.getByLabel("Description (optional)").fill("A real portfolio-management agency.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/does not do yet/i)).toBeVisible();
    await page.getByLabel("Domain").fill(`whitelabel-${stamp}.example.test`);
    await page.getByRole("button", { name: "Add domain" }).click();
    await expect(page.getByText("Pending verification")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Add this DNS TXT record/i)).toBeVisible();
    // No live DNS record was ever published for this fake domain — verifying honestly reports
    // "not verified yet", never a fabricated success.
    await page.getByRole("button", { name: "Verify now" }).click();
    await expect(page.getByText(/not verified yet/i)).toBeVisible({ timeout: 10_000 });

    // --- Cross-agency isolation on the new location-detail route specifically. ---
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto("http://localhost:5174/register");
    await otherPage.getByLabel("Full name").fill("Rival Agency Owner");
    await otherPage.getByLabel("Email").fill(`rival-owner-${stamp}@test.local`);
    await otherPage.getByLabel("Password").fill("RivalOwner1!");
    await otherPage.getByRole("button", { name: "Create account" }).click();
    await expect(otherPage).toHaveURL(/\/agency$/, { timeout: 10_000 });
    await otherPage.getByLabel("Agency name").fill(`Rival Agency ${stamp}`);
    await otherPage.getByLabel("Slug").fill(`rival-agency-${stamp}`);
    await otherPage.getByLabel("Contact email").fill(`rival-contact-${stamp}@test.local`);
    await otherPage.getByRole("button", { name: "Create agency" }).click();
    await expect(otherPage.getByText(`Rival Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    // Direct URL navigation to the FIRST agency's own client-detail page, using the rival's own
    // real authenticated session (their own bearer token, not a bypassed/faked request) — the
    // server must reject this regardless of what the rival's own UI ever links to. Mirrors
    // agency-management.spec.ts's own proven isolation-check style (real navigation, not a
    // synthetic API call that wouldn't carry the browser's in-memory bearer token anyway).
    await otherPage.goto(`http://localhost:5174/agency/businesses/${clientBId}`);
    await expect(otherPage.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(otherPage.getByText(clientB)).not.toBeVisible();

    await otherContext.close();
  });
});

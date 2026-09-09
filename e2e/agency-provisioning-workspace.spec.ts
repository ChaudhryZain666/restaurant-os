import { test, expect } from "@playwright/test";

/**
 * Phase 59 — Section 22's required critical journey: an agency provisions a real client end to
 * end (client -> restaurant -> commercial terms -> owner access), enters the client's workspace
 * using its OWN agency identity (never impersonating the owner), configures real data through the
 * existing restaurant-management system, exits cleanly, and the restaurant owner then independently
 * logs in with their own real credentials and sees the SAME configured data — proving no owner
 * impersonation, no broken ownership, and that "direct access" mode really does hand a REAL,
 * one-time, system-generated password to the agency (not something the agency invents). Finishes
 * with a cross-agency isolation check and a mobile-viewport check on the wizard itself.
 */
test.describe.serial("Agency client provisioning, commercial terms, and workspace (Phase 59)", () => {
  test("agency creates a client with commercial terms, configures its restaurant in-workspace, and the owner independently takes over", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();

    // --- Register and create a fresh agency. ---
    await page.goto("http://localhost:5174/register");
    await page.getByLabel("Full name").fill("Provisioning Agency Owner");
    await page.getByLabel("Email").fill(`provisioning-owner-${stamp}@test.local`);
    await page.getByLabel("Password").fill("ProvisioningOwner1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/agency$/, { timeout: 10_000 });

    await page.getByLabel("Agency name").fill(`Provisioning Agency ${stamp}`);
    await page.getByLabel("Slug").fill(`provisioning-agency-${stamp}`);
    await page.getByLabel("Contact email").fill(`provisioning-contact-${stamp}@test.local`);
    await page.getByRole("button", { name: "Create agency" }).click();
    await expect(page.getByText(`Provisioning Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    // --- Open the guided wizard and step through Client -> Restaurant -> Commercial -> Owner -> Review. ---
    const clientName = `El Rancho ${stamp}`;
    const ownerEmail = `el-rancho-owner-${stamp}@test.local`;
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("button", { name: "New client" }).click();

    await page.getByLabel("Business name").fill(clientName);
    await page.getByLabel("Business slug").fill(`el-rancho-${stamp}`);
    await page.getByLabel("Owner full name").fill("El Rancho Owner");
    await page.getByLabel("Owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("First location name").fill(`${clientName} Downtown`);
    await page.getByLabel("Location slug").fill(`el-rancho-downtown-${stamp}`);
    await page.getByRole("button", { name: "Next" }).click();

    // --- Commercial step: an honest, non-payment-collecting agreement record. ---
    await expect(page.getByText(/not collected by the platform/i)).toBeVisible();
    await page.getByLabel("Client price (optional)").fill("149.00");
    await page.getByLabel("This client is in a trial period").check();
    await page.getByRole("button", { name: "Next" }).click();

    // --- Owner access step: "direct" mode so this test can log in as the real owner later,
    // proving the temporary password is genuinely usable, not merely displayed. ---
    await page.getByLabel("Create owner access now", { exact: false }).check();
    await page.getByRole("button", { name: "Next" }).click();

    // --- Review step shows the real values about to be created, not placeholders. ---
    await expect(page.getByText(clientName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(`${clientName} Downtown`)).toBeVisible();
    await expect(page.getByText(ownerEmail)).toBeVisible();
    await expect(page.getByText("$149.00/mo")).toBeVisible();
    await page.getByRole("button", { name: "Create client" }).click();

    // --- Lands directly on the new client's Detail page (Section 7). ---
    await expect(page).toHaveURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: clientName })).toBeVisible({ timeout: 10_000 });
    const clientDetailUrl = page.url();

    await expect(page.getByText(/Owner access created/i)).toBeVisible();
    const temporaryPassword = (await page.locator("code").textContent())!.trim();
    expect(temporaryPassword.length).toBeGreaterThan(8);

    // --- Commercial terms actually persisted and render honestly (a real agreement record, never
    // implying the platform collected a payment). ---
    await expect(page.getByText("$149.00/mo")).toBeVisible();
    await expect(page.getByText("trial", { exact: true })).toBeVisible();
    await expect(page.getByText(/not collected by the platform/i)).toBeVisible();

    // --- Enter the client workspace using the AGENCY's own identity — never the owner's. ---
    await page.getByRole("button", { name: "Manage this business" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await expect(page.getByText(`Managing ${clientName}`)).toBeVisible();
    await expect(page.getByText(`via Provisioning Agency ${stamp}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "← Back to Agency" })).toBeVisible();

    // --- Configure real, representative setup data using the EXISTING restaurant-management
    // system (never a second Owner Portal) — add a menu category. ---
    const categoryName = `Tacos ${stamp}`;
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(page).toHaveURL(/\/menu$/, { timeout: 10_000 });
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByText(categoryName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Exit cleanly back to the agency section. ---
    await page.getByRole("button", { name: "← Back to Agency" }).click();
    await expect(page).toHaveURL(/\/agency\/businesses$/, { timeout: 10_000 });

    // --- The owner independently logs in with the REAL temporary password (never typed by the
    // agency — system-generated, Section 1's "never copy the owner's credentials"), in a completely
    // fresh browser context (no shared cookies/session with the agency). ---
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("http://localhost:5174/login");
    await ownerPage.locator('input[type="email"]').fill(ownerEmail);
    await ownerPage.locator('input[type="password"]').fill(temporaryPassword);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await expect(ownerPage).toHaveURL(/\/force-password-change$/, { timeout: 10_000 });
    await ownerPage.getByLabel("Temporary password").fill(temporaryPassword);
    await ownerPage.getByLabel("New password", { exact: true }).fill("ElRanchoOwner1!");
    await ownerPage.getByLabel("Confirm new password").fill("ElRanchoOwner1!");
    await ownerPage.getByRole("button", { name: /Set password/ }).click();
    await expect(ownerPage).not.toHaveURL(/\/force-password-change$/, { timeout: 10_000 });

    // --- The owner sees THEIR OWN Restaurant Owner Portal (never Agency navigation), and the
    // exact same real data the agency configured moments ago. ---
    await expect(ownerPage.getByRole("link", { name: "Clients", exact: true })).toHaveCount(0);
    await ownerPage.getByRole("link", { name: "Menu", exact: true }).click();
    await expect(ownerPage.getByText(categoryName, { exact: true })).toBeVisible({ timeout: 10_000 });

    await ownerContext.close();

    // --- Cross-agency isolation: a rival agency, using its own real authenticated session, is
    // rejected by direct URL navigation to this client's detail page. ---
    const rivalContext = await browser.newContext();
    const rivalPage = await rivalContext.newPage();
    await rivalPage.goto("http://localhost:5174/register");
    await rivalPage.getByLabel("Full name").fill("Rival Provisioning Owner");
    await rivalPage.getByLabel("Email").fill(`rival-provisioning-${stamp}@test.local`);
    await rivalPage.getByLabel("Password").fill("RivalProvisioning1!");
    await rivalPage.getByRole("button", { name: "Create account" }).click();
    await expect(rivalPage).toHaveURL(/\/agency$/, { timeout: 10_000 });
    await rivalPage.getByLabel("Agency name").fill(`Rival Provisioning Agency ${stamp}`);
    await rivalPage.getByLabel("Slug").fill(`rival-provisioning-agency-${stamp}`);
    await rivalPage.getByLabel("Contact email").fill(`rival-provisioning-contact-${stamp}@test.local`);
    await rivalPage.getByRole("button", { name: "Create agency" }).click();
    await expect(rivalPage.getByText(`Rival Provisioning Agency ${stamp}`)).toBeVisible({ timeout: 10_000 });

    await rivalPage.goto(clientDetailUrl);
    await expect(rivalPage.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(rivalPage.getByText(clientName)).not.toBeVisible();
    await rivalContext.close();

    // --- Mobile viewport: the wizard itself must be genuinely usable at 390px, not a shrunken
    // desktop modal (Section 18). ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost:5174/agency/businesses");
    await page.getByRole("button", { name: "New client" }).click();
    await expect(page.getByLabel("Business name")).toBeVisible();
    const wizardWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wizardWidth).toBeLessThanOrEqual(390);
  });
});

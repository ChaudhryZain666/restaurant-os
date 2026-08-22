import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 22 — the real, browser-driven proof of the custom-domain lifecycle: an owner adds a
 * domain through the actual Settings > Domain tab, sees the pending-verification DNS instructions,
 * and moves it through verify -> activate -> deactivate -> remove, with the real storefront-
 * resolution endpoint checked at each step (via a direct API call, not literal browser navigation
 * to a different hostname — this local/CI environment has no DNS control over an arbitrary test
 * hostname, and this platform is a client-side SPA with no server-rendering, so the actual
 * `window.location.hostname`-driven resolution path is exercised in full by
 * apps/web/src/context/RestaurantContext.tsx's own logic, already covered directly by Jest/
 * supertest against the real HTTP layer in apps/api/src/controllers/domain.controller.test.ts;
 * see docs/multi-tenant-storefront-architecture.md's Phase 22 section for the full breakdown of
 * what's locally verified this way vs. genuinely deployment-dependent).
 *
 * Verification uses the mock DNS provider (DNS_VERIFIER=mock, the local dev default) — a
 * MockDnsRecord seeded directly via Mongo, the same documented, precedented exception this
 * project already relies on for e2e tests reading real invite tokens directly from Mongo instead
 * of a real inbox.
 */
test.describe.serial("custom domain management (Phase 22)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("owner adds, verifies, activates, deactivates, and removes a custom domain through the real UI, with real storefront resolution checked at each step", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    // navigator.clipboard.writeText needs an explicit permission grant in a fresh browser context
    // — without it the copy button's handler silently no-ops (caught, not thrown), which is the
    // correct real-world fallback behavior but would make this assertion meaningless.
    await page.context().grantPermissions(["clipboard-write", "clipboard-read"], { origin: "http://localhost:5174" });
    const stamp = Date.now();
    const hostname = `orders-${stamp}.e2e-test.example`;
    const verificationRecordHost = `_tablecloth-verify.${hostname}`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("amara@spice-route.local");
    await page.locator('input[type="password"]').fill("Owner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByText("Platform URL")).toBeVisible();

    // --- Add the domain. Every assertion from here on is scoped to THIS domain's own fieldset —
    // not page-wide text — since this shared dev database can accumulate other domains from
    // earlier runs of this same spec (same lesson as Phase 21's "Spice Route Downtown" locations:
    // scope to what THIS test created, never assume a clean slate). ---
    await page.getByLabel("Domain").fill(hostname);
    await page.getByRole("button", { name: "Add domain" }).click();
    const domainCard = page.locator("fieldset").filter({ has: page.getByText(hostname, { exact: true }) });
    await expect(domainCard).toBeVisible({ timeout: 10_000 });
    await expect(domainCard.getByText("Verification required")).toBeVisible();

    // The exact TXT host/value the UI displays must match what the backend actually expects.
    await expect(domainCard.getByText(verificationRecordHost, { exact: false })).toBeVisible();
    await domainCard.getByRole("button", { name: "Copy" }).click();
    await expect(domainCard.getByRole("button", { name: "Copied!" })).toBeVisible();

    // Not resolvable yet — no active mapping exists.
    const beforeVerify = await request.get(`http://localhost:4000/api/v1/restaurants/by-domain/${hostname}`);
    expect(beforeVerify.status()).toBe(404);

    // --- Simulate DNS: seed the mock TXT record, matching the token the UI displayed. ---
    const domainRow = await db.collection("domainmappings").findOne({ hostname });
    expect(domainRow).not.toBeNull();
    await db.collection("mockdnsrecords").insertOne({
      hostname: verificationRecordHost,
      txtValues: [domainRow!.verificationToken],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // --- Check verification. ---
    await domainCard.getByRole("button", { name: "Check verification" }).click();
    await expect(domainCard.getByText("Verified — not live yet")).toBeVisible({ timeout: 10_000 });

    // --- Activate. ---
    await domainCard.getByRole("button", { name: "Activate" }).click();
    await expect(domainCard.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Now resolves — proving the domain that went through the real UI-driven lifecycle actually
    // works against the real, security-critical resolution endpoint.
    const afterActivate = await request.get(`http://localhost:4000/api/v1/restaurants/by-domain/${hostname}`);
    expect(afterActivate.status()).toBe(200);
    const activeBody = await afterActivate.json();
    expect(activeBody.data.restaurant.slug).toBe("spice-route");

    // --- Deactivate. ---
    await domainCard.getByRole("button", { name: "Deactivate" }).click();
    await expect(domainCard.getByText("Verified — not live yet")).toBeVisible({ timeout: 10_000 });

    const afterDeactivate = await request.get(`http://localhost:4000/api/v1/restaurants/by-domain/${hostname}`);
    expect(afterDeactivate.status()).toBe(404);

    // --- Remove. ---
    await domainCard.getByRole("button", { name: "Remove" }).click();
    await expect(domainCard).toHaveCount(0, { timeout: 10_000 });

    // The platform's own URL keeps working throughout and after — never affected by any of this.
    await expect(page.getByText("Platform URL")).toBeVisible();
  });
});

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 64, Section 9 (Owner) — the full post-lapse recovery journey proven live in the browser:
 * active trial -> trial time genuinely passes -> account becomes lapsed -> a premium feature
 * (custom domains, Growth-only — see planCatalogSeed.service.ts) becomes unavailable -> the
 * Dashboard's new LapsedRecoveryBanner and BillingPage's restructured terminal-state UI both
 * appear -> the owner reaches the real plan picker/checkout flow (never a shortcut) -> a real
 * mock-checkout completion reactivates the subscription -> entitlements resolve live again -> the
 * previously-locked feature is available again -> pre-existing restaurant data survived the whole
 * cycle untouched -> exactly one LIVE subscription document exists afterward (no duplicate).
 *
 * Same documented exception as the other golden-path specs: the owner's invite token only ever
 * leaves the platform via a real outbound email, so it's read/written directly against Mongo here.
 * The trial's actual expiry is likewise seeded directly (status: "expired", trialEnd in the past) —
 * the same "seed what only real time passage / a background sweep job could otherwise produce"
 * convention agency-entitlement-inheritance.spec.ts already established for an agency's own
 * subscription expiring (subscriptionResolution.service.ts's own doc comment: runTrialExpirationSweep
 * is what eventually persists this in reality; entitlement DECISIONS are already correct in real
 * time regardless of that job's cadence, which is exactly what this test proves end-to-end).
 */
test.describe.serial("owner post-lapse experience and reactivation (Phase 64)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("trial expires -> lapsed UI + locked features -> real mock-checkout reactivation -> entitlements and data restored", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slug = `e2e-lapse-${stamp}`;
    const restaurantName = `E2E Lapse ${stamp}`;
    const ownerEmail = `e2e-lapse-owner-${stamp}@test.local`;
    const itemName = `Lapse Item ${stamp}`;
    const categoryName = `Lapse Category ${stamp}`;

    // --- Platform admin provisions the restaurant + owner invite. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Lapse Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );

    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("LapseOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Real restaurant data this test proves survives the whole lapse/reactivation cycle. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByPlaceholder("New category name").fill(categoryName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.locator("li", { hasText: categoryName })).toBeVisible();
    await page.getByRole("button", { name: "+ Add menu item" }).click();
    await page.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await page.getByPlaceholder("Base price").fill("15");
    await page.getByRole("main").getByRole("combobox").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Create item & continue" }).click();
    await expect(page.getByText("Customize this item")).toBeVisible();
    await page.getByRole("button", { name: "Back to menu" }).click();
    await expect(page.locator("li", { hasText: itemName })).toBeVisible();

    // --- 1. Active trial: start a no-card Growth trial (Growth includes custom_domains — Starter
    // does not, see planCatalogSeed.service.ts — so the locked/unlocked contrast below is a real
    // change, not incidental). ---
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Plan").selectOption({ value: "owner_growth" });
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- While trialing, the Growth-only feature is genuinely available (proves the later "locked"
    // state below is a real change, not a page that was always locked). ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Requires an active plan")).toHaveCount(0);

    // --- 2 & 3. The trial's time genuinely passes and the account becomes lapsed — seeded
    // directly (see file header), mirroring what runTrialExpirationSweep would eventually persist. ---
    const business = await db.collection("businesses").findOne({ slug });
    expect(business).not.toBeNull();
    const subDoc = await db.collection("subscriptions").findOne({ ownerType: "business", ownerId: business!._id });
    expect(subDoc).not.toBeNull();
    await db
      .collection("subscriptions")
      .updateOne({ _id: subDoc!._id }, { $set: { status: "expired", trialEnd: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

    // --- 4. Premium feature is unavailable. In-app navigation (not page.reload()) re-mounts the
    // entitlement fetch without racing AuthProvider's mount-time refresh under React StrictMode —
    // the same documented gotcha agency-entitlement-inheritance.spec.ts avoids the same way. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByText("Requires an active plan")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toHaveCount(0);

    // --- 5 & 6. Lapsed UI appears on the Dashboard, with the reactivate CTA (never "Upgrade" —
    // Section 10's dangerous-UX-mistake guard). ---
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByText("Your trial or subscription has ended")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Your restaurant and all your data are still here", { exact: false })).toBeVisible();

    // --- 7. Owner enters the existing subscription flow via the banner's own CTA. ---
    await page.getByRole("link", { name: "Choose a plan" }).click();
    await expect(page).toHaveURL(/\/billing$/, { timeout: 10_000 });
    await expect(page.getByText("Trial expired", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Ready to pick back up?")).toBeVisible();
    await expect(page.getByText("Choose a plan below to pick up where you left off.")).toBeVisible();

    // --- 8. A real mock-checkout completion — never a shortcut DB write. ---
    await page.getByLabel("Plan").selectOption({ value: "owner_growth" });
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page).toHaveURL(/\/mock-checkout\//, { timeout: 10_000 });
    await page.getByRole("button", { name: "Confirm mock payment" }).click();
    await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Back to billing" }).click();
    await expect(page).toHaveURL(/\/billing$/, { timeout: 10_000 });

    // --- 9 & 10. Subscription is active again, on the correct (Growth) plan/entitlements. ---
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Growth", { exact: false })).toBeVisible();

    // --- 11. The previously-locked feature is available again. ---
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Domain", exact: true }).click();
    await expect(page.getByPlaceholder("orders.yourrestaurant.com")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Requires an active plan")).toHaveCount(0);

    // --- 12. Restaurant data survived the whole cycle untouched. The item row itself echoes its
    // own category name in parentheses (MenuManagementPage.tsx), so a plain `hasText: categoryName`
    // locator also matches the item row — disambiguated here via the category row's own unique
    // "Rename" action. ---
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    const categoryRow = page.locator("li").filter({ hasText: categoryName }).filter({ has: page.getByRole("button", { name: "Rename" }) });
    await expect(categoryRow).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("li", { hasText: itemName })).toBeVisible();

    // --- 13. No duplicate subscription: exactly one LIVE subscription for this business, ever
    // (the expired trial document is retained as history — resubscribing correctly creates a new
    // document, same as any real re-subscription; what must never happen is two LIVE ones at once,
    // which the partial unique index also enforces at the DB level). ---
    const liveCount = await db.collection("subscriptions").countDocuments({
      ownerType: "business",
      ownerId: business!._id,
      status: { $in: ["trialing", "active", "past_due", "cancelling"] },
    });
    expect(liveCount).toBe(1);
  });
});

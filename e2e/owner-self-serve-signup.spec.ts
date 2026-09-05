import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 44 — proves the actual browser journey the End-to-End Launch Readiness Audit flagged as
 * broken: marketing's "Start Free Trial" CTA for a single restaurant now reaches a REAL self-serve
 * signup (OwnerSignupWizardPage, at /signup) instead of a lead-capture form that creates nothing.
 *
 * Marketing's own CTA wiring (every "Start Free Trial" link -> /start-trial -> the "Running a
 * single restaurant?" button -> ADMIN_SIGNUP_URL) is verified at the source level, not by driving
 * apps/marketing in this test — that app has no webServer entry in playwright.config.ts and isn't
 * part of this suite's runtime today; adding that would be new test infrastructure, which this
 * phase's brief says not to introduce. This test starts directly at /signup, exactly where that
 * CTA lands, and drives the entire rest of the real flow through the real UI: account creation,
 * email verification, business + first-restaurant creation, and starting the actual no-card trial
 * — the same sequence of real, unmodified backend endpoints the wizard calls.
 *
 * One deliberate, documented exception, same as staff-invite-accept.spec.ts and
 * restaurant-provisioning-golden-path.spec.ts: the email-verification link only ever leaves the
 * server via a real outbound email (ConsoleEmailProvider just logs it), so this test generates its
 * own token and writes its hash directly against the same MongoDB the dev API uses, then drives
 * the real /verify-email page with it — everything else, every click, goes through the real UI.
 *
 * Cross-tenant negative-path isolation (an owner can't reach ANOTHER tenant's data) is already
 * covered by multi-location-owner-journey.spec.ts, multi-location-staff-isolation.spec.ts, and
 * middleware/tenant.test.ts — not re-proven here. This test's own job is narrower and specific to
 * what was actually broken: that a brand-new self-serve owner lands in THEIR OWN correct business,
 * not a demo/seeded one, with a real trial.
 */
test.describe.serial("owner self-serve signup -> trial activation (Phase 44)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("Start Free Trial -> signup -> verify email -> create restaurant -> authenticated portal with the correct trial", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const ownerEmail = `e2e-owner-selfserve-${stamp}@test.local`;
    const restaurantName = `E2E Self-Serve Bistro ${stamp}`;
    const slug = `e2e-selfserve-${stamp}`;

    await page.goto("http://localhost:5174/signup");

    // --- Step 1: plan (defaults to the cheapest active OWNER plan, Owner — Starter) ---
    await expect(page.getByText("Owner — Starter")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Continue" }).click();

    // --- Step 2: create account ---
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByLabel("Full name").fill("E2E Self-Serve Owner");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill("SelfServeOwner123!");
    await page.getByRole("button", { name: "Continue" }).click();

    // --- Step 3: verify email — the real 403-on-unverified gate (business.controller.ts's
    // createBusinessSelfServe) must actually be showing here, not skipped. ---
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ownerEmail)).toBeVisible();

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const usersCollection = db.collection("users");
    const updateResult = await usersCollection.updateOne(
      { email: ownerEmail },
      { $set: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    expect(updateResult.matchedCount).toBe(1);

    await page.goto(`http://localhost:5174/verify-email?token=${rawToken}`);
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Continue setting up my restaurant" }).click();

    // --- Back in the wizard: resumed straight at "business", not re-shown plan/account/verify —
    // proves the step is re-derived from real account state, not just wizard-local memory. ---
    await expect(page.getByRole("heading", { name: "Tell us about your restaurant" })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Restaurant name").fill(restaurantName);
    const slugField = page.getByLabel("Web address");
    await expect(slugField).not.toHaveValue("");
    await slugField.fill(slug);
    await page.getByRole("button", { name: "Continue" }).click();

    // --- Review: correct plan/price/trial length, no payment ever requested ---
    await expect(page.getByRole("heading", { name: "Review & start your trial" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Owner — Starter")).toBeVisible();
    await expect(page.getByText("No card required until your trial ends")).toBeVisible();
    await expect(page.locator("input[type='text'], input[type='number'], input[name*='card' i]")).toHaveCount(0);
    await page.getByRole("button", { name: /Start \d+-day trial/ }).click();

    // --- Authenticated portal: the fresh, correct, pending restaurant's own readiness state ---
    await expect(page).toHaveURL("http://localhost:5174/", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\d+ of \d+ ready/)).toBeVisible();

    // --- Settings shows THIS restaurant, not any seeded/demo one — the tenant-isolation proof
    // this test is actually responsible for (see the file's doc comment for what's out of scope). ---
    await page.goto("http://localhost:5174/settings");
    await expect(page.getByLabel("Restaurant name")).toHaveValue(restaurantName, { timeout: 10_000 });

    // --- Correct subscription state, verified directly (no billing UI exists to read this from
    // yet outside BillingPage, which is a separate surface this phase doesn't touch). ---
    const business = await db.collection("businesses").findOne({ slug });
    expect(business).not.toBeNull();
    const subscription = await db.collection("subscriptions").findOne({ ownerType: "business", ownerId: business!._id });
    expect(subscription?.status).toBe("trialing");
    expect(subscription?.providerSubscriptionId).toBeFalsy();

    // --- Logout/login still works for the freshly created account ---
    await page.getByRole("button", { name: /log ?out/i }).click();
    await expect(page).toHaveURL("http://localhost:5174/login", { timeout: 10_000 });
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.locator('input[type="password"]').fill("SelfServeOwner123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to your restaurant" })).toBeVisible({ timeout: 10_000 });
  });
});

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 60 — the Phase 60 audit found ForgotPasswordPage.tsx/ResetPasswordPage.tsx and their real
 * backend (auth.controller.ts's requestPasswordReset/resetPassword — enumeration-safe, atomic
 * token consumption, revokeAllRefreshTokens on success) fully built and wired, but never driven by
 * an actual browser test. This proves the real journey a self-serve owner would use if locked out.
 *
 * Same documented exception as the other owner-journey specs in this suite: the reset link only
 * ever leaves the server via a real outbound email, so this test writes its own token hash
 * directly to the same MongoDB the dev API uses, then drives the real /reset-password page with
 * it — every click, form, and redirect goes through the real UI.
 */
test.describe.serial("owner password recovery (Phase 60)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("forgot password -> reset link -> new password -> old password rejected, new one works", async ({ page, request }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const ownerEmail = `e2e-recovery-owner-${stamp}@test.local`;

    // A real, already-onboarded owner account (registers directly against the API — this test's
    // job is recovery, not signup, which owner-self-serve-signup.spec.ts already covers).
    const registerRes = await request.post("http://localhost:4000/api/v1/auth/register", {
      data: { name: "E2E Recovery Owner", email: ownerEmail, password: "OriginalPass123!" },
    });
    expect(registerRes.ok()).toBeTruthy();

    // --- The enumeration-safe request step: identical UI response whether or not the email
    // actually exists (asserted against a real unregistered address too). ---
    await page.goto("http://localhost:5174/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    await page.locator('input[type="email"]').fill(`e2e-recovery-nonexistent-${stamp}@test.local`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("http://localhost:5174/forgot-password");
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible({ timeout: 10_000 });

    // --- The real token, written the same way the email would have carried it. ---
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const updateResult = await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );
    expect(updateResult.matchedCount).toBe(1);

    // --- A missing token shows the real "request a new one" guidance, not a crash. ---
    await page.goto("http://localhost:5174/reset-password");
    await expect(page.getByText("This reset link is missing its token")).toBeVisible();

    // --- The real reset, via the real link. ---
    await page.goto(`http://localhost:5174/reset-password?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("BrandNewPass456!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Password updated")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    // --- The same token can never be replayed (already consumed atomically). ---
    await page.goto(`http://localhost:5174/reset-password?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("AnotherAttempt789!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("alert")).toContainText(/invalid or has expired/i, { timeout: 10_000 });

    // --- Old password no longer works; the new one does. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill(ownerEmail);
    await page.locator('input[type="password"]').fill("OriginalPass123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);

    await page.locator('input[type="password"]').fill("BrandNewPass456!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });
  });
});

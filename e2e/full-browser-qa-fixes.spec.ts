import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the browser-only findings of the November 2026 full-browser QA audit
 * (docs/qa/full-browser-qa-fixes.md). The rest of the 14 fixes have unit tests next to their code.
 */

// Seeded dev-fixture passwords, read from the seed script rather than repeated here.
const seed = readFileSync(join(__dirname, "../apps/api/src/scripts/seed-demo-data.ts"), "utf8");
const seedPassword = (prefix: string) => seed.match(new RegExp(`bcrypt\\.hash\\("(${prefix}[^"]*)"`))![1];

async function adminSignIn(page: Page, email: string, password: string) {
  await page.goto("http://localhost:5174/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
}

test("QA-003: direct loads and refreshes never request /restaurants/null", async ({ page }) => {
  const nullRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/restaurants/null")) nullRequests.push(r.url());
  });
  await adminSignIn(page, "owner@demo-restaurant.local", seedPassword("Owner"));
  for (const path of ["/menu", "/settings", "/orders", "/customers"]) {
    await page.goto(`http://localhost:5174${path}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  }
  expect(nullRequests).toEqual([]);
});

test("QA-006: a platform admin opening the restaurant Support page lands on the platform queue", async ({ page }) => {
  await adminSignIn(page, "platform-admin@restaurant.local", seedPassword("Admin"));
  await page.goto("http://localhost:5174/support");
  await expect(page).toHaveURL(/\/platform\/support$/, { timeout: 10_000 });
  await page.goto("http://localhost:5174/support/abc123");
  await expect(page).toHaveURL(/\/platform\/support\/tickets\/abc123$/, { timeout: 10_000 });
});

test("NEW-2: a restaurant owner can't open the platform support queue", async ({ page }) => {
  await adminSignIn(page, "owner@demo-restaurant.local", seedPassword("Owner"));
  for (const path of ["/platform/support", "/platform/support/tickets/abc123"]) {
    await page.goto(`http://localhost:5174${path}`);
    await expect(page).not.toHaveURL(/\/platform\/support/, { timeout: 10_000 });
  }
  // Their own restaurant's support page still works.
  await page.goto("http://localhost:5174/support");
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("QA-007: a customer opening an order that isn't theirs gets a helpful message, not 'Forbidden'", async ({ page }) => {
  await page.goto("http://localhost:5173/login");
  await page.getByLabel("Email").fill("priya.patel@example.com");
  await page.getByLabel("Password").fill(seedPassword("Customer"));
  await page.getByRole("button", { name: /^(Log in|Sign in)$/ }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });

  await page.goto("http://localhost:5173/orders/6650a1b2c3d4e5f6a7b8c9d0");
  await expect(page.getByRole("heading", { name: "Order unavailable" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/couldn't find that order on your account/)).toBeVisible();
  await expect(page.getByText(/forbidden/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Go to My orders" }).click();
  await expect(page).toHaveURL(/\/orders$/);
});

test.describe("QA-014: phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the platform support table keeps a readable width inside its own scroll area", async ({ page }) => {
    await adminSignIn(page, "platform-admin@restaurant.local", seedPassword("Admin"));
    await page.goto("http://localhost:5174/platform/support");
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 15_000 });
    expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual(700);
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });

  test("the reset-password 'missing token' message is one sentence with a working link", async ({ page }) => {
    await page.goto("http://localhost:5174/reset-password");
    const alert = page.getByRole("alert").filter({ hasText: "missing its token" });
    expect(await alert.evaluate((el) => el.children.length)).toBe(1);
    await alert.getByRole("link", { name: "forgot password page" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});

// ---------------------------------------------------------------------------------------------
// Final release readiness (docs/qa/final-release-readiness.md)
// ---------------------------------------------------------------------------------------------

async function apiToken(request: import("@playwright/test").APIRequestContext, email: string, password: string) {
  const res = await request.post("http://localhost:4000/api/v1/auth/login", { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as { accessToken: string; user: { restaurantId: string } };
}

test("NEW-3: a staff role change is confirmed first, can be cancelled, and is recorded in the audit log", async ({ page, request }) => {
  const owner = await apiToken(request, "owner@demo-restaurant.local", seedPassword("Owner"));
  // A staff member of this test's own (an invited, not yet accepted account) — seeded staff stay untouched.
  const name = `E2E Role Change ${Date.now()}`;
  const invited = await request.post(`http://localhost:4000/api/v1/restaurants/${owner.user.restaurantId}/staff`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { name, email: `e2e-role-${Date.now()}@test.local`, role: "kitchen_staff" },
  });
  expect(invited.status()).toBe(201);

  await adminSignIn(page, "owner@demo-restaurant.local", seedPassword("Owner"));
  await page.goto("http://localhost:5174/staff");
  const role = page.getByLabel(`Role for ${name}`);
  await expect(role).toHaveValue("kitchen_staff", { timeout: 15_000 });

  // Cancel: nothing changes.
  const patches: string[] = [];
  page.on("request", (r) => r.method() === "PATCH" && r.url().includes("/staff/") && patches.push(r.url()));
  await role.selectOption("restaurant_staff");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(`Change ${name}'s role to Staff?`)).toBeVisible();
  await expect(dialog.getByText("Kitchen staff", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/permissions change as soon as you confirm/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(role).toHaveValue("kitchen_staff");
  expect(patches).toHaveLength(0);

  // Confirm (clicked twice quickly): exactly one save.
  await role.selectOption("restaurant_staff");
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: "Change role" });
  await confirm.click();
  await confirm.click({ timeout: 1_000 }).catch(() => {});
  await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 10_000 });
  await expect(role).toHaveValue("restaurant_staff");
  expect(patches).toHaveLength(1);

  await page.goto("http://localhost:5174/audit-log");
  await expect(page.getByRole("cell", { name: "Staff role changed" }).first()).toBeVisible({ timeout: 15_000 });
});

test("kitchen staff can't open the customer directory (page, nav or API) but keep the kitchen board", async ({ page, request }) => {
  const kitchen = await apiToken(request, "kitchen@demo-restaurant.local", seedPassword("Staff"));
  const api = await request.get(`http://localhost:4000/api/v1/restaurants/${kitchen.user.restaurantId}/customers`, {
    headers: { Authorization: `Bearer ${kitchen.accessToken}` },
  });
  expect(api.status()).toBe(403);

  await adminSignIn(page, "kitchen@demo-restaurant.local", seedPassword("Staff"));
  await expect(page.locator("aside nav").getByRole("link", { name: "Customers" })).toHaveCount(0);
  await page.goto("http://localhost:5174/customers");
  await expect(page).not.toHaveURL(/\/customers$/, { timeout: 10_000 });
  await page.goto("http://localhost:5174/kitchen");
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 10_000 });
});

test("QA-004: staff and kitchen pages never request plan entitlements", async ({ browser }) => {
  for (const [email, path] of [
    ["kitchen@demo-restaurant.local", "/kitchen"],
    ["staff@demo-restaurant.local", "/orders"],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const entitlementCalls: string[] = [];
    page.on("request", (r) => r.url().includes("/subscription/entitlements") && entitlementCalls.push(r.url()));
    await adminSignIn(page, email, seedPassword("Staff"));
    await page.goto(`http://localhost:5174${path}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    expect(entitlementCalls).toEqual([]);
    await context.close();
  }
});

test("NEW-1: two tabs restoring the session at the same moment both stay signed in", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await adminSignIn(first, "owner@demo-restaurant.local", seedPassword("Owner"));
  const second = await context.newPage();
  for (let round = 0; round < 3; round++) {
    // Both tabs reload together, so both restore the session (one refresh token) at once.
    await Promise.all([first.goto("http://localhost:5174/orders"), second.goto("http://localhost:5174/menu")]);
    await expect(first).toHaveURL(/\/orders$/, { timeout: 15_000 });
    await expect(second).toHaveURL(/\/menu$/, { timeout: 15_000 });
    await expect(first.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await expect(second.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  }
  await context.close();
});

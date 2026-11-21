import { expect, type Page } from "@playwright/test";

/**
 * Registers a brand-new storefront customer for one test and waits until the account and its
 * session really exist.
 *
 * Several specs used to share one customer (customer1@test.local): "sign in, or register it if it
 * doesn't exist yet", then navigate away straight after clicking "Create account". On a freshly
 * seeded database, parallel specs raced to register the same email (one got a 409), and the
 * immediate navigation could cancel the register request before its session cookie was set — so
 * the customer was later bounced to /login when placing an order (the intermittent 54/55 failure
 * in admin-audit-log). A unique account per test, and waiting for the response, removes both.
 */
export async function registerFreshCustomer(page: Page, name: string): Promise<string> {
  const email = `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto("http://localhost:5173/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Customer123!");
  const registered = page.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await registered).status()).toBe(201);
  await expect(page).not.toHaveURL(/\/register$/, { timeout: 10_000 });
  return email;
}

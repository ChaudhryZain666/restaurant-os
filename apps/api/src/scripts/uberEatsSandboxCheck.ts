import "dotenv/config";
import { createHmac } from "node:crypto";
import { UberEatsProvider } from "../marketplaceProviders/UberEatsProvider.js";
import { UBER_EATS_HOSTS } from "../marketplaceProviders/uberEatsHosts.js";

/**
 * Exercises GarnishTable's real Uber Eats Marketplace adapter against Uber's SANDBOX
 * (test-api.uber.com / sandbox-login.uber.com) with a TESTING application's credentials — the
 * evidence Uber asks for before granting production scopes. Needs no database and none of the app's
 * own configuration, and is hard-wired to the sandbox hosts: it cannot reach Uber's live API.
 *
 *   UBER_EATS_TEST_CLIENT_ID=… UBER_EATS_TEST_CLIENT_SECRET=… npm run -w apps/api uber-eats:sandbox-check
 *        → token (client_credentials) + list the test stores provisioned to the app
 *
 *   … UBER_EATS_TEST_STORE_ID=… npm run -w apps/api uber-eats:sandbox-check -- --menu
 *        → + upload a two-item test menu, suspend one item, then un-suspend it
 *
 *   … npm run -w apps/api uber-eats:sandbox-check -- --order <order_id> [--accept | --deny]
 *        → + read a sandbox order's details, then optionally accept or deny it
 *
 * Use the TESTING app's credentials from the Uber Developer Dashboard, set in your own terminal or
 * in apps/api/.env (gitignored, loaded automatically). The script never prints them or the access token. Every step prints PASS or
 * FAIL with the reason — paste that output into the reply to Uber.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (use your Uber Eats TESTING app's credentials).`);
  return value;
}

function argAfter(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let failures = 0;
async function step(label: string, run: () => Promise<string | void>) {
  process.stdout.write(`${label}… `);
  try {
    const detail = await run();
    console.log(`PASS${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures++;
    const code = (err as { code?: string }).code;
    console.log(`FAIL — ${(err as Error).message}${code ? ` [${code}]` : ""}`);
  }
}

async function main() {
  const clientSecret = required("UBER_EATS_TEST_CLIENT_SECRET");
  const uber = new UberEatsProvider(required("UBER_EATS_TEST_CLIENT_ID"), clientSecret, UBER_EATS_HOSTS.sandbox);
  const storeId = process.env.UBER_EATS_TEST_STORE_ID?.trim();
  const orderId = argAfter("--order");
  console.log(`Uber Eats sandbox check — ${UBER_EATS_HOSTS.sandbox.apiBaseUrl} (auth ${UBER_EATS_HOSTS.sandbox.authBaseUrl})\n`);

  await step("1. OAuth token — client_credentials, scope eats.store eats.order", async () => {
    if (!(await uber.healthCheck())) throw new Error("token request refused — check the TESTING app's Client ID/Secret and that Eats Marketplace scopes are enabled");
  });

  await step("2. GET /v1/eats/stores — test stores provisioned to this app", async () => {
    const stores = await uber.listStores();
    if (stores.length === 0) return "0 stores (ask Uber Integration Support to provision a sandbox test store)";
    return `${stores.length} store(s): ${stores.map((s) => s.storeId).join(", ")}`;
  });

  if (storeId) {
    await step("2b. GET /v1/eats/stores/{store_id}/pos_data — Integration Configuration (read-only)", async () => {
      const store = await uber.getStoreIntegration(storeId);
      if (!store.integrationEnabled) throw new Error("integration is switched off for this store");
      if (!store.isOrderManager) throw new Error("this app is not the store's order manager");
      return `integration enabled, order manager = this app, online status ${store.onlineStatus ?? "unknown"}, integrator_store_id ${store.integratorStoreId ? "set" : "not set"}`;
    });
  }

  if (process.argv.includes("--menu")) {
    if (!storeId) throw new Error("--menu needs UBER_EATS_TEST_STORE_ID (a sandbox test store id from step 2).");
    await step("3. PUT /v2/eats/stores/{store_id}/menus — upload a test menu", async () => {
      await uber.pushMenu({
        externalStoreId: storeId,
        categories: [{ internalId: "gt-sandbox-category", name: "GarnishTable Sandbox", sortOrder: 0 }],
        items: [
          { internalId: "gt-sandbox-item-1", name: "Sandbox Burger", description: "Test item", priceCents: 1000, currency: "USD", isAvailable: true, categoryExternalId: "", categoryInternalId: "gt-sandbox-category" },
          { internalId: "gt-sandbox-item-2", name: "Sandbox Fries", priceCents: 400, currency: "USD", isAvailable: true, categoryExternalId: "", categoryInternalId: "gt-sandbox-category" },
        ],
        serviceHours: [],
      });
      return "204";
    });
    await step("4. POST /v2/eats/stores/{store_id}/menus/items/{item_id} — suspend an item", async () => {
      await uber.updateItemAvailability(storeId, "gt-sandbox-item-2", false);
    });
    await step("5. POST /v2/eats/stores/{store_id}/menus/items/{item_id} — un-suspend it", async () => {
      await uber.updateItemAvailability(storeId, "gt-sandbox-item-2", true);
    });
  }

  if (orderId) {
    if (!storeId) throw new Error("--order needs UBER_EATS_TEST_STORE_ID (the order must belong to that test store).");
    await step("6. GET /v2/eats/order/{order_id} — order details", async () => {
      const order = await uber.fetchOrder(storeId, orderId);
      return `${order.externalStatus}, ${order.items.length} item(s), total ${order.totalCents} ${order.currency}`;
    });
    if (process.argv.includes("--accept")) {
      await step("7. POST /v1/eats/orders/{order_id}/accept_pos_order", () => uber.acceptOrder(storeId, orderId));
    } else if (process.argv.includes("--deny")) {
      await step("7. POST /v1/eats/orders/{order_id}/deny_pos_order", () => uber.denyOrder(storeId, orderId, "GarnishTable sandbox test"));
    }
  }

  await step("Local: X-Uber-Signature verification (HMAC-SHA256 with the client secret, no network)", async () => {
    const body = Buffer.from(JSON.stringify({ event_id: "sandbox-check", event_type: "orders.notification", meta: { resource_id: "o", user_id: "s" } }));
    const event = uber.verifyWebhookSignature(body, createHmac("sha256", clientSecret).update(body).digest("hex"));
    if (!event || event.externalStoreId !== "s" || event.externalOrderId !== "o") throw new Error("signature verification failed");
  });

  console.log(failures === 0 ? "\nAll steps passed." : `\n${failures} step(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`Sandbox check aborted: ${(err as Error).message}`);
  process.exitCode = 1;
});

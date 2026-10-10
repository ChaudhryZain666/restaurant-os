import { UberDirectProvider } from "../deliveryProviders/UberDirectProvider.js";
import type { DeliveryContact } from "../deliveryProviders/DeliveryProvider.js";

/**
 * Phase 89 — exercises GarnishTable's real Uber Direct adapter against an Uber Direct TEST-MODE
 * account, so the integration can be proven without a real courier. Needs no database and none of
 * the app's own configuration.
 *
 *   UBER_DIRECT_TEST_CLIENT_ID=… UBER_DIRECT_TEST_CLIENT_SECRET=… UBER_DIRECT_TEST_CUSTOMER_ID=… \
 *     npm run -w apps/api uber:sandbox-check                      # auth + quote only
 *
 *   … UBER_DIRECT_TEST_MODE_CONFIRMED=yes npm run -w apps/api uber:sandbox-check -- --create-test-delivery
 *                                                               # + robo-courier delivery, read back, cancelled
 *
 * Use the TEST-mode credentials from the Uber Direct dashboard (Developer, test mode on), set in your
 * own terminal or a local untracked env file — never pasted anywhere else. The script never prints
 * them. Creating a delivery additionally requires UBER_DIRECT_TEST_MODE_CONFIRMED=yes; if Uber
 * nevertheless reports the delivery as live (live_mode: true), it is cancelled immediately and the
 * script fails, so a live account can't be left with a booked courier by this check.
 */
const PICKUP: DeliveryContact = {
  // Uber's own example addresses (uber/uber-direct-sdk integration test) — inside its test coverage.
  name: "GarnishTable sandbox check (pickup)",
  phone: "+14155551212",
  address: "425 Market St, San Francisco, CA 94105, US",
  addressParts: { street: ["425 Market St"], city: "San Francisco", state: "CA", postalCode: "94105", country: "US" },
  latitude: 37.7909,
  longitude: -122.3989,
};
const DROPOFF: DeliveryContact = {
  name: "GarnishTable sandbox check (dropoff)",
  phone: "+14155551212",
  address: "201 3rd St, San Francisco, CA 94103, US",
  addressParts: { street: ["201 3rd St"], city: "San Francisco", state: "CA", postalCode: "94103", country: "US" },
  latitude: 37.7855,
  longitude: -122.4005,
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (use your Uber Direct TEST-mode credentials).`);
  return value;
}

async function main() {
  const createDelivery = process.argv.includes("--create-test-delivery");
  if (createDelivery && process.env.UBER_DIRECT_TEST_MODE_CONFIRMED !== "yes") {
    throw new Error("--create-test-delivery needs UBER_DIRECT_TEST_MODE_CONFIRMED=yes (confirming these are TEST-mode credentials).");
  }
  const uber = new UberDirectProvider(
    required("UBER_DIRECT_TEST_CLIENT_ID"),
    required("UBER_DIRECT_TEST_CLIENT_SECRET"),
    required("UBER_DIRECT_TEST_CUSTOMER_ID"),
    "",
    { testRoboCourier: true }
  );

  console.log("1. OAuth token (client credentials)…");
  if (!(await uber.healthCheck())) throw new Error("Authentication failed — check the test-mode Client ID / Client Secret.");
  console.log("   PASS");

  console.log("2. Delivery quote (structured addresses, coordinates, phones)…");
  const quote = await uber.getQuote({ pickup: PICKUP, dropoff: DROPOFF, currency: "USD" });
  console.log(`   PASS — quote ${quote.quoteId}, fee ${quote.fee} ${quote.currency}, ~${quote.estimatedDurationMinutes ?? "?"} min`);

  if (!createDelivery) {
    console.log("Done (quote only). Add --create-test-delivery to also run a robo-courier test delivery.");
    return;
  }

  console.log("3. Test delivery with Uber's robo courier (idempotency_key, quote_id)…");
  const created = await uber.createDelivery({
    orderId: `sandbox-check-${Date.now()}`,
    restaurantId: "sandbox-check",
    quoteId: quote.quoteId,
    pickup: PICKUP,
    dropoff: DROPOFF,
    manifestItems: [{ name: "Sandbox check item", quantity: 1 }],
    idempotencyKey: `sandbox_check_${Date.now()}`,
  });
  const liveMode = (created.raw as { live_mode?: boolean })?.live_mode;
  if (liveMode !== false) {
    await uber.cancelDelivery(created.providerDeliveryId);
    throw new Error(`Uber reported live_mode=${String(liveMode)} — the delivery was cancelled immediately. Use TEST-mode credentials.`);
  }
  console.log(`   PASS — ${created.providerDeliveryId}, status ${created.status}, tracking ${created.trackingUrl ?? "(none)"}`);

  console.log("4. Read it back…");
  const snapshot = await uber.getDelivery(created.providerDeliveryId);
  console.log(`   PASS — status ${snapshot.status}`);

  console.log("5. Cancel (no request body, as Uber documents)…");
  await uber.cancelDelivery(created.providerDeliveryId);
  const after = await uber.getDelivery(created.providerDeliveryId);
  console.log(`   ${after.status === "cancelled" ? "PASS" : "CHECK"} — status now ${after.status}`);
  console.log("Done. Webhooks are not covered here: register the webhook URL in the dashboard and use a test-mode delivery to see them arrive.");
}

main().catch((err) => {
  console.error(`FAIL — ${(err as Error).message}`);
  process.exit(1);
});

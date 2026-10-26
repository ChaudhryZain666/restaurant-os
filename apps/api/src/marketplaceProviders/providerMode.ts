import type { MarketplaceProviderName } from "@restaurant/types";
import { env } from "../config/env.js";

/**
 * Which driver a marketplace provider runs on. MARKETPLACE_PROVIDER_MODE is the deployment-wide
 * default; UBER_EATS_PROVIDER_MODE overrides it for Uber Eats alone, so Uber's sandbox webhooks can
 * be verified with the real adapter while DoorDash and foodpanda keep whatever the global mode says
 * (in production: mock, whose webhooks are refused).
 */
export function marketplaceModeFor(provider: MarketplaceProviderName): "mock" | "live" {
  if (provider === "uber_eats" && env.UBER_EATS_PROVIDER_MODE) return env.UBER_EATS_PROVIDER_MODE;
  return env.MARKETPLACE_PROVIDER_MODE;
}

/**
 * A production deployment whose live Uber Eats adapter points at Uber's SANDBOX is there to pass
 * Uber's validation (webhooks, test stores), not to connect real restaurants: an owner would be sent
 * to Uber's sandbox login and could never complete it. While this is true, Uber Eats offers no
 * connect option and every step of its connect flow is refused.
 */
export function uberEatsConnectionsClosed(): boolean {
  return env.NODE_ENV === "production" && marketplaceModeFor("uber_eats") === "live" && env.UBER_EATS_ENVIRONMENT === "sandbox";
}

export const UBER_EATS_CONNECTIONS_CLOSED_MESSAGE = "Uber Eats connections aren't open on GarnishTable yet.";

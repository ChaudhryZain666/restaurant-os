import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import type { DnsVerifier } from "./DnsVerifier.js";
import { MockDnsVerifier } from "./MockDnsVerifier.js";
import { NodeDnsVerifier } from "./NodeDnsVerifier.js";

let instance: DnsVerifier | null = null;

/**
 * Lazy-singleton getter, mirroring payments/index.ts and services/geocoding/index.ts. "mock" is
 * the schema DEFAULT regardless of environment (env.ts has no NODE_ENV-conditional logic for this
 * field) — real DNS TXT propagation can't be exercised against arbitrary hostnames in local
 * dev/CI, so DNS_VERIFIER=node is the only setting that should ever be selected in a real
 * deployment with real domains to verify.
 *
 * Phase 83 hardening — unlike a misconfigured payment/storage provider, a forgotten
 * DNS_VERIFIER=node in production doesn't fail loudly: MockDnsVerifier reads from the
 * MockDnsRecord collection (seeded directly via Mongo, the same documented test-only exception
 * this codebase already uses for reading invite tokens in e2e tests) and would report a custom
 * domain "verified" without ever checking whether the claiming restaurant/agency actually controls
 * that domain's real DNS — a genuine domain-ownership-verification bypass, not just wrong display
 * data.
 */
export function shouldWarnAboutMockDnsVerifierInProduction(nodeEnv: string, mode: string): boolean {
  return nodeEnv === "production" && mode === "mock";
}

export function getDnsVerifier(): DnsVerifier {
  if (instance) return instance;
  if (shouldWarnAboutMockDnsVerifierInProduction(env.NODE_ENV, env.DNS_VERIFIER)) {
    logger.warn(
      "[dns] Running the MOCK DNS verifier in production — custom-domain ownership will never be genuinely checked; every claim will report as verified. Set DNS_VERIFIER=node unless white-label custom domains are deliberately not offered."
    );
  }
  instance = env.DNS_VERIFIER === "node" ? new NodeDnsVerifier() : new MockDnsVerifier();
  return instance;
}

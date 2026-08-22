import { env } from "../config/env.js";
import type { DnsVerifier } from "./DnsVerifier.js";
import { MockDnsVerifier } from "./MockDnsVerifier.js";
import { NodeDnsVerifier } from "./NodeDnsVerifier.js";

let instance: DnsVerifier | null = null;

/**
 * Lazy-singleton getter, mirroring payments/index.ts and services/geocoding/index.ts. "mock" is
 * the default outside production (env.ts) — real DNS TXT propagation can't be exercised against
 * arbitrary hostnames in local dev/CI, so DNS_VERIFIER=node is the only setting that should ever be
 * selected in a real deployment with real domains to verify.
 */
export function getDnsVerifier(): DnsVerifier {
  if (instance) return instance;
  instance = env.DNS_VERIFIER === "node" ? new NodeDnsVerifier() : new MockDnsVerifier();
  return instance;
}

import { MockDnsRecord } from "../models/MockDnsRecord.js";
import type { DnsVerifier } from "./DnsVerifier.js";

/**
 * Reads simulated DNS TXT records from the MockDnsRecord collection, seeded directly via Mongo by
 * tests/dev tooling — see MockDnsRecord.ts's header comment for why this is a real, precedented
 * exception in this codebase rather than a shortcut. A hostname with no seeded row behaves exactly
 * like real DNS with no TXT record at all: an empty array, not an error.
 */
export class MockDnsVerifier implements DnsVerifier {
  async resolveTxt(hostname: string): Promise<string[]> {
    const record = await MockDnsRecord.findOne({ hostname: hostname.toLowerCase() });
    return record?.txtValues ?? [];
  }
}

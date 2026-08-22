import { promises as dns } from "node:dns";
import type { DnsVerifier } from "./DnsVerifier.js";

const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Real DNS TXT lookup via Node's built-in resolver. `dns.promises.resolveTxt` has no native
 * per-call timeout, so a manual race against a timer keeps a slow/unresponsive resolver from
 * hanging the synchronous "check verification" request indefinitely (see domain.controller.ts —
 * this is a request/response call, not a background job, so it must return in bounded time).
 * `resolveTxt` returns `string[][]` (each TXT record can itself be split into multiple strings by
 * the DNS protocol) — flattened and joined here since a verification value is never intentionally
 * split across chunks.
 */
export class NodeDnsVerifier implements DnsVerifier {
  async resolveTxt(hostname: string): Promise<string[]> {
    try {
      const records = await Promise.race([
        dns.resolveTxt(hostname),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), LOOKUP_TIMEOUT_MS)),
      ]);
      return records.map((chunks) => chunks.join(""));
    } catch {
      // NXDOMAIN, ENODATA, timeout, or any other resolver failure — all mean "not verified yet"
      // from the caller's perspective, never a thrown error.
      return [];
    }
  }
}

/**
 * Phase 22 — provider-agnostic DNS lookup, mirroring PaymentProvider/StorageService's shape in
 * this codebase: a small interface, a real implementation, and a controllable mock. `resolveTxt`
 * never throws for "not found" cases (NXDOMAIN, no TXT records, timeout) — it resolves to `[]`,
 * since "the record isn't there (yet)" is an expected, routine outcome during verification, not an
 * error condition callers need to specially catch.
 */
export interface DnsVerifier {
  resolveTxt(hostname: string): Promise<string[]>;
}

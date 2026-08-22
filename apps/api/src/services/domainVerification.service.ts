import { randomBytes } from "node:crypto";
import { getDnsVerifier } from "../dns/index.js";

// A DNS TXT verification value is not a bearer credential the way an invite/reset token is (see
// secureToken.service.ts's header comment for that reasoning) — the owner must be shown this exact
// value to publish in DNS, and the platform re-compares it against live DNS lookups repeatedly, so
// it's generated directly here (still randomBytes(32), for the same unpredictability guarantee)
// rather than reusing generateSecureToken()'s hash-only-persisted shape.
export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

const VERIFICATION_TXT_PREFIX = "_tablecloth-verify";

export function verificationRecordHost(hostname: string): string {
  return `${VERIFICATION_TXT_PREFIX}.${hostname}`;
}

/** Idempotent — safe to call any number of times, never activates anything itself. */
export async function checkDomainVerification(hostname: string, expectedToken: string): Promise<boolean> {
  const values = await getDnsVerifier().resolveTxt(verificationRecordHost(hostname));
  return values.includes(expectedToken);
}

/**
 * A normalized hostname that exactly matches the platform's own configured origin can't be claimed
 * as a custom domain — otherwise a business could "verify" the platform's own domain against
 * itself. Takes `platformHostname` as an explicit parameter (rather than reading env internally)
 * so the comparison itself stays a trivial, directly-testable pure function independent of
 * whatever CLIENT_ORIGIN happens to be configured in a given environment.
 */
export function isSelfClaim(hostname: string, platformHostname: string): boolean {
  return hostname === platformHostname;
}

import { randomBytes, createHash } from "node:crypto";

/**
 * Shared by password-reset and staff-invite tokens: only the SHA-256 hash is ever persisted, so a
 * database read (backup leak, injection, etc.) never yields a usable token — the same principle
 * refresh tokens already follow (Redis stores an opaque marker, not the JWT itself). The raw token
 * is returned once, to be put in an email link, and never stored anywhere. Both flows look a user
 * up BY hash (there's no single known hash to compare a candidate against, since the token itself
 * identifies the user), so this is a DB-indexed equality lookup rather than a secret comparison —
 * unlike a password check, there's no timing side-channel to defend against a 256-bit random value.
 */
export function generateSecureToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

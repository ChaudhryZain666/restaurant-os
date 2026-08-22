import { randomBytes } from "node:crypto";

/**
 * A plain opaque identifier, not a cryptographic secret proven-once-and-discarded — see
 * models/Table.ts's doc-comment for why this is stored raw rather than hashed. 16 random bytes
 * (32 hex chars) is already far beyond guessable, and hex keeps the QR-encoded URL simple to
 * read/debug without base64url's +/= edge cases in a URL path segment.
 */
export function generateTableToken(): string {
  return randomBytes(16).toString("hex");
}

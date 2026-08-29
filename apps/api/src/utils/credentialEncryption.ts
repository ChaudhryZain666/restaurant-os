import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const CURRENT_KEY_VERSION = 1;

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * Restaurant-owned payment-provider credentials (BYOC — see restaurantProvider.ts) are the most
 * sensitive thing this platform stores: a leaked one means real money movement on someone else's
 * account, not just a compromised session. AES-256-GCM (not CBC) specifically because it's
 * authenticated — a corrupted or tampered blob fails loudly via the auth tag at decrypt time,
 * rather than silently producing garbage that then fails confusingly deep inside a provider API
 * call with a misleading error.
 *
 * Key rotation is explicitly out of scope this phase — `keyVersion` is stored per-blob for forward
 * compatibility only, no re-encryption tooling exists. Rotating `CREDENTIAL_ENCRYPTION_KEY` without
 * a migration permanently bricks every already-stored credential.
 */
function resolveKey(): Buffer {
  if (!env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to encrypt or decrypt restaurant payment credentials.");
  }
  const key = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}).`);
  }
  return key;
}

export function encryptCredentials(plaintext: object): EncryptedBlob {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf-8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptCredentials<T>(blob: EncryptedBlob): T {
  const key = resolveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as T;
}

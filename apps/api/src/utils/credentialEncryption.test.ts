import { describe, expect, it } from "@jest/globals";
import { decryptCredentials, encryptCredentials } from "./credentialEncryption.js";

describe("credentialEncryption", () => {
  it("round-trips arbitrary JSON-shaped credentials", () => {
    const original = { secretKey: "sk_test_abc123", webhookSecret: "whsec_xyz789" };
    const blob = encryptCredentials(original);
    expect(decryptCredentials(blob)).toEqual(original);
  });

  it("uses a fresh random iv per call, so identical plaintexts produce different ciphertext", () => {
    const plaintext = { secretKey: "sk_test_same" };
    const a = encryptCredentials(plaintext);
    const b = encryptCredentials(plaintext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptCredentials(a)).toEqual(plaintext);
    expect(decryptCredentials(b)).toEqual(plaintext);
  });

  it("fails loudly (never silently) when the ciphertext has been tampered with", () => {
    const blob = encryptCredentials({ secretKey: "sk_test_abc123" });
    const tampered = { ...blob, ciphertext: Buffer.from("not the real ciphertext").toString("base64") };
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it("fails loudly when the auth tag has been tampered with", () => {
    const blob = encryptCredentials({ secretKey: "sk_test_abc123" });
    const tampered = { ...blob, authTag: Buffer.from(blob.authTag, "base64").fill(0).toString("base64") };
    expect(() => decryptCredentials(tampered)).toThrow();
  });
});

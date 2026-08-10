import { describe, expect, it } from "@jest/globals";
import { parseTtlSeconds } from "./ttl.js";

describe("parseTtlSeconds", () => {
  it("parses seconds, minutes, hours, and days", () => {
    expect(parseTtlSeconds("45s")).toBe(45);
    expect(parseTtlSeconds("15m")).toBe(15 * 60);
    expect(parseTtlSeconds("2h")).toBe(2 * 60 * 60);
    expect(parseTtlSeconds("30d")).toBe(30 * 60 * 60 * 24);
  });

  it("rejects an unrecognized format", () => {
    expect(() => parseTtlSeconds("15")).toThrow(/Invalid TTL format/);
    expect(() => parseTtlSeconds("15 minutes")).toThrow(/Invalid TTL format/);
  });
});

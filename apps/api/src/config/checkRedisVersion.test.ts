import {
  assertRedisVersionForProduction,
  isVersionAtLeast,
  BULLMQ_MINIMUM_REDIS_VERSION,
  BULLMQ_RECOMMENDED_REDIS_VERSION,
} from "./checkRedisVersion.js";

describe("isVersionAtLeast", () => {
  it.each([
    ["5.0.0", "5.0.0", true],
    ["6.2.0", "5.0.0", true],
    ["7.2.4", "6.2.0", true],
    ["3.0.504", "5.0.0", false],
    ["4.9.9", "5.0.0", false],
    ["5.0.0", "5.0.1", false],
    ["5.0.1", "5.0.0", true],
    ["5", "5.0.0", true], // short version strings, defaulting missing segments to 0
    ["5.0.0.1", "5.0.0", true], // an extra segment doesn't break comparison
  ])("isVersionAtLeast(%s, %s) === %s", (version, minimum, expected) => {
    expect(isVersionAtLeast(version, minimum)).toBe(expected);
  });
});

describe("assertRedisVersionForProduction", () => {
  function fakeClient(version: string | null) {
    return {
      info: jest.fn().mockResolvedValue(version === null ? "" : `# Server\r\nredis_version:${version}\r\nredis_mode:standalone\r\n`),
    };
  }

  it("does nothing outside production, even against an incompatible version", async () => {
    const client = fakeClient("3.0.504");
    await expect(assertRedisVersionForProduction(client, "development")).resolves.toBeUndefined();
    await expect(assertRedisVersionForProduction(client, "test")).resolves.toBeUndefined();
    expect(client.info).not.toHaveBeenCalled();
  });

  it("refuses to start in production against a Redis below BullMQ's hard minimum (regression: this dev machine's own default Redis is 3.0.504)", async () => {
    const client = fakeClient("3.0.504");
    await expect(assertRedisVersionForProduction(client, "production")).rejects.toThrow(/Incompatible Redis version for production/);
  });

  it("starts cleanly in production against a Redis meeting the hard minimum", async () => {
    const client = fakeClient(BULLMQ_MINIMUM_REDIS_VERSION);
    await expect(assertRedisVersionForProduction(client, "production")).resolves.toBeUndefined();
  });

  it("starts cleanly (no throw) in production against a Redis meeting the recommended minimum", async () => {
    const client = fakeClient(BULLMQ_RECOMMENDED_REDIS_VERSION);
    await expect(assertRedisVersionForProduction(client, "production")).resolves.toBeUndefined();
  });

  it("refuses to start in production if the Redis version can't be determined at all", async () => {
    const client = fakeClient(null);
    await expect(assertRedisVersionForProduction(client, "production")).rejects.toThrow(/Could not determine Redis server version/);
  });

  it("refuses to start in production if the INFO command itself fails", async () => {
    const client = { info: jest.fn().mockRejectedValue(new Error("connection refused")) };
    await expect(assertRedisVersionForProduction(client, "production")).rejects.toThrow(/Could not determine Redis server version/);
  });
});

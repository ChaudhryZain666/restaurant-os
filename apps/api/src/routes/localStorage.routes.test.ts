import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { LocalDiskStorageService, getLocalDiskStorageRoot, isLocalDiskStorageActive } from "../storage/index.js";

/** Phase 81 closeout audit — the local-storage GET route had zero test coverage. This is the
 *  actual HTTP-reachable boundary a real attacker would hit: req.params.key is raw, unauthenticated
 *  user input passed straight into LocalDiskStorageService.download(); its path-traversal guard is
 *  unit-tested directly in LocalDiskStorageService.test.ts, this file proves the route wires it up
 *  correctly end-to-end and never serves anything outside the storage root. */
describe("GET /local-storage/:key", () => {
  const app = createApp();
  const storage = new LocalDiskStorageService({ baseDir: getLocalDiskStorageRoot(), publicBaseUrl: "" });
  const seededKeys: string[] = [];

  beforeAll(() => {
    // If this ever stops being true (e.g. real S3 credentials get added to this dev/test
    // environment), the route won't be mounted at all and every assertion below would need
    // rewriting against a 404-from-notFoundHandler instead — fail loud rather than silently
    // testing nothing.
    if (!isLocalDiskStorageActive()) throw new Error("Expected local-disk storage to be active in this test environment.");
  });

  afterEach(async () => {
    await Promise.all(seededKeys.splice(0).map((k) => storage.delete(k)));
  });

  afterAll(async () => {
    await Promise.all(seededKeys.map((k) => storage.delete(k)));
  });

  it("serves a real uploaded file with its stored content-type", async () => {
    const key = "restaurants/route-test/menu-imports/job1/source/1-menu.pdf";
    seededKeys.push(key);
    await storage.upload(key, Buffer.from("real pdf bytes"), "application/pdf");

    const res = await request(app).get(`/local-storage/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    // superagent only populates res.text for recognized text-family content types — application/pdf
    // is buffered into res.body (a raw Buffer) instead, same as a real browser/PDF client would see.
    expect(Buffer.from(res.body).toString()).toBe("real pdf bytes");
  });

  it("returns 404, not a server error, for a key that was never uploaded", async () => {
    const res = await request(app).get("/local-storage/restaurants/route-test/menu-imports/does-not-exist/source/1-x.pdf");
    expect(res.status).toBe(404);
  });

  it("never serves content from outside the storage root via a traversal-encoded URL", async () => {
    // Express decodes %2e%2e/%2f before route matching, so this reaches the handler as a literal
    // "../" segment — exactly what the path-traversal guard must reject.
    const res = await request(app).get("/local-storage/..%2f..%2f..%2fpackage.json");
    expect(res.status).toBe(404); // rejected by the guard -> download() throws -> mapped to 404, never the real file's contents
    expect(res.text).not.toContain('"name"'); // package.json's own content, if it had leaked through
  });

  it("never serves content from outside the storage root via a literal nested ../ segment", async () => {
    const res = await request(app).get("/local-storage/restaurants/../../../../package.json");
    expect(res.status).toBe(404);
  });
});

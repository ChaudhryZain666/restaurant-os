import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDiskStorageService } from "./LocalDiskStorageService.js";

/** Phase 81 closeout audit — this file previously had zero coverage despite being the actual
 *  enforcement point for the path-traversal guard local-storage.routes.ts's HTTP GET depends on
 *  (that route passes a raw, attacker-controlled URL param straight into download()). */
describe("LocalDiskStorageService", () => {
  let baseDir: string;
  let storage: LocalDiskStorageService;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "gt-local-storage-test-"));
    storage = new LocalDiskStorageService({ baseDir, publicBaseUrl: "http://localhost:4000/local-storage" });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("round-trips a real upload/download, including nested keys", async () => {
    const key = "restaurants/abc123/menu-imports/job1/source/1-menu.pdf";
    await storage.upload(key, Buffer.from("real pdf bytes"), "application/pdf");
    const downloaded = await storage.download(key);
    expect(downloaded.toString()).toBe("real pdf bytes");
    expect(await storage.readContentType(key)).toBe("application/pdf");
  });

  it("delete removes both the data file and its content-type sidecar", async () => {
    const key = "restaurants/abc/menu-imports/job2/source/1-a.jpg";
    await storage.upload(key, Buffer.from("x"), "image/jpeg");
    await storage.delete(key);
    await expect(storage.download(key)).rejects.toThrow();
    // A deleted file's content-type sidecar is gone too — readContentType falls back cleanly
    // rather than resurrecting stale metadata for a key that no longer has real data.
    expect(await storage.readContentType(key)).toBe("application/octet-stream");
  });

  describe("path-traversal rejection (the real security boundary for the HTTP GET route, which passes a raw URL param straight into download())", () => {
    const traversalKeys = [
      "../outside.txt",
      "../../etc/passwd",
      "restaurants/../../outside.txt",
      "a/b/../../../outside.txt",
    ];

    it.each(traversalKeys)("upload rejects %s", async (key) => {
      await expect(storage.upload(key, Buffer.from("malicious"))).rejects.toThrow(/outside the local storage root/);
    });

    it.each(traversalKeys)("download rejects %s", async (key) => {
      await expect(storage.download(key)).rejects.toThrow(/outside the local storage root/);
    });

    it.each(traversalKeys)("delete rejects %s", async (key) => {
      await expect(storage.delete(key)).rejects.toThrow(/outside the local storage root/);
    });

    it("a traversal attempt never actually writes outside baseDir, even though it throws", async () => {
      const outsideMarker = join(baseDir, "..", "gt-traversal-marker.txt");
      await expect(storage.upload("../gt-traversal-marker.txt", Buffer.from("escaped"))).rejects.toThrow();
      await expect(readFile(outsideMarker)).rejects.toThrow(); // never created
    });
  });

  it("keys with normal, non-traversal relative segments still work (not overly strict)", async () => {
    // A legitimate key with a `.` in a filename (e.g. "1.5-menu.pdf") must not be misidentified as
    // an escape attempt.
    const key = "restaurants/abc/menu-imports/job3/source/1-my.menu.v2.pdf";
    await storage.upload(key, Buffer.from("ok"));
    await expect(storage.download(key)).resolves.toEqual(Buffer.from("ok"));
  });
});

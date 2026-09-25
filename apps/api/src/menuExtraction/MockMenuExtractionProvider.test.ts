import { MockMenuExtractionProvider } from "./MockMenuExtractionProvider.js";

describe("MockMenuExtractionProvider", () => {
  const provider = new MockMenuExtractionProvider();

  it("returns rows for a pdf input", async () => {
    const result = await provider.extract({ kind: "pdf", buffer: Buffer.from("fake pdf"), fileName: "menu.pdf" });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.modelUsed).toBe("mock-extraction-v1");
  });

  it("returns rows for an html input", async () => {
    const result = await provider.extract({ kind: "html", html: "<html></html>", sourceUrl: "https://example.com" });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("preserves multi-image ordering — rows carry an increasing sourcePageIndex matching input order", async () => {
    const result = await provider.extract({
      kind: "images",
      buffers: [Buffer.from("img1"), Buffer.from("img2"), Buffer.from("img3")],
      fileNames: ["1.jpg", "2.jpg", "3.jpg"],
      mimeTypes: ["image/jpeg", "image/jpeg", "image/jpeg"],
    });
    const pageIndexes = result.rows.map((r) => r.sourcePageIndex);
    // Each image contributes 2 rows — sourcePageIndex should read as 1,1,2,2,3,3, strictly
    // non-decreasing and matching input order, never shuffled.
    expect(pageIndexes).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("produces a mix of high and low confidence rows, not uniform fake data", async () => {
    const result = await provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" });
    const confidences = result.rows.map((r) => r.overallConfidence);
    expect(Math.max(...confidences)).toBeGreaterThan(0.8);
    expect(Math.min(...confidences)).toBeLessThan(0.6);
  });

  it("is deterministic across calls with the same input shape", async () => {
    const a = await provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" });
    const b = await provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" });
    expect(a.rows).toEqual(b.rows);
  });
});

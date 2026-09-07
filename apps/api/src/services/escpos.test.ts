import { describe, expect, it } from "@jest/globals";
import { buildEscposBase64, buildEscposBytes, padRow, wrapText } from "./escpos.js";
import type { PrintDocument } from "@restaurant/types";

describe("wrapText", () => {
  it("returns a single line when text fits within the width", () => {
    expect(wrapText("Pepperoni Pizza", 32)).toEqual(["Pepperoni Pizza"]);
  });

  it("wraps on word boundaries, never mid-word, when text exceeds the width", () => {
    const wrapped = wrapText("The quick brown fox jumps over the lazy dog", 10);
    for (const line of wrapped) expect(line.length).toBeLessThanOrEqual(10);
    expect(wrapped.join(" ")).toBe("The quick brown fox jumps over the lazy dog");
  });

  it("hard-breaks a single word longer than the width instead of overflowing", () => {
    const wrapped = wrapText("Supercalifragilisticexpialidocious", 10);
    for (const line of wrapped) expect(line.length).toBeLessThanOrEqual(10);
  });

  it("returns one empty line for empty text rather than an empty array", () => {
    expect(wrapText("", 32)).toEqual([""]);
  });
});

describe("padRow", () => {
  it("right-aligns the right value against the paper width when both fit", () => {
    const [line] = padRow("Subtotal", "$12.50", 20);
    expect(line.length).toBe(20);
    expect(line.endsWith("$12.50")).toBe(true);
    expect(line.startsWith("Subtotal")).toBe(true);
  });

  it("never truncates the right value — wraps the left value and puts right on its own line instead", () => {
    const lines = padRow("A very long item name that will not fit on one line", "$99.99", 20);
    expect(lines[lines.length - 1]).toBe("$99.99".padStart(20));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });
});

describe("buildEscposBytes / buildEscposBase64", () => {
  const doc: PrintDocument = {
    title: "Test",
    lines: [
      { type: "text", text: "Demo Restaurant", bold: true, align: "center" },
      { type: "rule" },
      { type: "row", left: "1 x Pizza", right: "$14.99" },
      { type: "spacer" },
      { type: "text", text: "Thank you!", align: "center" },
    ],
    escposBase64: "",
  };

  it("starts with the ESC/POS initialize command", () => {
    const bytes = buildEscposBytes(doc, 80);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it("ends with a full-cut command", () => {
    const bytes = buildEscposBytes(doc, 80);
    const last3 = Array.from(bytes.slice(-3));
    expect(last3).toEqual([0x1d, 0x56, 0x00]);
  });

  it("produces a different (typically longer) byte stream for narrower 58mm paper than 80mm, since word-wrapping changes", () => {
    // A single 90-char unbroken "word" hard-wraps into ceil(90/32)=3 lines at 58mm's 32-char width
    // but only ceil(90/48)=2 lines at 80mm's 48-char width — genuinely more line-feed bytes at 58mm.
    const wideDoc: PrintDocument = {
      title: "Test",
      lines: [{ type: "text", text: "A".repeat(90) }],
      escposBase64: "",
    };
    const bytes58 = buildEscposBytes(wideDoc, 58);
    const bytes80 = buildEscposBytes(wideDoc, 80);
    // Narrower paper wraps into more lines -> more line-feed bytes -> a longer byte stream overall.
    expect(bytes58.length).toBeGreaterThan(bytes80.length);
  });

  it("replaces non-ASCII characters with '?' rather than corrupting the byte stream", () => {
    const accented: PrintDocument = { title: "Test", lines: [{ type: "text", text: "Café Münü" }], escposBase64: "" };
    const bytes = buildEscposBytes(accented, 80);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Caf? M?n?");
  });

  it("buildEscposBase64 returns a valid base64 string decodable back to the same bytes", () => {
    const base64 = buildEscposBase64(doc, 80);
    const decoded = Buffer.from(base64, "base64");
    const direct = Buffer.from(buildEscposBytes(doc, 80));
    expect(decoded.equals(direct)).toBe(true);
  });
});

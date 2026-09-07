import type { PrintDocument, PrinterPaperWidthMm } from "@restaurant/types";

/**
 * Phase 57 — a minimal, dependency-free ESC/POS command builder. ESC/POS is Epson's long-public,
 * widely-cloned thermal-printer command set (documented at
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/) — this hand-rolls only the small
 * handful of commands a receipt/ticket actually needs (init, bold, align, cut) rather than pulling
 * in a third-party escpos package, since the full command set is far larger than what this
 * codebase's receipts require.
 *
 * KNOWN LIMITATION (documented honestly, not silently): text is encoded as plain ASCII, replacing
 * any non-ASCII character with "?" — real thermal printers vary in which codepage (CP437, CP850,
 * ...) they default to, and correctly transcoding UTF-8 to a specific printer's codepage requires
 * knowing that printer's configuration, which this phase does not model. Restaurant/item names with
 * accented or non-Latin characters will print with "?" substitutions until a codepage setting is
 * added to Printer.connectionConfig in a future phase.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function encodeAscii(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f); // "?" for anything outside printable ASCII
  }
  return out;
}

/** Greedy word-wrap to a fixed character width — never mid-word unless a single word alone exceeds
 *  the width, in which case it's hard-broken so a run-on string can never silently overflow. */
export function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Lays `left`/`right` on one line, right-aligning `right` against the paper width — if there's not
 *  enough room, wraps `left` and puts `right` on its own trailing line rather than truncating it
 *  (a price must never be silently cut off). */
export function padRow(left: string, right: string, width: number): string[] {
  const gap = width - left.length - right.length;
  if (gap >= 1) return [`${left}${" ".repeat(gap)}${right}`];
  return [...wrapText(left, width), right.padStart(width)];
}

function charsPerLine(paperWidthMm: PrinterPaperWidthMm): number {
  // Standard font at typical thermal DPI: ~32 chars/line at 58mm, ~48 at 80mm.
  return paperWidthMm === 58 ? 32 : 48;
}

export function buildEscposBytes(doc: PrintDocument, paperWidthMm: PrinterPaperWidthMm): Uint8Array {
  const width = charsPerLine(paperWidthMm);
  const out: number[] = [ESC, 0x40]; // initialize

  const pushLine = (chars: number[]) => {
    out.push(...chars, LF);
  };

  for (const line of doc.lines) {
    switch (line.type) {
      case "spacer":
        out.push(LF);
        break;
      case "rule":
        out.push(ESC, 0x61, 0x00);
        pushLine(encodeAscii("-".repeat(width)));
        break;
      case "row": {
        out.push(ESC, 0x61, 0x00);
        if (line.bold) out.push(ESC, 0x45, 0x01);
        for (const wrapped of padRow(line.left, line.right, width)) pushLine(encodeAscii(wrapped));
        if (line.bold) out.push(ESC, 0x45, 0x00);
        break;
      }
      case "text": {
        const align = line.align === "center" ? 0x01 : line.align === "right" ? 0x02 : 0x00;
        out.push(ESC, 0x61, align);
        if (line.bold) out.push(ESC, 0x45, 0x01);
        for (const wrapped of wrapText(line.text, width)) pushLine(encodeAscii(wrapped));
        if (line.bold) out.push(ESC, 0x45, 0x00);
        break;
      }
    }
  }

  out.push(LF, LF, LF);
  out.push(GS, 0x56, 0x00); // full cut
  return new Uint8Array(out);
}

export function buildEscposBase64(doc: PrintDocument, paperWidthMm: PrinterPaperWidthMm): string {
  return Buffer.from(buildEscposBytes(doc, paperWidthMm)).toString("base64");
}

import { PDFDocument } from "pdf-lib";
import { MAX_PDF_PAGES } from "./menuImportLimits.js";

/**
 * Phase 89 — checks a menu-import file by its actual bytes before anything is stored or sent to a
 * paid extraction provider. The browser-supplied MIME type (multer's fileFilter) is only a first
 * filter: anyone can label any file "application/pdf". Here:
 *  - the file signature ("magic bytes") must match a supported type — PDF, JPEG, PNG or WEBP;
 *  - a PDF must open (not encrypted, not corrupt) and have 1 to MAX_PDF_PAGES pages, counted by
 *    pdf-lib from the document's own page tree (a text search undercounts compressed PDFs).
 * Callers get a MenuImportFileError whose message is shown to the restaurant as-is.
 */

export type DetectedFileType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export class MenuImportFileError extends Error {
  constructor(
    message: string,
    public readonly code: "unsupported_file" | "pdf_unreadable" | "pdf_encrypted" | "pdf_no_pages" | "pdf_too_many_pages"
  ) {
    super(message);
    this.name = "MenuImportFileError";
  }
}

/** The real type of a file from its first bytes, or null when it isn't one we accept. */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Number of pages in a PDF; throws MenuImportFileError when it can't be read or is encrypted. */
export async function countPdfPages(buffer: Buffer, fileName = "This PDF"): Promise<number> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch (err) {
    if ((err as Error)?.name === "EncryptedPDFError" || /encrypt/i.test((err as Error)?.message ?? "")) {
      throw new MenuImportFileError(`${fileName} is password-protected. Remove the password and upload it again.`, "pdf_encrypted");
    }
    throw new MenuImportFileError(`${fileName} couldn't be opened as a PDF. It may be damaged — export it again and retry.`, "pdf_unreadable");
  }
  // pdf-lib parses leniently: a file with a valid header but no usable page tree can load and then
  // fail only when its pages are read.
  try {
    return doc.getPageCount();
  } catch {
    throw new MenuImportFileError(`${fileName} couldn't be opened as a PDF. It may be damaged — export it again and retry.`, "pdf_unreadable");
  }
}

/** Throws unless the PDF opens and has between 1 and MAX_PDF_PAGES pages. */
export async function assertPdfWithinPageLimit(buffer: Buffer, fileName = "This PDF"): Promise<number> {
  if (detectFileType(buffer) !== "application/pdf") {
    throw new MenuImportFileError(`${fileName} isn't a PDF file.`, "unsupported_file");
  }
  const pages = await countPdfPages(buffer, fileName);
  if (pages < 1) throw new MenuImportFileError(`${fileName} has no pages.`, "pdf_no_pages");
  if (pages > MAX_PDF_PAGES) {
    throw new MenuImportFileError(
      `${fileName} has ${pages} pages; menu imports accept up to ${MAX_PDF_PAGES}. Split it into smaller PDFs, or upload only the menu pages.`,
      "pdf_too_many_pages"
    );
  }
  return pages;
}

/**
 * Validates every uploaded file for a "pdf" / "image" / "images" import and returns each file's
 * real content type (from its signature), which callers store instead of the browser's claim.
 */
export async function validateMenuImportFiles(
  sourceType: "pdf" | "image" | "images",
  files: Array<{ buffer: Buffer; originalFileName: string }>
): Promise<DetectedFileType[]> {
  const types: DetectedFileType[] = [];
  for (const file of files) {
    const detected = detectFileType(file.buffer);
    if (sourceType === "pdf") {
      if (detected !== "application/pdf") {
        throw new MenuImportFileError(`"${file.originalFileName}" isn't a PDF file. Choose a PDF, or use the photo import for images.`, "unsupported_file");
      }
      await assertPdfWithinPageLimit(file.buffer, `"${file.originalFileName}"`);
    } else if (detected === null || detected === "application/pdf") {
      throw new MenuImportFileError(
        `"${file.originalFileName}" isn't a JPEG, PNG or WEBP image. Upload photos in one of those formats, or use the PDF import.`,
        "unsupported_file"
      );
    }
    types.push(detected);
  }
  return types;
}

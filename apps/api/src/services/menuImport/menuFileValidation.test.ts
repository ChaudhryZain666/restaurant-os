import { PDFDocument } from "pdf-lib";
import { assertPdfWithinPageLimit, countPdfPages, detectFileType, MenuImportFileError, validateMenuImportFiles } from "./menuFileValidation.js";
import { MAX_PDF_PAGES } from "./menuImportLimits.js";

/** Phase 89 — menu-import files are judged by their bytes, and PDFs by their real page count. */
async function pdfWithPages(pages: number, options: { useObjectStreams?: boolean; addDefaultPage?: boolean } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save(options));
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg body")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

describe("detectFileType", () => {
  it("recognises PDF, JPEG, PNG and WEBP by their signature", async () => {
    expect(detectFileType(await pdfWithPages(1))).toBe("application/pdf");
    expect(detectFileType(JPEG)).toBe("image/jpeg");
    expect(detectFileType(PNG)).toBe("image/png");
    expect(detectFileType(WEBP)).toBe("image/webp");
  });

  it("returns null for anything else, whatever its name or claimed type would say", () => {
    expect(detectFileType(Buffer.from("<html>not a menu file</html>"))).toBeNull();
    expect(detectFileType(Buffer.from("GIF89a"))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe("PDF page count and limit", () => {
  it("counts pages from the document itself, including compressed (object-stream) PDFs", async () => {
    expect(await countPdfPages(await pdfWithPages(3))).toBe(3);
    expect(await countPdfPages(await pdfWithPages(7, { useObjectStreams: true }))).toBe(7);
    expect(await countPdfPages(await pdfWithPages(5, { useObjectStreams: false }))).toBe(5);
  });

  it(`accepts exactly ${MAX_PDF_PAGES} pages and rejects ${MAX_PDF_PAGES + 1} with what to do`, async () => {
    await expect(assertPdfWithinPageLimit(await pdfWithPages(MAX_PDF_PAGES))).resolves.toBe(MAX_PDF_PAGES);
    const error = (await assertPdfWithinPageLimit(await pdfWithPages(MAX_PDF_PAGES + 1), '"big.pdf"').catch((e: unknown) => e)) as MenuImportFileError;
    expect(error).toBeInstanceOf(MenuImportFileError);
    expect(error.code).toBe("pdf_too_many_pages");
    expect(error.message).toBe(`"big.pdf" has ${MAX_PDF_PAGES + 1} pages; menu imports accept up to ${MAX_PDF_PAGES}. Split it into smaller PDFs, or upload only the menu pages.`);
  });

  it("rejects a PDF with no pages", async () => {
    // pdf-lib adds a blank page on save unless told not to.
    await expect(assertPdfWithinPageLimit(await pdfWithPages(0, { addDefaultPage: false }))).rejects.toMatchObject({ code: "pdf_no_pages" });
  });

  it("rejects a damaged PDF that only looks like one at the start", async () => {
    await expect(assertPdfWithinPageLimit(Buffer.from("%PDF-1.7\n this is not really a pdf"))).rejects.toMatchObject({ code: "pdf_unreadable" });
  });

  it("rejects a password-protected PDF with a clear message", async () => {
    const plain = (await pdfWithPages(1, { useObjectStreams: false })).toString("latin1");
    const encrypted = Buffer.from(plain.replace(/trailer\s*<</, "trailer\n<<\n/Encrypt 1 0 R"), "latin1");
    const error = (await countPdfPages(encrypted, '"locked.pdf"').catch((e: unknown) => e)) as MenuImportFileError;
    expect(error.code).toBe("pdf_encrypted");
    expect(error.message).toMatch(/"locked.pdf" is password-protected/);
  });
});

describe("validateMenuImportFiles", () => {
  it("returns each file's real type for valid uploads", async () => {
    await expect(validateMenuImportFiles("pdf", [{ buffer: await pdfWithPages(2), originalFileName: "menu.pdf" }])).resolves.toEqual(["application/pdf"]);
    await expect(
      validateMenuImportFiles("images", [
        { buffer: JPEG, originalFileName: "1.jpg" },
        { buffer: PNG, originalFileName: "2.png" },
        { buffer: WEBP, originalFileName: "3.webp" },
      ])
    ).resolves.toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("rejects a non-PDF sent as a PDF, and a PDF or non-image sent as a photo", async () => {
    await expect(validateMenuImportFiles("pdf", [{ buffer: JPEG, originalFileName: "menu.pdf" }])).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(validateMenuImportFiles("image", [{ buffer: await pdfWithPages(1), originalFileName: "photo.jpg" }])).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(validateMenuImportFiles("images", [{ buffer: JPEG, originalFileName: "1.jpg" }, { buffer: Buffer.from("text"), originalFileName: "2.jpg" }])).rejects.toThrow(
      /"2.jpg" isn't a JPEG, PNG or WEBP image/
    );
  });

  it("rejects a PDF over the page limit at upload", async () => {
    await expect(validateMenuImportFiles("pdf", [{ buffer: await pdfWithPages(MAX_PDF_PAGES + 5), originalFileName: "huge.pdf" }])).rejects.toMatchObject({
      code: "pdf_too_many_pages",
    });
  });
});

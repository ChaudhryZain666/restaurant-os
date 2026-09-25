import type { ExtractedRow, MenuExtractionInput, MenuExtractionProvider, MenuExtractionResult } from "./MenuExtractionProvider.js";

const CATEGORY_NAMES = ["Appetizers", "Mains", "Desserts", "Drinks", "Sides", "Salads", "Soups", "Specials"];

/**
 * Phase 81 — the default provider (MENU_EXTRACTION_PROVIDER_MODE=mock), mirroring
 * MockMarketplaceProvider.ts's role: lets the whole import pipeline — upload, async job
 * processing, confidence-bucketed review, publish — be genuinely exercised end-to-end with zero
 * real credentials. Deterministic (no randomness) so tests can assert on exact output, but varies
 * confidence per row so dev/test data actually has a mix of "looks good"/"check this"/"needs
 * review" rows to build the review UI against, rather than uniform fake data.
 */
export class MockMenuExtractionProvider implements MenuExtractionProvider {
  readonly name = "mock";

  async extract(input: MenuExtractionInput): Promise<MenuExtractionResult> {
    if (input.kind === "pdf") {
      return { rows: this.rowsForPage(1, "Sample Dish"), warnings: [], modelUsed: "mock-extraction-v1" };
    }
    if (input.kind === "html") {
      return { rows: this.rowsForPage(undefined, "Web Menu Item"), warnings: [], modelUsed: "mock-extraction-v1" };
    }
    // images — one category + 2 items per image, IN INPUT ORDER, so multi-image ordering is
    // actually exercised by anything that calls this provider (tests, dev UI).
    const rows: ExtractedRow[] = [];
    input.buffers.forEach((_buf, i) => {
      rows.push(...this.rowsForPage(i + 1, `Item from photo ${i + 1}`));
    });
    return { rows, warnings: [], modelUsed: "mock-extraction-v1" };
  }

  private rowsForPage(pageIndex: number | undefined, itemLabel: string): ExtractedRow[] {
    const category = CATEGORY_NAMES[(pageIndex ?? 1) % CATEGORY_NAMES.length];
    return [
      {
        categoryName: category,
        itemName: `${itemLabel} A`,
        description: "A confidently-read sample description.",
        price: "12.99",
        isAvailable: true,
        overallConfidence: 0.95,
        fieldConfidence: [
          { field: "categoryName", score: 0.97 },
          { field: "itemName", score: 0.98 },
          { field: "price", score: 0.9 },
        ],
        sourcePageIndex: pageIndex,
      },
      {
        categoryName: category,
        itemName: `${itemLabel} B`,
        description: "A less legible line the mock deliberately flags for review.",
        price: "9.5?",
        isAvailable: true,
        overallConfidence: 0.42,
        fieldConfidence: [
          { field: "categoryName", score: 0.8 },
          { field: "itemName", score: 0.6 },
          { field: "price", score: 0.2 },
        ],
        sourcePageIndex: pageIndex,
      },
    ];
  }
}

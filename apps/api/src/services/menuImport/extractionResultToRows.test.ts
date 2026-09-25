import { extractionResultToNormalizedRows, reviewCategoryFor } from "./extractionResultToRows.js";
import type { MenuExtractionResult } from "../../menuExtraction/MenuExtractionProvider.js";

describe("extractionResultToNormalizedRows", () => {
  it("converts a clean extracted row into a normalized row with no issues", () => {
    const result: MenuExtractionResult = {
      rows: [
        {
          categoryName: "Appetizers",
          itemName: "Garlic Bread",
          description: "Fresh baked",
          price: "7.00",
          isAvailable: true,
          overallConfidence: 0.95,
          fieldConfidence: [{ field: "price", score: 0.9 }],
          sourcePageIndex: 1,
        },
      ],
      warnings: [],
      modelUsed: "mock",
    };
    const [row] = extractionResultToNormalizedRows(result);
    expect(row).toMatchObject({
      rowNumber: 1,
      categoryName: "Appetizers",
      itemName: "Garlic Bread",
      price: 7,
      isAvailable: true,
      overallConfidence: 0.95,
      sourcePageIndex: 1,
      issues: [],
    });
  });

  it("reuses the same price-parsing guard as CSV — an unparseable price becomes an issue, never a guess", () => {
    const result: MenuExtractionResult = {
      rows: [
        {
          categoryName: "Mains",
          itemName: "Chicken Alfredo",
          price: "18?",
          overallConfidence: 0.5,
          fieldConfidence: [],
        },
      ],
      warnings: [],
      modelUsed: "mock",
    };
    const [row] = extractionResultToNormalizedRows(result);
    expect(row.price).toBeUndefined();
    expect(row.issues).toContainEqual({ field: "price", message: 'Price "18?" is not valid.' });
  });

  it("flags a missing category or item name as an issue rather than silently dropping the row", () => {
    const result: MenuExtractionResult = {
      rows: [{ categoryName: "", itemName: "", price: "5.00", overallConfidence: 0.3, fieldConfidence: [] }],
      warnings: [],
      modelUsed: "mock",
    };
    const [row] = extractionResultToNormalizedRows(result);
    expect(row.issues).toContainEqual({ field: "categoryName", message: "Category is missing." });
    expect(row.issues).toContainEqual({ field: "itemName", message: "Item name is missing." });
  });

  it("preserves multi-row ordering and sourcePageIndex across images", () => {
    const result: MenuExtractionResult = {
      rows: [
        { categoryName: "A", itemName: "1", price: "1.00", overallConfidence: 0.9, fieldConfidence: [], sourcePageIndex: 1 },
        { categoryName: "B", itemName: "2", price: "2.00", overallConfidence: 0.9, fieldConfidence: [], sourcePageIndex: 2 },
      ],
      warnings: [],
      modelUsed: "mock",
    };
    const rows = extractionResultToNormalizedRows(result);
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(rows.map((r) => r.sourcePageIndex)).toEqual([1, 2]);
  });

  it("does not invent a modifier group when none was extracted", () => {
    const result: MenuExtractionResult = {
      rows: [{ categoryName: "A", itemName: "1", price: "1.00", overallConfidence: 0.9, fieldConfidence: [] }],
      warnings: [],
      modelUsed: "mock",
    };
    const [row] = extractionResultToNormalizedRows(result);
    expect(row.modifierGroups).toEqual([]);
  });
});

describe("reviewCategoryFor", () => {
  const base = {
    rowNumber: 1,
    categoryName: "A",
    itemName: "Item",
    price: 10,
    isAvailable: true,
    modifierGroups: [],
    issues: [],
  };

  it("categorizes a missing required field as 'missing' regardless of confidence", () => {
    expect(reviewCategoryFor({ ...base, itemName: "", overallConfidence: 0.99 })).toBe("missing");
    expect(reviewCategoryFor({ ...base, price: undefined, overallConfidence: 0.99 })).toBe("missing");
  });

  it("categorizes high confidence with no issues as 'looks_good'", () => {
    expect(reviewCategoryFor({ ...base, overallConfidence: 0.9 })).toBe("looks_good");
  });

  it("categorizes mid confidence as 'check_this'", () => {
    expect(reviewCategoryFor({ ...base, overallConfidence: 0.7 })).toBe("check_this");
  });

  it("categorizes low confidence as 'needs_review'", () => {
    expect(reviewCategoryFor({ ...base, overallConfidence: 0.3 })).toBe("needs_review");
  });

  it("categorizes a non-required-field issue as 'needs_review' even with high confidence", () => {
    expect(
      reviewCategoryFor({ ...base, overallConfidence: 0.95, issues: [{ field: "sortOrder", message: "bad" }] })
    ).toBe("needs_review");
  });
});

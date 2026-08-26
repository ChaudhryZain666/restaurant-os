import type { MenuImportColumnMapping, MenuImportFieldKey } from "@restaurant/types";
import { MENU_IMPORT_FIELD_KEYS, MENU_IMPORT_REQUIRED_FIELDS } from "@restaurant/types";

/**
 * Phase 30 — header-name normalization for auto-mapping. Lowercases and strips everything but
 * letters/digits so "Category Name", "category_name", "CATEGORY-NAME", and "categoryname" all
 * collapse to the same key. Deliberately NOT fuzzy/typo-tolerant beyond this — a genuinely
 * unrecognized header is left unmapped for the user to assign manually rather than guessed at.
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIASES: Record<MenuImportFieldKey, string[]> = {
  categoryName: ["category", "categoryname", "section", "menusection"],
  itemName: ["itemname", "item", "name", "productname", "title", "menuitem", "menuitemname"],
  description: ["description", "desc", "details", "itemdescription"],
  price: ["price", "cost", "itemprice", "amount"],
  isAvailable: ["available", "isavailable", "availability", "instock", "active"],
  sortOrder: ["sortorder", "order", "sort", "position", "displayorder"],
  imageUrl: ["image", "imageurl", "photo", "picture", "img", "imagereference"],
  modifierGroupName: ["modifiergroup", "modifiergroupname", "optiongroup", "variantgroup"],
  modifierOptionName: ["modifieroption", "modifieroptionname", "optionname", "variantname"],
  modifierPrice: ["modifierprice", "optionprice", "modifieramount", "variantprice"],
  modifierMinSelect: ["modifiermin", "modifierminselect", "minselect", "min"],
  modifierMaxSelect: ["modifiermax", "modifiermaxselect", "maxselect", "max"],
};

// Reverse lookup built once — normalized alias string -> field key.
const ALIAS_TO_FIELD = new Map<string, MenuImportFieldKey>();
for (const key of MENU_IMPORT_FIELD_KEYS) {
  for (const alias of FIELD_ALIASES[key]) {
    ALIAS_TO_FIELD.set(alias, key);
  }
}

/**
 * Best-effort mapping from a file's raw header row to our logical fields. Never assigns the same
 * field to two different source columns (first match wins, in header order) — an ambiguous file
 * with two columns that both look like "price" leaves the second one unmapped rather than
 * silently picking one.
 */
export function suggestColumnMapping(headers: string[]): MenuImportColumnMapping {
  const mapping: MenuImportColumnMapping = {};
  const claimed = new Set<MenuImportFieldKey>();
  for (const header of headers) {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(header));
    if (field && !claimed.has(field)) {
      mapping[header] = field;
      claimed.add(field);
    } else {
      mapping[header] = null;
    }
  }
  return mapping;
}

/** Which required fields (categoryName/itemName/price) the given mapping fails to cover. */
export function missingRequiredFields(mapping: MenuImportColumnMapping): MenuImportFieldKey[] {
  const mapped = new Set(Object.values(mapping));
  return MENU_IMPORT_REQUIRED_FIELDS.filter((f) => !mapped.has(f));
}

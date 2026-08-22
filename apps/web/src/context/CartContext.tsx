import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MenuItem, ReorderPreviewItem, SelectedModifier } from "@restaurant/types";

// Session-scoped (not permanent) — a fresh tab/visit starts empty, matching TableContext's
// sessionStorage pattern. Without this, a full-page navigation (the only way to reach a
// different restaurant's storefront at all, since this app has no in-app restaurant switcher —
// see docs/multi-tenant-storefront-architecture.md) would already wipe the cart, making the
// cross-restaurant conflict guard below unreachable in practice rather than a real safeguard.
const STORAGE_KEY = "cart.lines";

function readStoredLines(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function writeStoredLines(lines: CartLine[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // sessionStorage can be unavailable (private browsing, embedded webviews) — the cart simply
    // won't survive a full navigation in that case; it still works within the page.
  }
}

export interface CartLine {
  /** menuItem.id + sorted optionIds + specialInstructions — two otherwise-identical items with
   *  different special instructions stay separate lines rather than silently merging one's note
   *  away when quantity increments. */
  lineId: string;
  menuItem: MenuItem;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  specialInstructions?: string;
}

/** "added" when the item joined the cart; "conflict" when the cart already holds a different
 *  restaurant's items and nothing was added — see docs/multi-tenant-storefront-architecture.md's
 *  cart-isolation section. Callers (MenuPage) are responsible for surfacing the conflict to the
 *  customer and, if they confirm, calling `clear()` before retrying `addItem`. */
type AddItemResult = "added" | "conflict";

interface CartContextValue {
  lines: CartLine[];
  /** Every MenuItem already carries its own restaurantId — this is just that of `lines[0]`, so a
   *  cart can never silently mix two restaurants' items (see addItem). Null when the cart is empty. */
  cartRestaurantId: string | null;
  /** `force: true` skips the conflict check — used only when the caller has already resolved a
   *  conflict (e.g. just called `clear()`) and needs the add to succeed unconditionally. Needed
   *  because `clear()` followed immediately by `addItem()` in the same handler would otherwise
   *  see a stale `cartRestaurantId` from this render's closure, not the just-cleared state. */
  addItem: (
    item: MenuItem,
    selectedModifiers?: SelectedModifier[],
    specialInstructions?: string,
    force?: boolean
  ) => AddItemResult;
  removeItem: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  clear: () => void;
  /** Replaces the whole cart with a reorder preview's current-priced items (see /orders/:id/reorder). */
  loadFromReorder: (items: ReorderPreviewItem[], restaurantId: string) => void;
  subtotal: number;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

function makeLineId(menuItemId: string, selectedModifiers: SelectedModifier[], specialInstructions?: string): string {
  const optionIds = selectedModifiers.map((m) => m.optionId).sort().join(",");
  return `${menuItemId}:${optionIds}:${specialInstructions ?? ""}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => readStoredLines());

  useEffect(() => {
    writeStoredLines(lines);
  }, [lines]);

  const cartRestaurantId = lines[0]?.menuItem.restaurantId ?? null;

  function addItem(
    item: MenuItem,
    selectedModifiers: SelectedModifier[] = [],
    specialInstructions?: string,
    force = false
  ): AddItemResult {
    if (!force && cartRestaurantId && item.restaurantId !== cartRestaurantId) return "conflict";

    const lineId = makeLineId(item.id, selectedModifiers, specialInstructions);
    setLines((prev) => {
      const existing = prev.find((l) => l.lineId === lineId);
      if (existing) {
        return prev.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { lineId, menuItem: item, quantity: 1, selectedModifiers, specialInstructions }];
    });
    return "added";
  }

  function removeItem(lineId: string) {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  function setQuantity(lineId: string, quantity: number) {
    if (quantity <= 0) return removeItem(lineId);
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
  }

  function clear() {
    setLines([]);
  }

  // Reorder items come from the server already re-priced against the CURRENT menu, not a
  // historical snapshot — this only ever needs id/name/price for cart rendering, so a minimal
  // MenuItem-shaped object is enough (no full menu fetch required just to populate the cart).
  function loadFromReorder(items: ReorderPreviewItem[], restaurantId: string) {
    setLines(
      items.map((item) => ({
        lineId: makeLineId(item.menuItemId, item.selectedModifiers),
        menuItem: {
          id: item.menuItemId,
          name: item.name,
          price: item.unitPrice,
          restaurantId,
          categoryId: "",
          description: "",
          isAvailable: true,
          sortOrder: 0,
        },
        quantity: item.quantity,
        selectedModifiers: item.selectedModifiers,
      }))
    );
  }

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const modifierTotal = l.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
        return sum + (l.menuItem.price + modifierTotal) * l.quantity;
      }, 0),
    [lines]
  );

  return (
    <CartContext.Provider
      value={{ lines, cartRestaurantId, addItem, removeItem, setQuantity, clear, loadFromReorder, subtotal }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

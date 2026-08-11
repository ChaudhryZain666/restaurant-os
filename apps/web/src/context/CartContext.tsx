import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { MenuItem, SelectedModifier } from "@restaurant/types";

export interface CartLine {
  /** menuItem.id + sorted optionIds — so the same item with different modifier choices is a separate line. */
  lineId: string;
  menuItem: MenuItem;
  quantity: number;
  selectedModifiers: SelectedModifier[];
}

interface CartContextValue {
  lines: CartLine[];
  addItem: (item: MenuItem, selectedModifiers?: SelectedModifier[]) => void;
  removeItem: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  clear: () => void;
  subtotal: number;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

function makeLineId(menuItemId: string, selectedModifiers: SelectedModifier[]): string {
  const optionIds = selectedModifiers.map((m) => m.optionId).sort().join(",");
  return `${menuItemId}:${optionIds}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  function addItem(item: MenuItem, selectedModifiers: SelectedModifier[] = []) {
    const lineId = makeLineId(item.id, selectedModifiers);
    setLines((prev) => {
      const existing = prev.find((l) => l.lineId === lineId);
      if (existing) {
        return prev.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { lineId, menuItem: item, quantity: 1, selectedModifiers }];
    });
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

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const modifierTotal = l.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
        return sum + (l.menuItem.price + modifierTotal) * l.quantity;
      }, 0),
    [lines]
  );

  return (
    <CartContext.Provider value={{ lines, addItem, removeItem, setQuantity, clear, subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

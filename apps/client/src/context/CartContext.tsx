import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { MenuItem } from "@restaurant/shared";

export interface CartLine {
  menuItem: MenuItem;
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  addItem: (item: MenuItem) => void;
  removeItem: (menuItemId: string) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  clear: () => void;
  subtotal: number;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  function addItem(item: MenuItem) {
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItem.id === item.id);
      if (existing) {
        return prev.map((l) => (l.menuItem.id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  }

  function removeItem(menuItemId: string) {
    setLines((prev) => prev.filter((l) => l.menuItem.id !== menuItemId));
  }

  function setQuantity(menuItemId: string, quantity: number) {
    if (quantity <= 0) return removeItem(menuItemId);
    setLines((prev) => prev.map((l) => (l.menuItem.id === menuItemId ? { ...l, quantity } : l)));
  }

  function clear() {
    setLines([]);
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.menuItem.price * l.quantity, 0),
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

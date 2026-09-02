import type { OrderItem } from "@restaurant/types";
import { formatCurrency } from "@restaurant/utils";

/**
 * The actual ordered items — quantity, name, chosen modifiers, per-line price, and any special
 * instructions. Extracted from OrdersManagementPage.tsx's OrderCard (the original, still-only
 * place this rendered) so CustomersPage.tsx's customer/order drill-down can show the same real
 * detail instead of a bare order-number/total summary — shared rather than duplicated because the
 * formatting choices here (currency, how modifiers join, the conditional italic instructions line)
 * are exactly the kind that drift if copy-pasted.
 */
export function OrderLineItems({ items, currency }: { items: OrderItem[]; currency: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i}>
          {item.quantity} x {item.name}
          {item.selectedModifiers.length > 0 && (
            <span className="text-muted"> ({item.selectedModifiers.map((m) => m.optionName).join(", ")})</span>
          )}{" "}
          — {formatCurrency(item.lineTotal, currency)}
          {item.specialInstructions && <span className="block italic">"{item.specialInstructions}"</span>}
        </li>
      ))}
    </ul>
  );
}

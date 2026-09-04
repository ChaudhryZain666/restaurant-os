import { useState } from "react";
import type { TableWithStatus } from "@restaurant/types";
import { Alert, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import {
  IconBanknote,
  IconChevronDown,
  IconCreditCard,
  IconMinus,
  IconPlus,
  IconTable,
  IconTruck,
  IconUsers,
} from "../../components/icons";
import type { CartLine, OrderTypeSel, PosPaymentMethod } from "../types";
import { lineTotal } from "../types";

const ORDER_TYPES: Array<{ value: OrderTypeSel; label: string; icon: typeof IconTable }> = [
  { value: "pickup", label: "Pickup", icon: IconUsers },
  { value: "dine_in", label: "Dine In", icon: IconTable },
  { value: "delivery", label: "Delivery", icon: IconTruck },
];

export function OrderPanel({
  cart,
  currency,
  onUpdateQuantity,
  customerLabel,
  onOpenCustomerPicker,
  orderType,
  onOrderTypeChange,
  tables,
  tableId,
  onTableChange,
  deliveryLine1,
  deliveryCity,
  onDeliveryChange,
  paymentMethod,
  onPaymentMethodChange,
  promoCode,
  onPromoCodeChange,
  customerNotes,
  onCustomerNotesChange,
  submitting,
  submitError,
  onSubmit,
  onClose,
}: {
  cart: CartLine[];
  currency: string;
  onUpdateQuantity: (key: string, delta: number) => void;
  customerLabel: { name: string; detail?: string } | null;
  onOpenCustomerPicker: () => void;
  orderType: OrderTypeSel;
  onOrderTypeChange: (t: OrderTypeSel) => void;
  tables: TableWithStatus[];
  tableId: string;
  onTableChange: (id: string) => void;
  deliveryLine1: string;
  deliveryCity: string;
  onDeliveryChange: (line1: string, city: string) => void;
  paymentMethod: PosPaymentMethod;
  onPaymentMethodChange: (m: PosPaymentMethod) => void;
  promoCode: string;
  onPromoCodeChange: (v: string) => void;
  customerNotes: string;
  onCustomerNotesChange: (v: string) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  /** Set only when this panel is rendered as the mobile full-screen sheet (see RegisterPage.tsx) —
   *  shows a close button so a cashier can get back to browsing without submitting or losing the
   *  cart. The desktop/tablet inline panel (always visible, no separate "browsing" state to
   *  return to) omits it. */
  onClose?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const subtotal = cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);

  const ctaLabel =
    cart.length === 0
      ? "Add items to start a sale"
      : submitting
        ? "Completing sale..."
        : paymentMethod === "card"
          ? `Charge ${formatCurrency(subtotal, currency)}`
          : `Take ${formatCurrency(subtotal, currency)} cash`;

  return (
    <aside className="flex h-full w-full flex-col bg-surface md:max-w-[420px] md:shrink-0 md:border-l md:border-border">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Current order</h2>
          <p className="text-xs text-muted">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Back to menu" className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-muted hover:bg-black/[0.04] hover:text-foreground">
            ×
          </button>
        )}
      </div>

      {/* Line items */}
      <div className="flex-1 overflow-y-auto px-5">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.03] text-muted">
              <IconUsers className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted">Tap a menu item to add it here.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border py-1">
            {cart.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{line.name}</p>
                  {line.selectedModifiers.length > 0 && (
                    <p className="truncate text-xs text-muted">{line.selectedModifiers.map((m) => m.optionName).join(", ")}</p>
                  )}
                  {line.specialInstructions && <p className="truncate text-xs italic text-muted">"{line.specialInstructions}"</p>}
                  <div className="mt-1.5 flex items-center gap-1">
                    <button
                      onClick={() => onUpdateQuantity(line.key, -1)}
                      aria-label={`Decrease quantity of ${line.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted hover:bg-black/[0.04]"
                    >
                      <IconMinus className="h-3 w-3" />
                    </button>
                    <span aria-live="polite" className="w-6 text-center text-sm font-medium tabular-nums text-foreground">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(line.key, 1)}
                      aria-label={`Increase quantity of ${line.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted hover:bg-black/[0.04]"
                    >
                      <IconPlus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <span className="shrink-0 font-heading text-sm font-semibold text-foreground">{formatCurrency(lineTotal(line), currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fixed checkout block */}
      <div className="flex flex-col gap-4 border-t border-border p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Subtotal</span>
          <span className="font-heading text-lg font-semibold text-foreground">{formatCurrency(subtotal, currency)}</span>
        </div>
        <p className="-mt-2.5 text-[11px] text-muted">Tax, promo and any delivery fee are calculated by the server at checkout.</p>

        <button
          onClick={onOpenCustomerPicker}
          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3.5 py-2.5 text-left transition-colors duration-fast hover:border-primary/40"
        >
          <span className="flex items-center gap-2 min-w-0">
            <IconUsers className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 truncate text-sm">
              <span className="font-medium text-foreground">{customerLabel?.name ?? "Select customer"}</span>
              {customerLabel?.detail && <span className="text-muted"> · {customerLabel.detail}</span>}
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">{customerLabel ? "Change" : "Choose"}</span>
        </button>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1.5">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => onOrderTypeChange(t.value)}
                className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-xs font-medium transition-colors duration-fast ${
                  orderType === t.value ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground/70 hover:bg-black/[0.03]"
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
          {orderType === "dine_in" && (
            <select
              value={tableId}
              onChange={(e) => onTableChange(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select a table...</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.status === "occupied" ? `(occupied · ${t.activeOrderCount})` : ""}
                </option>
              ))}
            </select>
          )}
          {orderType === "delivery" && (
            <div className="flex flex-col gap-1.5">
              <input
                value={deliveryLine1}
                onChange={(e) => onDeliveryChange(e.target.value, deliveryCity)}
                placeholder="Address line"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <input
                value={deliveryCity}
                onChange={(e) => onDeliveryChange(deliveryLine1, e.target.value)}
                placeholder="City"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onPaymentMethodChange("cash")}
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors duration-fast ${
              paymentMethod === "cash" ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground/70 hover:bg-black/[0.03]"
            }`}
          >
            <IconBanknote className="h-4 w-4" /> Cash
          </button>
          <button
            onClick={() => onPaymentMethodChange("card")}
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors duration-fast ${
              paymentMethod === "card" ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground/70 hover:bg-black/[0.03]"
            }`}
          >
            <IconCreditCard className="h-4 w-4" /> Card
          </button>
        </div>

        <button
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1 self-start text-xs font-medium text-muted hover:text-foreground"
        >
          <IconChevronDown className={`h-3.5 w-3.5 transition-transform duration-fast ${moreOpen ? "rotate-180" : ""}`} />
          Promo code &amp; notes
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-1.5">
            <input
              value={promoCode}
              onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
              placeholder="Promo code"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <input
              value={customerNotes}
              onChange={(e) => onCustomerNotesChange(e.target.value)}
              placeholder="Order notes"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
        )}

        {submitError && (
          <Alert tone="danger" role="alert">
            {submitError}
          </Alert>
        )}

        <Button size="lg" disabled={submitting || cart.length === 0} onClick={onSubmit} className="w-full">
          {ctaLabel}
        </Button>
      </div>
    </aside>
  );
}

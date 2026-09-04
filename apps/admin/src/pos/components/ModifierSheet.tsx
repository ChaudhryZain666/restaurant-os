import { useEffect, useState } from "react";
import type { MenuItem, ModifierGroup } from "@restaurant/types";
import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { SelectedModifier } from "../types";

/**
 * Required groups (minSelect > 0) must be satisfied before "Add to cart" is enabled — purely a
 * client-side convenience. The server independently re-derives and re-validates every price and
 * selection from scratch (priceOrderItems, via createOrderForCustomer) exactly like the
 * customer-facing checkout; nothing here is trusted. Behavior is unchanged from the original
 * PosPage.tsx's centered-modal ItemPicker — only the presentation (a right-edge sheet, matching
 * commercial POS software's own convention, rather than a dialog stealing the whole screen) and
 * visual polish changed.
 */
export function ModifierSheet({
  item,
  groups,
  currency,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  groups: ModifierGroup[];
  currency: string | undefined;
  onAdd: (mods: SelectedModifier[], notes: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function toggle(group: ModifierGroup, optionId: string) {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: current.includes(optionId) ? [] : [optionId] };
      }
      const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
      if (next.length > group.maxSelect) return prev;
      return { ...prev, [group.id]: next };
    });
  }

  const missingRequired = groups.some((g) => g.minSelect > 0 && (selected[g.id]?.length ?? 0) < g.minSelect);
  const modifierTotal = groups.reduce((sum, g) => {
    const picks = selected[g.id] ?? [];
    return sum + picks.reduce((s, optId) => s + (g.options.find((o) => o.id === optId)?.priceAdjustment ?? 0), 0);
  }, 0);

  function handleAdd() {
    const mods: SelectedModifier[] = [];
    for (const group of groups) {
      for (const optionId of selected[group.id] ?? []) {
        const option = group.options.find((o) => o.id === optionId);
        if (option) {
          mods.push({ groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, priceAdjustment: option.priceAdjustment });
        }
      }
    }
    onAdd(mods, notes);
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-secondary/40 backdrop-blur-[2px] transition-opacity duration-normal ${entered ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose options for ${item.name}`}
        className={`flex h-full w-full max-w-sm flex-col bg-surface shadow-elevated transition-transform duration-normal ease-premium ${entered ? "translate-x-0" : "translate-x-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">{item.name}</h2>
            <p className="mt-0.5 text-sm text-muted">{formatCurrency(item.price, currency)} base</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-black/[0.04] hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <fieldset key={group.id} className="flex flex-col gap-2">
                <legend className="mb-1 flex w-full items-center justify-between text-sm font-semibold text-foreground">
                  {group.name}
                  {group.minSelect > 0 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Required</span>
                  ) : (
                    <span className="text-[11px] font-normal text-muted">Optional</span>
                  )}
                </legend>
                <div className="flex flex-col gap-1.5">
                  {group.options
                    .filter((o) => o.isActive)
                    .map((option) => {
                      const checked = (selected[group.id] ?? []).includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-fast ${
                            checked ? "border-primary bg-primary/5" : "border-border hover:bg-black/[0.02]"
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <input
                              type={group.maxSelect === 1 ? "radio" : "checkbox"}
                              name={group.id}
                              checked={checked}
                              onChange={() => toggle(group, option.id)}
                              className="h-4 w-4 accent-[color:var(--color-primary)]"
                            />
                            <span className="font-medium text-foreground">{option.name}</span>
                          </span>
                          {option.priceAdjustment > 0 && (
                            <span className="text-muted">+{formatCurrency(option.priceAdjustment, currency)}</span>
                          )}
                        </label>
                      );
                    })}
                </div>
              </fieldset>
            ))}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-foreground">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="e.g. no onions"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border p-5">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button disabled={missingRequired} onClick={handleAdd} className="flex-[2]">
            Add · {formatCurrency(item.price + modifierTotal, currency)}
          </Button>
        </div>
      </div>
    </div>
  );
}

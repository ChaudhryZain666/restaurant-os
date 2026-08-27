import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuSectionProps } from "../types";

/** Editorial — a refined list, not a grid: a small square thumbnail, name/description at left,
 *  price right-aligned in serif, a hairline rule between rows, and a plain text "Add" affordance
 *  that expands a quiet inline panel below the row. Structurally unlike Classic's bordered card
 *  grid or Modern's full-bleed photo tiles. */
export function EditorialMenuSection({
  category,
  items,
  currency,
  orderingOpen,
  expandedItemId,
  justAddedId,
  groupsByItem,
  selections,
  instructionsDraft,
  onStartAdding,
  onToggleOption,
  onInstructionsChange,
  onConfirmAdd,
  onCancelAdd,
  registerSectionRef,
}: MenuSectionProps) {
  return (
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-32">
      <h2 className="mb-4 text-center font-heading text-2xl italic text-foreground">{category.name}</h2>
      <ul className="divide-y divide-border border-y border-border">
        {items.map((item) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <li key={item.id} className="py-4">
              <div className="flex items-start gap-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm bg-border">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted">
                      <span className="font-heading text-lg italic">{item.name[0]?.toUpperCase()}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <strong className="font-heading text-base font-medium text-foreground">{item.name}</strong>
                    <span className="shrink-0 whitespace-nowrap font-heading text-sm text-foreground">{formatCurrency(item.price, currency)}</span>
                  </div>
                  {item.description && <p className="text-sm text-muted">{item.description}</p>}
                  {!expanded && (
                    <button
                      onClick={() => onStartAdding(item)}
                      disabled={!orderingOpen}
                      className="mt-1 w-fit text-xs uppercase tracking-widest text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                    >
                      {justAddedId === item.id ? "Added ✓" : "Add to order"}
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
                <div className="mt-3 flex flex-col gap-3 border-t border-border pl-20 pt-3">
                  {groups.map((group) => (
                    <fieldset key={group.id} className="flex flex-col gap-1.5">
                      <legend className="mb-0.5 text-xs uppercase tracking-wide text-foreground">
                        {group.name}{" "}
                        <span className="normal-case text-muted">
                          ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                        </span>
                      </legend>
                      {group.options.map((option) => {
                        const checked = (selections[group.id] ?? []).includes(option.id);
                        return (
                          <label key={option.id} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
                            <span className="flex items-center gap-2">
                              <input
                                type={group.maxSelect === 1 ? "radio" : "checkbox"}
                                name={group.id}
                                checked={checked}
                                onChange={() => onToggleOption(group, option.id)}
                                className="h-4 w-4 accent-[var(--color-primary)]"
                              />
                              {option.name}
                            </span>
                            {option.priceAdjustment > 0 && <span className="text-muted">+{formatCurrency(option.priceAdjustment, currency)}</span>}
                          </label>
                        );
                      })}
                    </fieldset>
                  ))}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-foreground">Special instructions (optional)</span>
                    <input
                      value={instructionsDraft}
                      onChange={(e) => onInstructionsChange(e.target.value)}
                      placeholder="e.g. no onions"
                      maxLength={300}
                      className="rounded-sm border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <div className="flex gap-3">
                    <Button size="sm" className="rounded-sm" onClick={() => onConfirmAdd(item)} disabled={!orderingOpen}>
                      Confirm
                    </Button>
                    <button onClick={onCancelAdd} className="text-xs uppercase tracking-widest text-muted hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

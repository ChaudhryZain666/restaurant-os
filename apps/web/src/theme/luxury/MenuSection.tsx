import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuSectionProps } from "../types";

/** Luxury — elegant typography-led rows, deliberately without photography: serif name, a smaller
 *  quiet description line beneath it, price set in its own right-aligned column, a single hairline
 *  rule between rows. No card backgrounds, no shadows, no bordered boxes — the row IS the layout.
 *  "Add" is a quiet underline text control; selecting modifiers expands the row in place beneath a
 *  second hairline. */
export function LuxuryMenuSection({
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
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-[120px]">
      <h2 className="mb-2 font-heading text-2xl font-normal text-foreground sm:text-3xl">{category.name}</h2>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal
              as="li"
              variant="fade"
              index={i % 4}
              key={item.id}
              className="grid grid-cols-[1fr_auto] items-start gap-x-6 gap-y-4 py-6"
            >
              <div className="flex flex-col gap-1.5">
                <h3 className="font-heading text-lg font-normal leading-snug text-foreground sm:text-xl">{item.name}</h3>
                {item.description && <p className="max-w-md text-[13px] leading-relaxed text-muted">{item.description}</p>}
                {!expanded && (
                  <button
                    onClick={() => onStartAdding(item)}
                    disabled={!orderingOpen}
                    className="mt-1 w-fit text-xs font-medium uppercase tracking-[0.16em] text-foreground/70 underline-offset-4 transition-colors duration-fast hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:text-muted/50 disabled:no-underline"
                  >
                    {justAddedId === item.id ? "Added ✓" : "Add"}
                  </button>
                )}
              </div>

              <span className="whitespace-nowrap pt-1 text-right font-heading text-base text-foreground">
                {formatCurrency(item.price, currency)}
              </span>

              {expanded && (
                <div className="col-span-2 flex flex-col gap-4 border-t border-border pt-5">
                  {groups.map((group) => (
                    <fieldset key={group.id} className="flex flex-col gap-2">
                      <legend className="mb-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                        {group.name}{" "}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                        </span>
                      </legend>
                      {group.options.map((option) => {
                        const checked = (selections[group.id] ?? []).includes(option.id);
                        return (
                          <label key={option.id} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
                            <span className="flex items-center gap-2.5 text-foreground">
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
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">Special instructions</span>
                    <input
                      value={instructionsDraft}
                      onChange={(e) => onInstructionsChange(e.target.value)}
                      placeholder="e.g. no onions"
                      maxLength={300}
                      className="border-b border-border bg-transparent py-1.5 text-sm text-foreground focus:border-foreground focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center gap-6 pt-1">
                    <button
                      onClick={() => onConfirmAdd(item)}
                      disabled={!orderingOpen}
                      className="border border-foreground px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-foreground transition-colors duration-fast hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <button onClick={onCancelAdd} className="text-xs font-medium uppercase tracking-[0.14em] text-muted hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuSectionProps } from "../types";

/** Minimal — a plain, text-first list: dish name and price joined by a dotted leader rule (the
 *  classic printed-menu device — name .......... price), a quiet description line beneath, and a
 *  SMALL square photograph only when the item actually has one. No placeholder tile, no silhouette
 *  icon for items without a photo — a page of mostly-unphotographed dishes reads as a clean list
 *  rather than a grid with holes in it. This is the clearest structural break from Cinematic's
 *  full-width photo rows and from Editorial's thumbnail-on-every-row list. Expanding a row for
 *  modifiers pushes the row open in place; "Confirm" is a hand-rolled outline button (never the
 *  shared pill `Button` — see the Phase 33 brief's note on `rounded-pill` not being overridable),
 *  "Add to order" a plain underline-on-hover text control. */
export function MinimalMenuSection({
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
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-28">
      <h2 className="mb-8 text-xl font-normal tracking-tight text-foreground">{category.name}</h2>
      <ul className="flex flex-col">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal as="li" index={i % 6} variant="fade" key={item.id} className="border-b border-border py-6 first:pt-0 last:border-b-0">
              <div className="flex items-start gap-5">
                {item.imageUrl && (
                  <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="h-11 w-11 shrink-0 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-end gap-3">
                    <h3 className="text-[15px] font-normal text-foreground">{item.name}</h3>
                    <span aria-hidden className="mb-1.5 flex-1 border-b border-dotted border-border" />
                    <span className="shrink-0 text-[14px] tabular-nums text-foreground">{formatCurrency(item.price, currency)}</span>
                  </div>
                  {item.description && <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{item.description}</p>}

                  {expanded ? (
                    <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                      {groups.map((group) => (
                        <fieldset key={group.id} className="flex flex-col gap-2">
                          <legend className="mb-0.5 text-[12px] tracking-[0.02em] text-foreground">
                            {group.name}{" "}
                            <span className="text-muted">
                              ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                            </span>
                          </legend>
                          {group.options.map((option) => {
                            const checked = (selections[group.id] ?? []).includes(option.id);
                            return (
                              <label key={option.id} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-[13px]">
                                <span className="flex items-center gap-2.5 text-foreground">
                                  <input
                                    type={group.maxSelect === 1 ? "radio" : "checkbox"}
                                    name={group.id}
                                    checked={checked}
                                    onChange={() => onToggleOption(group, option.id)}
                                    className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                                  />
                                  {option.name}
                                </span>
                                {option.priceAdjustment > 0 && (
                                  <span className="text-muted">+{formatCurrency(option.priceAdjustment, currency)}</span>
                                )}
                              </label>
                            );
                          })}
                        </fieldset>
                      ))}
                      <label className="flex flex-col gap-1 text-[13px]">
                        <span className="text-foreground">Special instructions</span>
                        <input
                          value={instructionsDraft}
                          onChange={(e) => onInstructionsChange(e.target.value)}
                          placeholder="e.g. no onions"
                          maxLength={300}
                          className="border-b border-border bg-transparent py-1.5 text-[13px] focus:border-foreground focus:outline-none"
                        />
                      </label>
                      <div className="flex items-center gap-5 pt-1">
                        <button
                          onClick={() => onConfirmAdd(item)}
                          disabled={!orderingOpen}
                          className="border border-foreground px-5 py-2 text-[12px] tracking-[0.04em] text-foreground transition-colors duration-fast hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button onClick={onCancelAdd} className="text-[12px] tracking-[0.02em] text-muted hover:text-foreground">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => onStartAdding(item)}
                      disabled={!orderingOpen}
                      className="mt-2 w-fit text-[12px] tracking-[0.04em] text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                    >
                      {justAddedId === item.id ? "Added" : "Add to order"}
                    </button>
                  )}
                </div>
              </div>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

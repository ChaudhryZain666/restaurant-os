import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem } from "@restaurant/types";
import type { MenuSectionProps } from "../types";
import { PlateIcon } from "../icons";

function RowImage({ item }: { item: MenuItem }) {
  if (item.imageUrl) {
    return (
      <div className="aspect-[16/10] w-full overflow-hidden bg-secondary sm:w-64">
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="cinematic-grade h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-[1.06]"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center bg-secondary text-secondary-foreground/20 sm:w-64">
      <PlateIcon className="h-10 w-10" />
    </div>
  );
}

/** Cinematic — full-width horizontal photography rows, not a card grid: large image left (or top on
 *  mobile), name/description/price right, a thin hairline dividing rows. "Add" is a quiet uppercase
 *  text control, not a filled button; image prominence increases on hover. Selecting modifiers
 *  expands the row downward in place. */
export function CinematicMenuSection({
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
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-40">
      <h2 className="mb-6 font-heading text-2xl font-semibold uppercase tracking-[0.08em] text-foreground sm:text-3xl">{category.name}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal as="li" index={i % 4} key={item.id} className="group flex flex-col gap-5 py-6 sm:flex-row sm:items-stretch sm:gap-8">
              <RowImage item={item} />
              <div className="flex flex-1 flex-col justify-center gap-2">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-heading text-xl font-medium text-foreground sm:text-2xl">{item.name}</h3>
                  <span className="shrink-0 whitespace-nowrap font-heading text-lg text-foreground">{formatCurrency(item.price, currency)}</span>
                </div>
                {item.description && <p className="max-w-md text-sm leading-relaxed text-muted">{item.description}</p>}

                {expanded ? (
                  <div className="mt-3 flex flex-col gap-4 border-t border-border pt-4">
                    {groups.map((group) => (
                      <fieldset key={group.id} className="flex flex-col gap-2">
                        <legend className="mb-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
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
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">Special instructions</span>
                      <input
                        value={instructionsDraft}
                        onChange={(e) => onInstructionsChange(e.target.value)}
                        placeholder="e.g. no onions"
                        maxLength={300}
                        className="border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
                      />
                    </label>
                    <div className="flex items-center gap-5 pt-1">
                      <button
                        onClick={() => onConfirmAdd(item)}
                        disabled={!orderingOpen}
                        className="border border-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition-colors duration-fast hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button onClick={onCancelAdd} className="text-xs font-medium uppercase tracking-[0.16em] text-muted hover:text-foreground">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => onStartAdding(item)}
                    disabled={!orderingOpen}
                    className="mt-1 w-fit text-xs font-semibold uppercase tracking-[0.2em] text-primary underline-offset-4 transition-opacity duration-fast hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                  >
                    {justAddedId === item.id ? "Added ✓" : "Add to order"}
                  </button>
                )}
              </div>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

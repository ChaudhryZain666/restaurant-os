import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem } from "@restaurant/types";
import type { MenuSectionProps } from "../types";
import { PlateIcon } from "../icons";

function ItemImage({ item, offsetUp }: { item: MenuItem; offsetUp: boolean }) {
  const shift = offsetUp ? "sm:-mt-6" : "sm:mt-6";
  if (item.imageUrl) {
    return (
      <div className={`aspect-[4/3] w-full max-w-[15rem] shrink-0 overflow-hidden bg-secondary ${shift}`}>
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-slow ease-premium hover:scale-[1.05]"
        />
      </div>
    );
  }
  return (
    <div className={`flex aspect-[4/3] w-full max-w-[15rem] shrink-0 items-center justify-center bg-secondary text-secondary-foreground/20 ${shift}`}>
      <PlateIcon className="h-8 w-8" />
    </div>
  );
}

/** Contemporary — each dish is its own asymmetric composition, not a uniform row-card: a huge
 *  ghost-toned index number floats in its own column, the price sits apart in a separate column
 *  (never beside the name), and the image — when there is one — hangs offset above or below the
 *  price, alternating per row so the list reads with visible rhythm instead of one repeated block.
 *  Selecting modifiers expands a full-width bordered panel below the row (never inline in a card). */
export function ContemporaryMenuSection({
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
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-44">
      <h2 className="mb-8 font-heading text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">{category.name}</h2>
      <ul className="flex flex-col">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal
              as="li"
              variant="scale"
              index={i % 4}
              key={item.id}
              className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-border py-10 sm:grid-cols-12 sm:items-start sm:py-12"
            >
              <span aria-hidden className="font-heading text-6xl font-black leading-none text-border sm:col-span-2 sm:text-7xl">
                {String(i + 1).padStart(2, "0")}
              </span>

              <div className="flex flex-col gap-3 sm:col-span-6">
                <h3 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">{item.name}</h3>
                {item.description && <p className="max-w-sm text-sm leading-relaxed text-muted">{item.description}</p>}

                {!expanded && (
                  <button
                    onClick={() => onStartAdding(item)}
                    disabled={!orderingOpen}
                    className="mt-1 w-fit border-2 border-foreground px-5 py-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground transition-colors duration-fast hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:border-border disabled:text-muted"
                  >
                    {justAddedId === item.id ? "Added ✓" : "Add to order"}
                  </button>
                )}
              </div>

              <div className="flex flex-row items-start gap-4 sm:col-span-4 sm:flex-col sm:items-end">
                <span className="shrink-0 font-heading text-3xl font-black text-primary sm:text-4xl">{formatCurrency(item.price, currency)}</span>
                <ItemImage item={item} offsetUp={i % 2 === 0} />
              </div>

              {expanded && (
                <div className="flex flex-col gap-5 border-2 border-foreground bg-surface p-5 sm:col-span-12 sm:p-8">
                  {groups.map((group) => (
                    <fieldset key={group.id} className="flex flex-col gap-2">
                      <legend className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-foreground">
                        {group.name}{" "}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                        </span>
                      </legend>
                      {group.options.map((option) => {
                        const checked = (selections[group.id] ?? []).includes(option.id);
                        return (
                          <label
                            key={option.id}
                            className={`flex cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-sm transition-colors duration-fast ${
                              checked ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/40"
                            }`}
                          >
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
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-foreground">Special instructions</span>
                    <input
                      value={instructionsDraft}
                      onChange={(e) => onInstructionsChange(e.target.value)}
                      placeholder="e.g. no onions"
                      maxLength={300}
                      className="border-2 border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => onConfirmAdd(item)}
                      disabled={!orderingOpen}
                      className="bg-foreground px-6 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-background transition-opacity duration-fast hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <button onClick={onCancelAdd} className="text-xs font-bold uppercase tracking-[0.16em] text-muted hover:text-foreground">
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

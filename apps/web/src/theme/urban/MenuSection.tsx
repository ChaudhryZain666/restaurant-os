import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem } from "@restaurant/types";
import type { MenuSectionProps } from "../types";
import { PlateIcon } from "../icons";

function RowImage({ item }: { item: MenuItem }) {
  if (item.imageUrl) {
    return (
      <div className="aspect-square w-24 shrink-0 overflow-hidden bg-secondary sm:w-36">
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-[1.08]"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-square w-24 shrink-0 items-center justify-center bg-secondary text-secondary-foreground/25 sm:w-36">
      <PlateIcon className="h-8 w-8" />
    </div>
  );
}

/** Urban — dense numbered rows, not a card grid: a big faint index number, one strong
 *  name+price line, description, a small "N options" tag ONLY when the item actually has
 *  modifier groups (real data, never an invented "Popular"/"Spicy" label), and a large square
 *  image block flush right. A thick rule (not a hairline) separates rows. Confirm/Add controls are
 *  hand-rolled solid blocks — sharp corners throughout, no pill/rounded shape anywhere. */
export function UrbanMenuSection({
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
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-36">
      <h2 className="mb-6 flex items-center gap-3 font-heading text-2xl font-black uppercase tracking-tight text-foreground sm:text-3xl">
        <span className="h-6 w-2.5 shrink-0 bg-primary" aria-hidden />
        {category.name}
      </h2>
      <ul className="flex flex-col">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal
              as="li"
              index={i % 6}
              key={item.id}
              className="group flex items-stretch gap-4 border-b-4 border-foreground/10 py-6 first:pt-0 sm:gap-6"
            >
              <span className="hidden w-12 shrink-0 select-none font-heading text-4xl font-black leading-none text-foreground/10 sm:block sm:text-5xl">
                {String(i + 1).padStart(2, "0")}
              </span>

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 truncate font-heading text-lg font-black uppercase tracking-tight text-foreground sm:text-2xl">{item.name}</h3>
                  <span className="shrink-0 whitespace-nowrap font-heading text-base font-black text-foreground sm:text-lg">
                    {formatCurrency(item.price, currency)}
                  </span>
                </div>

                {item.description && <p className="line-clamp-2 max-w-md text-sm leading-relaxed text-muted">{item.description}</p>}

                {groups.length > 0 && (
                  <span className="w-fit bg-foreground px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-background">
                    {groups.length} {groups.length === 1 ? "option" : "options"} to customize
                  </span>
                )}

                {expanded ? (
                  <div className="mt-2 flex flex-col gap-4 border-t-2 border-foreground/15 pt-4">
                    {groups.map((group) => (
                      <fieldset key={group.id} className="flex flex-col gap-1.5">
                        <legend className="mb-0.5 text-xs font-black uppercase tracking-wide text-foreground">
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
                              className={`flex cursor-pointer items-center justify-between gap-2 border-2 px-3 py-2 text-sm transition-colors duration-fast ${
                                checked ? "border-primary bg-primary/10" : "border-border hover:border-foreground/25"
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
                      <span className="text-xs font-black uppercase tracking-wide text-foreground">Special instructions</span>
                      <input
                        value={instructionsDraft}
                        onChange={(e) => onInstructionsChange(e.target.value)}
                        placeholder="e.g. no onions"
                        maxLength={300}
                        className="border-2 border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
                      />
                    </label>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => onConfirmAdd(item)}
                        disabled={!orderingOpen}
                        className="bg-foreground px-6 py-2.5 text-xs font-black uppercase tracking-wide text-background transition-transform duration-fast hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                      >
                        Confirm
                      </button>
                      <button onClick={onCancelAdd} className="text-xs font-black uppercase tracking-wide text-muted hover:text-foreground">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => onStartAdding(item)}
                    disabled={!orderingOpen}
                    className={`mt-1 w-fit px-5 py-2 text-xs font-black uppercase tracking-wide transition-transform duration-fast hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${
                      justAddedId === item.id ? "bg-success text-white" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {justAddedId === item.id ? "Added ✓" : "Add to order"}
                  </button>
                )}
              </div>

              <RowImage item={item} />
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

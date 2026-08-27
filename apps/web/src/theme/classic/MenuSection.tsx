import { Button, Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem } from "@restaurant/types";
import type { MenuSectionProps } from "../types";
import { PlateIcon } from "../icons";

function ItemThumb({ item }: { item: MenuItem }) {
  if (item.imageUrl) {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-border">
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-105"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 text-primary/40">
      <PlateIcon className="h-10 w-10" />
    </div>
  );
}

/** Classic — a responsive card grid, each card expanding in place to reveal modifier selection.
 *  The original storefront's product presentation, preserved exactly for restaurants that keep
 *  the default theme. */
export function ClassicMenuSection({
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
      <h2 className="mb-3 text-xl font-semibold text-foreground">{category.name}</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <Reveal
              as="li"
              index={i % 3}
              key={item.id}
              className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm transition-shadow duration-normal hover:shadow-md"
            >
              <ItemThumb item={item} />
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <strong className="font-heading text-base font-semibold leading-tight text-foreground">{item.name}</strong>
                  <span className="shrink-0 whitespace-nowrap font-semibold text-primary">{formatCurrency(item.price, currency)}</span>
                </div>
                {item.description && <p className="line-clamp-2 text-sm text-muted">{item.description}</p>}
              </div>

              {expanded ? (
                <div className="mt-1 flex flex-col gap-3 border-t border-border pt-3">
                  {groups.map((group) => (
                    <fieldset key={group.id} className="flex flex-col gap-1.5">
                      <legend className="mb-0.5 text-sm font-medium text-foreground">
                        {group.name}{" "}
                        <span className="font-normal text-muted">
                          ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                        </span>
                      </legend>
                      {group.options.map((option) => {
                        const checked = (selections[group.id] ?? []).includes(option.id);
                        return (
                          <label
                            key={option.id}
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors duration-fast ${
                              checked ? "border-primary bg-primary/5" : "border-border hover:bg-black/[0.02]"
                            }`}
                          >
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
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => onConfirmAdd(item)} disabled={!orderingOpen}>
                      Confirm add to cart
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onCancelAdd}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => onStartAdding(item)}
                  disabled={!orderingOpen}
                  size="sm"
                  variant={justAddedId === item.id ? "secondary" : "primary"}
                  className="mt-1"
                >
                  {justAddedId === item.id ? "Added ✓" : "Add to cart"}
                </Button>
              )}
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

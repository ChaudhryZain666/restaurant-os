import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem } from "@restaurant/types";
import type { MenuSectionProps } from "../types";

function Thumb({ item }: { item: MenuItem }) {
  if (item.imageUrl) {
    return <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-105" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-accent/20">
      <span className="text-3xl font-black text-foreground/70">{item.name[0]?.toUpperCase()}</span>
    </div>
  );
}

/** Modern — full-bleed image cards with name/price overlaid directly on the photo in a bottom
 *  gradient scrim (no card padding around the image, no rounded corners), a dense 2/3-col grid.
 *  Expanding for modifiers drops a sharp-edged panel below the card rather than growing inline. */
export function ModernMenuSection({
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
      <h2 className="mb-4 text-sm font-black uppercase tracking-[0.16em] text-foreground">{category.name}</h2>
      <ul className="grid grid-cols-2 gap-0.5 sm:grid-cols-3">
        {items.map((item) => {
          const groups = groupsByItem.get(item.id) ?? [];
          const expanded = expandedItemId === item.id;
          return (
            <li key={item.id} className="flex flex-col">
              <div
                role="button"
                aria-disabled={!orderingOpen}
                tabIndex={orderingOpen ? 0 : -1}
                onClick={() => orderingOpen && onStartAdding(item)}
                onKeyDown={(e) => e.key === "Enter" && orderingOpen && onStartAdding(item)}
                className={`group relative aspect-square w-full overflow-hidden bg-border ${orderingOpen ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
              >
                <Thumb item={item} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-2.5 py-2.5">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-bold leading-tight text-white">{item.name}</span>
                    <span className="shrink-0 text-sm font-black text-white">{formatCurrency(item.price, currency)}</span>
                  </div>
                </div>
                {justAddedId === item.id && (
                  <span className="absolute right-2 top-2 bg-primary px-2 py-0.5 text-[11px] font-bold uppercase text-primary-foreground">Added</span>
                )}
              </div>

              {expanded && (
                <div className="flex flex-col gap-3 border-2 border-t-0 border-foreground bg-surface p-3">
                  {item.description && <p className="text-xs text-muted">{item.description}</p>}
                  {groups.map((group) => (
                    <fieldset key={group.id} className="flex flex-col gap-1.5">
                      <legend className="mb-0.5 text-xs font-bold uppercase tracking-wide text-foreground">
                        {group.name}{" "}
                        <span className="font-normal normal-case text-muted">
                          ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                        </span>
                      </legend>
                      {group.options.map((option) => {
                        const checked = (selections[group.id] ?? []).includes(option.id);
                        return (
                          <label
                            key={option.id}
                            className={`flex cursor-pointer items-center justify-between gap-2 border px-2.5 py-1.5 text-sm transition-colors duration-fast ${
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
                      className="border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 rounded-none" onClick={() => onConfirmAdd(item)} disabled={!orderingOpen}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" className="rounded-none" onClick={onCancelAdd}>
                      Cancel
                    </Button>
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

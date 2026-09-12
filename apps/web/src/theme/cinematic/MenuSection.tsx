import { useEffect, useRef, type RefObject } from "react";
import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { MenuItem, ModifierGroup } from "@restaurant/types";
import type { MenuSectionProps } from "../types";
import { PlateIcon, CloseGlyphIcon } from "../icons";

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
    <div
      className="flex aspect-[16/10] w-full items-center justify-center text-secondary-foreground/40 sm:w-64"
      style={{ background: "radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--color-secondary) 88%, white) 0%, var(--color-secondary) 75%)" }}
    >
      <PlateIcon className="h-9 w-9" />
    </div>
  );
}

interface ModifiersProps {
  item: MenuItem;
  groups: ModifierGroup[];
  currency: string;
  orderingOpen: boolean;
  selections: Record<string, string[]>;
  instructionsDraft: string;
  onToggleOption: MenuSectionProps["onToggleOption"];
  onInstructionsChange: MenuSectionProps["onInstructionsChange"];
  onConfirmAdd: MenuSectionProps["onConfirmAdd"];
  onCancelAdd: MenuSectionProps["onCancelAdd"];
}

/** The modifier-selection form shared by the modal (desktop/tablet) and the sheet (mobile) below —
 *  identical fields, only the surrounding chrome differs. */
function ModifierForm({ item, groups, currency, orderingOpen, selections, instructionsDraft, onToggleOption, onInstructionsChange, onConfirmAdd, onCancelAdd }: ModifiersProps) {
  return (
    <div className="flex flex-col gap-5">
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
              <label key={option.id} className="flex cursor-pointer items-center justify-between gap-2 py-1.5 text-sm">
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
          className="border border-foreground bg-foreground px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-background transition-opacity duration-fast hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add to order — {formatCurrency(item.price, currency)}
        </button>
        <button onClick={onCancelAdd} className="text-xs font-medium uppercase tracking-[0.16em] text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Cinematic — the "premium moment" this theme's item detail is built around: a large-photograph
 *  overlay, not a cramped inline expansion. Desktop/tablet gets a centered dialog with the image
 *  leading; mobile gets a bottom sheet (the image scrolls with the content, keeping the CTA
 *  reachable without the photo eating the whole first screen on a small phone). Both render the
 *  identical ModifierForm — no logic duplicated, only the surrounding composition differs.
 *
 *  Focus moves into the panel on open and returns to the row's own "Add to order" trigger on
 *  close (Escape, backdrop click, Cancel, or a successful Confirm) — the same Escape/backdrop
 *  pattern ConfirmDialog already establishes elsewhere in this codebase. */
function ItemDetailOverlay({
  item,
  groups,
  currency,
  orderingOpen,
  selections,
  instructionsDraft,
  onToggleOption,
  onInstructionsChange,
  onConfirmAdd,
  onCancelAdd,
  triggerRef,
}: ModifiersProps & { triggerRef: RefObject<HTMLButtonElement | null> }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelAdd();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      // z-[60] — above HelpWidget.tsx's persistent floating button (z-50, fixed bottom-right on
      // every page), otherwise its always-on-top help bubble sits over this modal's own bottom-
      // right controls (confirmed: the mobile layout's Cancel button was getting visually
      // obscured by it before this fix).
      className="fixed inset-0 z-[60] flex items-end justify-center bg-secondary/70 backdrop-blur-[2px] motion-reduce:backdrop-blur-none sm:items-center sm:p-6"
      onClick={onCancelAdd}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} — customize and add to order`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up flex max-h-[92vh] w-full flex-col overflow-y-auto bg-background sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:rounded-sm motion-reduce:animate-none"
      >
        <div className="relative">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="cinematic-grade h-64 w-full object-cover sm:h-80" />
          ) : (
            <div
              className="flex h-48 w-full items-center justify-center text-secondary-foreground/40"
              style={{ background: "radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--color-secondary) 88%, white) 0%, var(--color-secondary) 75%)" }}
            >
              <PlateIcon className="h-12 w-12" />
            </div>
          )}
          <button
            onClick={onCancelAdd}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-background/90 text-foreground transition-opacity duration-fast hover:opacity-80"
          >
            <CloseGlyphIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-heading text-2xl font-medium text-foreground sm:text-3xl">{item.name}</h3>
            <span className="shrink-0 whitespace-nowrap font-heading text-lg text-foreground">{formatCurrency(item.price, currency)}</span>
          </div>
          {item.description && <p className="max-w-lg text-sm leading-relaxed text-muted">{item.description}</p>}
          <ModifierForm
            item={item}
            groups={groups}
            currency={currency}
            orderingOpen={orderingOpen}
            selections={selections}
            instructionsDraft={instructionsDraft}
            onToggleOption={onToggleOption}
            onInstructionsChange={onInstructionsChange}
            onConfirmAdd={onConfirmAdd}
            onCancelAdd={onCancelAdd}
          />
        </div>
      </div>
    </div>
  );
}

/** Cinematic — full-width horizontal photography rows, not a card grid: large image left (or top on
 *  mobile), name/description/price right, a thin hairline dividing rows. "Add" is a quiet uppercase
 *  text control, not a filled button; image prominence increases on hover. An item with modifiers
 *  opens the large-photograph detail overlay above instead of expanding the row in place — the
 *  "intentional, premium moment" a modifier-heavy item deserves rather than pushing every row below
 *  it down the page. */
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
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const expandedItem = items.find((i) => i.id === expandedItemId);

  return (
    <section id={`category-${category.id}`} ref={(el) => registerSectionRef(category.id, el)} className="scroll-mt-40">
      <h2 className="mb-6 font-heading text-2xl font-semibold uppercase tracking-[0.08em] text-foreground sm:text-3xl">{category.name}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item, i) => {
          return (
            <Reveal as="li" index={i % 4} key={item.id} className="group flex flex-col gap-5 py-6 sm:flex-row sm:items-stretch sm:gap-8">
              <RowImage item={item} />
              <div className="flex flex-1 flex-col justify-center gap-2">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-heading text-xl font-medium text-foreground sm:text-2xl">{item.name}</h3>
                  <span className="shrink-0 whitespace-nowrap font-heading text-lg text-foreground">{formatCurrency(item.price, currency)}</span>
                </div>
                {item.description && <p className="max-w-md text-sm leading-relaxed text-muted">{item.description}</p>}

                <button
                  ref={(el) => {
                    if (el) triggerRefs.current.set(item.id, el);
                  }}
                  key={justAddedId === item.id ? "added" : "idle"}
                  onClick={() => onStartAdding(item)}
                  disabled={!orderingOpen}
                  className={`mt-1 w-fit text-xs font-semibold uppercase tracking-[0.2em] underline-offset-4 transition-opacity duration-fast hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline ${
                    justAddedId === item.id ? "animate-scale-in text-success" : "text-primary"
                  }`}
                >
                  {justAddedId === item.id ? "Added ✓" : "Add to order"}
                </button>
              </div>
            </Reveal>
          );
        })}
      </ul>

      {expandedItem &&
        (() => {
          const triggerRef: RefObject<HTMLButtonElement | null> = { current: triggerRefs.current.get(expandedItem.id) ?? null };
          return (
            <ItemDetailOverlay
              item={expandedItem}
              groups={groupsByItem.get(expandedItem.id) ?? []}
              currency={currency}
              orderingOpen={orderingOpen}
              selections={selections}
              instructionsDraft={instructionsDraft}
              onToggleOption={onToggleOption}
              onInstructionsChange={onInstructionsChange}
              onConfirmAdd={onConfirmAdd}
              onCancelAdd={onCancelAdd}
              triggerRef={triggerRef}
            />
          );
        })()}
    </section>
  );
}

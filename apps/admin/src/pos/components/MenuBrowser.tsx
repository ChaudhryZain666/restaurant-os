import { useMemo, useState } from "react";
import type { SyntheticEvent } from "react";
import type { Category, MenuItem } from "@restaurant/types";
import { EmptyState } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { IconSearch } from "../../components/icons";

const MONOGRAM_TINTS = [
  "bg-primary/12 text-primary",
  "bg-amber-500/12 text-amber-700",
  "bg-emerald-500/12 text-emerald-700",
  "bg-sky-500/12 text-sky-700",
  "bg-violet-500/12 text-violet-700",
];

function monogramTint(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length];
}

function ItemCard({ item, currency, onSelect }: { item: MenuItem; currency: string; onSelect: () => void }) {
  // Starts optimistic whenever the item genuinely has an imageUrl; onError below flips it to the
  // monogram fallback for good — covers a relative/broken/unreachable URL exactly like a missing
  // one, rather than leaving a broken-image glyph on screen.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imageFailed;

  return (
    <button
      onClick={onSelect}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:translate-y-0 active:scale-[0.98]"
    >
      <div className={`flex aspect-[4/3] items-center justify-center overflow-hidden ${showImage ? "bg-black/5" : monogramTint(item.name)}`}>
        {showImage ? (
          <img
            src={item.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e: SyntheticEvent<HTMLImageElement>) => {
              e.currentTarget.onerror = null;
              setImageFailed(true);
            }}
          />
        ) : (
          <span className="font-heading text-3xl font-semibold opacity-70">{item.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.name}</span>
        <span className="mt-auto pt-1.5 font-heading text-base font-semibold text-primary">{formatCurrency(item.price, currency)}</span>
      </div>
    </button>
  );
}

export function MenuBrowser({
  categories,
  items,
  currency,
  onSelectItem,
}: {
  categories: Category[];
  items: MenuItem[];
  currency: string;
  onSelectItem: (item: MenuItem) => void;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [search, setSearch] = useState("");

  const searchLower = search.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    const available = items.filter((i) => i.isAvailable);
    if (searchLower) {
      return available.filter((i) => i.name.toLowerCase().includes(searchLower) || i.description?.toLowerCase().includes(searchLower));
    }
    return available.filter((i) => i.categoryId === activeCategoryId);
  }, [items, activeCategoryId, searchLower]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background/95 px-6 pb-3 pt-5 backdrop-blur-sm">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu..."
            className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3.5 text-sm text-foreground shadow-sm focus-visible:border-primary"
          />
        </div>
        {!searchLower && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-fast ${
                  activeCategoryId === cat.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-surface text-foreground/70 hover:bg-black/[0.04]"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 px-6 pb-6">
        {visibleItems.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              icon={<IconSearch className="h-6 w-6" />}
              title={searchLower ? "No items match your search" : "No items in this category"}
              description={searchLower ? "Try a different search term." : "Add items to the menu to sell them here."}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleItems.map((item) => (
              <ItemCard key={item.id} item={item} currency={currency} onSelect={() => onSelectItem(item)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

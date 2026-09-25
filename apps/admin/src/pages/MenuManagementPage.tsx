import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Category, CategoryLocationOverride, MenuItem, MenuItemLocationOverride } from "@restaurant/types";
import { Badge, Button, EmptyState, Skeleton, Spinner, useToast } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useCan } from "../hooks/useCan";
import { useActiveBusinessId } from "../context/BusinessContext";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { useRestaurantCurrency } from "../hooks/useRestaurantCurrency";
import { ItemEditorDrawer, type ItemDraft } from "../components/ItemEditorDrawer";
import { MenuBuilderLayout } from "../components/menu-builder/MenuBuilderLayout";
import { CategoryNavRail, type AvailabilityFilter } from "../components/menu-builder/CategoryNavRail";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { previewUrl, storefrontUrl } from "../lib/links";
import { IconChevronDown, IconGripVertical, IconImage, IconMenuBook, IconSearch, IconX } from "../components/icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";
const rowActionClass = "text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground";

/** Sentinel expandedItemId meaning "the create-item panel is open" — before a real item exists to
 *  key the panel on. Chosen so it can never collide with a real Mongo ObjectId string. */
const CREATING = "__creating__";

function draftFromItem(item: MenuItem): ItemDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    price: String(item.price),
    categoryId: item.categoryId,
    imageUrl: item.imageUrl ?? "",
    isAvailable: item.isAvailable,
  };
}

function emptyDraft(defaultCategoryId: string): ItemDraft {
  return { name: "", description: "", price: "", categoryId: defaultCategoryId, imageUrl: "", isAvailable: true };
}

/** A real, accessible switch (role="switch" on a native button, not a styled checkbox hack) — the
 *  primary control for canonical availability. Per-location overrides stay plain text links below
 *  it: this is deliberately the ONE visually prominent control per row, everything else recedes. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast ${checked ? "bg-primary" : "bg-black/15"}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-fast ${checked ? "translate-x-[18px]" : "translate-x-1"}`}
      />
    </button>
  );
}

/** A drag handle that is ALSO a keyboard control: focus it and press Arrow Up/Down to move by one
 *  position (reusing the exact same swap-with-adjacent-sibling logic the mouse-drag path resequences
 *  around), or drag it with a mouse/touch onto another row to drop there. One control, two input
 *  methods — chosen over a separate up/down button pair so drag-and-drop never becomes a
 *  keyboard-only-user's second-class feature (a real, tested requirement, not an afterthought). */
function GripHandle({
  label,
  onMoveUp,
  onMoveDown,
  disableUp,
  disableDown,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disableUp: boolean;
  disableDown: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" && !disableUp) {
          e.preventDefault();
          onMoveUp();
        }
        if (e.key === "ArrowDown" && !disableDown) {
          e.preventDefault();
          onMoveDown();
        }
      }}
      aria-label={`Reorder ${label} — drag, or use the arrow keys`}
      title="Drag to reorder, or use the arrow keys"
      className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground active:cursor-grabbing"
    >
      <IconGripVertical className="h-4 w-4" />
    </button>
  );
}

interface OverridesResponse {
  categoryOverrides: CategoryLocationOverride[];
  menuItemOverrides: MenuItemLocationOverride[];
  modifierGroupOverrides: unknown[];
}

export function MenuManagementPage() {
  const businessId = useActiveBusinessId();
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();
  const { restaurant } = useRestaurantSettings();
  // Every role that can reach this page at all (owner/manager/restaurant_staff — see App.tsx's
  // RequireAuth permission="restaurant.menu.read") either has all three menu-editing permissions
  // together (owner, manager) or none of them (restaurant_staff never has menu.write,
  // categories.write, or modifiers.write) — so this one check is a safe stand-in for gating every
  // write control on the page, not just item edits.
  const canWrite = useCan("restaurant.menu.write");
  const { showToast } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryLocationOverride[]>([]);
  const [itemOverrides, setItemOverrides] = useState<MenuItemLocationOverride[]>([]);
  const [modifierCounts, setModifierCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryDescription, setEditingCategoryDescription] = useState("");
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [hasModifiersOnly, setHasModifiersOnly] = useState(false);
  const [noImageOnly, setNoImageOnly] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previewDialogRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Drag-and-drop reorder state — which row is currently being dragged, purely for the drop
  // handlers below; arrow-key reordering never touches this at all.
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ categoryId: string; itemId: string } | null>(null);
  // Which category card the pointer is currently dragging over — purely visual (a ring highlight),
  // separate from draggedCategoryId/draggedItem which drive the actual drop logic.
  const [dropHighlightCategoryId, setDropHighlightCategoryId] = useState<string | null>(null);

  // A single expand-panel drives BOTH creating a new item and editing an existing one.
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function reload() {
    const [categoriesRes, itemsRes, overridesRes, modifierCountsRes] = await Promise.all([
      apiClient.request<{ categories: Category[] }>(`/businesses/${businessId}/categories`),
      apiClient.request<{ items: MenuItem[] }>(`/businesses/${businessId}/menu`),
      apiClient.request<OverridesResponse>(`/restaurants/${restaurantId}/menu/overrides`),
      apiClient.request<{ counts: Record<string, number> }>(`/businesses/${businessId}/menu/modifier-counts`),
    ]);
    setCategories(categoriesRes.categories);
    setItems(itemsRes.items);
    setCategoryOverrides(overridesRes.categoryOverrides);
    setItemOverrides(overridesRes.menuItemOverrides);
    setModifierCounts(modifierCountsRes.counts);
    return itemsRes.items;
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  useEffect(() => {
    if (!showPreview) return;
    setPreviewLoaded(false);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPreview(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPreview]);

  // Traps focus inside the preview overlay while it's open and restores it to the "Live preview"
  // trigger button on close — the same shared primitive the item editor drawer uses.
  useFocusTrap(previewDialogRef, showPreview, { initialFocusRef: previewCloseButtonRef });

  const categoryOverrideById = new Map(categoryOverrides.map((o) => [o.categoryId, o]));
  const itemOverrideById = new Map(itemOverrides.map((o) => [o.menuItemId, o]));

  function effectiveItemAvailability(item: MenuItem): boolean {
    return itemOverrideById.get(item.id)?.isAvailable ?? item.isAvailable;
  }

  /** Scrolls the center canvas to a category's header (or to the very top for "" = All items),
   *  expanding it first if it was collapsed — the left rail's category list is a real jump-nav,
   *  not just a read-only count summary. */
  function scrollToCategory(categoryId: string) {
    if (!categoryId) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setCollapsedCategoryIds((prev) => {
      if (!prev.has(categoryId)) return prev;
      const next = new Set(prev);
      next.delete(categoryId);
      return next;
    });
    // Collapse state change reflows layout — wait a tick before measuring/scrolling to it.
    requestAnimationFrame(() => {
      categoryRefs.current.get(categoryId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const createdName = newCategoryName;
      // The validation schema defaults sortOrder to 0 when omitted — fine for the very first
      // category, but every category created after that would ALSO default to 0 and tie with
      // whichever earlier one(s) never got a real sortOrder, making them un-reorderable relative to
      // each other (swapping two equal values is a no-op). Placing new categories at the end of the
      // real current order avoids ever creating that tie.
      const nextSortOrder = categories.length > 0 ? Math.max(...categories.map((c) => c.sortOrder)) + 1 : 0;
      await apiClient.request(`/businesses/${businessId}/categories`, {
        method: "POST",
        body: { name: newCategoryName, description: newCategoryDescription || undefined, sortOrder: nextSortOrder },
      });
      setNewCategoryName("");
      setNewCategoryDescription("");
      await reload();
      showToast({ title: "Category added", description: `"${createdName}" is ready for items.` });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteCategory(category: Category) {
    if (!window.confirm(`Delete the canonical category "${category.name}" for ALL locations of this business? This can't be undone.`))
      return;
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories/${category.id}`, { method: "DELETE" });
      await reload();
      showToast({ title: "Category deleted", description: `"${category.name}" was removed for every location.` });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdateCategory(id: string, patch: Partial<Pick<Category, "name" | "description" | "sortOrder" | "isActive">>) {
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories/${id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleCategoryActive(category: Category) {
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories/${category.id}`, {
        method: "PATCH",
        body: { isActive: !category.isActive },
      });
      await reload();
      showToast({
        title: category.isActive ? "Category hidden" : "Category visible",
        description: `"${category.name}" is now ${category.isActive ? "hidden from" : "visible to"} customers at every location.`,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Swaps sortOrder with the adjacent category in the already-sorted `categories` array — the
   *  keyboard path (Arrow Up/Down on the grip handle). */
  async function handleReorderCategory(category: Category, direction: "up" | "down") {
    const idx = categories.findIndex((c) => c.id === category.id);
    const swapWith = direction === "up" ? categories[idx - 1] : categories[idx + 1];
    if (!swapWith) return;
    setError(null);
    try {
      await Promise.all([
        apiClient.request(`/businesses/${businessId}/categories/${category.id}`, { method: "PATCH", body: { sortOrder: swapWith.sortOrder } }),
        apiClient.request(`/businesses/${businessId}/categories/${swapWith.id}`, { method: "PATCH", body: { sortOrder: category.sortOrder } }),
      ]);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** The drag-and-drop path — moves one category to another's position and resequences every
   *  category's sortOrder to match (0..n-1). Safe at the scale categories actually reach (single
   *  to low double digits), unlike doing this for a 100-item list. */
  async function handleMoveCategoryTo(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const ids = categories.map((c) => c.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...categories];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setError(null);
    try {
      await Promise.all(
        reordered.map((c, index) => apiClient.request(`/businesses/${businessId}/categories/${c.id}`, { method: "PATCH", body: { sortOrder: index } }))
      );
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSaveCategoryOverride(id: string, patch: { isActive?: boolean; sortOrderOverride?: number }) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${id}/override`, { method: "PUT", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleResetCategoryOverride(id: string) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${id}/override`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startRenameCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryDescription(category.description ?? "");
  }

  function cancelRenameCategory() {
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategoryDescription("");
  }

  async function saveRenameCategory(id: string) {
    const name = editingCategoryName.trim();
    if (!name) return;
    await handleUpdateCategory(id, { name, description: editingCategoryDescription.trim() || undefined });
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategoryDescription("");
    showToast({ title: "Category updated", description: `Now called "${name}".` });
  }

  function toggleCategoryCollapsed(id: string) {
    setCollapsedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleReorderItem(item: MenuItem, direction: "up" | "down") {
    const siblings = items.filter((i) => i.categoryId === item.categoryId);
    const idx = siblings.findIndex((i) => i.id === item.id);
    const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return;
    setError(null);
    try {
      await Promise.all([
        apiClient.request(`/businesses/${businessId}/menu/${item.id}`, { method: "PATCH", body: { sortOrder: swapWith.sortOrder } }),
        apiClient.request(`/businesses/${businessId}/menu/${swapWith.id}`, { method: "PATCH", body: { sortOrder: item.sortOrder } }),
      ]);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Item drag-and-drop is deliberately scoped to siblings within the SAME category — sortOrder is
   *  only ever meaningful relative to same-category siblings (menu.controller.ts sorts
   *  categoryId,sortOrder,name), and moving an item to a different category is a bigger feature
   *  (changing its categoryId) than this reorder gesture is meant to cover. */
  async function handleMoveItemTo(categoryId: string, sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const siblings = items.filter((i) => i.categoryId === categoryId);
    const ids = siblings.map((i) => i.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setError(null);
    try {
      await Promise.all(
        reordered.map((item, index) => apiClient.request(`/businesses/${businessId}/menu/${item.id}`, { method: "PATCH", body: { sortOrder: index } }))
      );
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Dropping an item onto a DIFFERENT category's card (rather than onto one of its own siblings)
   *  moves the item there outright — changing its categoryId and placing it at the end of that
   *  category. This is deliberately simpler than precise same-category reordering: the owner drops
   *  it in the right section, then uses the same grip-handle reorder to position it exactly, rather
   *  than this gesture having to guess an exact insertion index in a category it doesn't already
   *  belong to. */
  async function handleMoveItemToCategory(itemId: string, targetCategoryId: string) {
    const targetSiblings = items.filter((i) => i.categoryId === targetCategoryId);
    const nextSortOrder = targetSiblings.length > 0 ? Math.max(...targetSiblings.map((i) => i.sortOrder)) + 1 : 0;
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/menu/${itemId}`, {
        method: "PATCH",
        body: { categoryId: targetCategoryId, sortOrder: nextSortOrder },
      });
      await reload();
      showToast({ title: "Item moved", description: "Moved to the new category." });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleAvailability(item: MenuItem) {
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/menu/${item.id}`, {
        method: "PATCH",
        body: { isAvailable: !item.isAvailable },
      });
      await reload();
      showToast({
        title: item.isAvailable ? "Item hidden" : "Item visible",
        description: `"${item.name}" is now ${item.isAvailable ? "hidden from" : "visible to"} customers at every location.`,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteItem(item: MenuItem) {
    if (!window.confirm(`Delete the canonical menu item "${item.name}" for ALL locations of this business? This can't be undone.`))
      return;
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/menu/${item.id}`, { method: "DELETE" });
      if (expandedItemId === item.id) closePanel();
      await reload();
      showToast({ title: "Item deleted", description: `"${item.name}" was removed for every location.` });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openCreatePanel(categoryId?: string) {
    setError(null);
    setExpandedItemId(CREATING);
    setDraft(emptyDraft(categoryId ?? categories[0]?.id ?? ""));
  }

  function openEditPanel(item: MenuItem) {
    setError(null);
    setExpandedItemId(item.id);
    setDraft(draftFromItem(item));
  }

  function closePanel() {
    // Modifier-group edits happen inside ModifierGroupsEditor, a nested component with its own
    // local reload() — it has no way to tell this page its modifierCounts are now stale. Always
    // reloading on close (not just after saveDraft's own item-field changes) keeps the item list's
    // "N options" indicator accurate regardless of which part of the drawer actually changed.
    void reload();
    setExpandedItemId(null);
    setDraft(null);
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: draft.name,
        description: draft.description || undefined,
        price: Number(draft.price),
        categoryId: draft.categoryId,
        imageUrl: draft.imageUrl || undefined,
      };

      if (expandedItemId === CREATING) {
        // Same reasoning as handleCreateCategory's nextSortOrder: leaving this to the schema's
        // sortOrder default (0) would tie every new item in a category against whichever earlier
        // one(s) never got a real sortOrder, making them un-reorderable relative to each other.
        const categorySiblings = items.filter((i) => i.categoryId === draft.categoryId);
        const nextSortOrder = categorySiblings.length > 0 ? Math.max(...categorySiblings.map((i) => i.sortOrder)) + 1 : 0;
        const { item } = await apiClient.request<{ item: MenuItem }>(`/businesses/${businessId}/menu`, {
          method: "POST",
          body: { ...body, isAvailable: draft.isAvailable, sortOrder: nextSortOrder },
        });
        const freshItems = await reload();
        setExpandedItemId(item.id);
        setDraft(draftFromItem(freshItems.find((i) => i.id === item.id) ?? item));
        showToast({ title: "Item added", description: `"${item.name}" is on the menu.` });
      } else if (expandedItemId) {
        await apiClient.request(`/businesses/${businessId}/menu/${expandedItemId}`, {
          method: "PATCH",
          body: { ...body, isAvailable: draft.isAvailable },
        });
        await reload();
        showToast({ title: "Item saved", description: `"${draft.name}" was updated.` });
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveItemOverride(itemId: string, patch: { priceOverride?: number; isAvailable?: boolean }) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${itemId}/override`, { method: "PUT", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleResetItemOverride(itemId: string) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${itemId}/override`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  function itemMatchesFilters(item: MenuItem): boolean {
    const effectiveAvailable = effectiveItemAvailability(item);
    if (availabilityFilter === "available" && !effectiveAvailable) return false;
    if (availabilityFilter === "unavailable" && effectiveAvailable) return false;
    if (hasModifiersOnly && (modifierCounts[item.id] ?? 0) === 0) return false;
    if (noImageOnly && item.imageUrl) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!item.name.toLowerCase().includes(q) && !(item.description ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }

  const itemsByCategoryId = new Map<string, MenuItem[]>();
  const knownCategoryIds = new Set(categories.map((c) => c.id));
  const orphanedItems: MenuItem[] = [];
  for (const item of items) {
    if (!knownCategoryIds.has(item.categoryId)) {
      orphanedItems.push(item);
      continue;
    }
    const list = itemsByCategoryId.get(item.categoryId) ?? [];
    list.push(item);
    itemsByCategoryId.set(item.categoryId, list);
  }

  const unavailableCount = items.filter((item) => !effectiveItemAvailability(item)).length;
  const itemsWithoutPhotoCount = items.filter((item) => !item.imageUrl).length;
  const isFiltering = search.trim() !== "" || availabilityFilter !== "all" || hasModifiersOnly || noImageOnly;
  const totalVisibleItems = items.filter(itemMatchesFilters).length;
  const previewHref = restaurant?.slug ? (restaurant.status === "active" ? storefrontUrl(restaurant.slug) : previewUrl(restaurant.slug)) : null;

  function clearFilters() {
    setSearch("");
    setAvailabilityFilter("all");
    setHasModifiersOnly(false);
    setNoImageOnly(false);
  }

  function renderItemRow(item: MenuItem, siblings: MenuItem[], itemIndex: number) {
    const override = itemOverrideById.get(item.id);
    const effectivePrice = override?.priceOverride ?? item.price;
    const effectiveAvailable = override?.isAvailable ?? item.isAvailable;
    const modifierCount = modifierCounts[item.id] ?? 0;
    const isDropTarget = draggedItem?.categoryId === item.categoryId && draggedItem.itemId !== item.id;

    return (
      <li
        key={item.id}
        onDragOver={(e) => {
          if (isDropTarget) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedItem && draggedItem.categoryId === item.categoryId) {
            handleMoveItemTo(item.categoryId, draggedItem.itemId, item.id);
          }
          setDraggedItem(null);
        }}
        className="flex flex-col rounded-lg py-2.5 transition-colors duration-fast animate-fade-up"
      >
        <div className="flex flex-wrap items-center gap-3">
          {canWrite && (
            <GripHandle
              label={item.name}
              onMoveUp={() => handleReorderItem(item, "up")}
              onMoveDown={() => handleReorderItem(item, "down")}
              disableUp={itemIndex === 0}
              disableDown={itemIndex === siblings.length - 1}
              onDragStart={() => setDraggedItem({ categoryId: item.categoryId, itemId: item.id })}
              onDragEnd={() => setDraggedItem(null)}
            />
          )}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.04]">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <IconImage className="h-4 w-4 text-muted" />
            )}
          </div>
          <div className="min-w-[110px] flex-1">
            <p className="truncate font-medium text-foreground">{item.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <span className="font-medium text-foreground/80">{formatCurrency(effectivePrice, currency)}</span>
              {override?.priceOverride != null && <span className="line-through">{formatCurrency(item.price, currency)}</span>}
              {modifierCount > 0 && (
                <span>
                  · {modifierCount} option{modifierCount === 1 ? "" : "s"}
                </span>
              )}
              {!effectiveAvailable && <Badge tone="neutral">hidden here</Badge>}
              {override && <Badge tone="info">overridden here</Badge>}
            </p>
            {item.description && <p className="mt-0.5 truncate text-xs text-muted/80">{item.description}</p>}
          </div>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-3">
              <Switch checked={item.isAvailable} onChange={() => handleToggleAvailability(item)} label={`${item.name} available to customers`} />
              <button onClick={() => openEditPanel(item)} aria-label="Edit" title="Edit" className={rowActionClass}>
                Edit
              </button>
              <button onClick={() => handleDeleteItem(item)} aria-label="Delete" title="Delete" className="text-sm font-medium text-danger hover:underline">
                Delete
              </button>
            </div>
          )}
        </div>
      </li>
    );
  }

  const itemCountByCategory = new Map(categories.map((c) => [c.id, (itemsByCategoryId.get(c.id) ?? []).length]));

  const centerCanvas = (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold text-foreground">Menu</h1>
          <p className="mt-1 text-sm text-muted">Build your menu, organize your dishes, and control what customers see.</p>
          <p className="mt-2 text-sm text-foreground/80">
            <span className="font-medium">{items.length}</span> item{items.length === 1 ? "" : "s"}
            {" · "}
            <span className="font-medium">{categories.length}</span> categor{categories.length === 1 ? "y" : "ies"}
            {unavailableCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-warning">{unavailableCount} unavailable</span>
              </>
            )}
            {" · "}applies to every location
          </p>
          {itemsWithoutPhotoCount > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
              <IconImage className="h-3.5 w-3.5" />
              {itemsWithoutPhotoCount} item{itemsWithoutPhotoCount === 1 ? "" : "s"} don't have photos yet.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {previewHref && (
            <>
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="text-sm font-medium text-primary transition-colors duration-fast hover:underline"
              >
                Live preview
              </button>
              <a href={previewHref} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary transition-colors duration-fast hover:underline">
                {restaurant?.status === "active" ? "View live storefront ↗" : "Preview storefront ↗"}
              </a>
            </>
          )}
          {canWrite && (
            <Link to="/menu/import">
              <Button variant="secondary" size="sm">
                Import menu
              </Button>
            </Link>
          )}
          {canWrite && items.length > 0 && (
            <Button size="sm" onClick={() => openCreatePanel()} disabled={expandedItemId === CREATING}>
              + Add menu item
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {/* Always rendered, even with zero categories — this is the ONLY place the add-category
          form lives, so it must never be gated behind categories.length > 0. */}
      {canWrite && (
        <form onSubmit={handleCreateCategory} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3.5">
          <input
            id="new-category-input"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name"
            required
            className={inputClass}
          />
          <input
            value={newCategoryDescription}
            onChange={(e) => setNewCategoryDescription(e.target.value)}
            placeholder="Description (optional)"
            className={inputClass}
          />
          <Button type="submit" size="sm">
            Add category
          </Button>
        </form>
      )}

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconMenuBook className="h-5 w-5" />}
          title="Your menu starts here"
          description="Add your first category, then start adding the dishes your customers will love."
          action={
            canWrite ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button size="sm" onClick={() => document.getElementById("new-category-input")?.focus()}>
                  Create category
                </Button>
                <Link to="/menu/import" className="text-sm font-medium text-primary hover:underline">
                  or import a menu
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {canWrite && expandedItemId === CREATING && draft && (
            <p className="text-sm text-muted">Fill out the new item in the editor that just opened.</p>
          )}

          {items.length === 0 && (
            <EmptyState
              icon={<IconMenuBook className="h-5 w-5" />}
              title="Add the food customers can order"
              description="This is what shows up on your online menu. Customers can't check out until at least one item is available."
              action={
                canWrite ? (
                  <Button size="sm" onClick={() => openCreatePanel()} disabled={expandedItemId === CREATING}>
                    + Add menu item
                  </Button>
                ) : undefined
              }
            />
          )}

          {items.length > 0 && isFiltering && totalVisibleItems === 0 && (
            <EmptyState
              icon={<IconSearch className="h-5 w-5" />}
              title="No items match your search"
              description="Try a different search term, or clear the filter to see your full menu."
              action={
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Clear search &amp; filters
                </Button>
              }
            />
          )}

          {!(items.length > 0 && isFiltering && totalVisibleItems === 0) && (
            /* Phase 81 Stage 2 — a category "chapter" now reads like an actual menu section (a
               heading + a single rule beneath it) instead of a bordered, shadowed admin card —
               every control that was inside the old Card (grip, collapse, rename, delete,
               location-override row, the items themselves) is unchanged, just re-skinned. */
            <div className="flex flex-col gap-8">
              {categories.map((category, categoryIndex) => {
                const categoryOverride = categoryOverrideById.get(category.id);
                const effectiveCategoryActive = categoryOverride?.isActive ?? category.isActive;
                const allCategoryItems = itemsByCategoryId.get(category.id) ?? [];
                const visibleCategoryItems = allCategoryItems.filter(itemMatchesFilters);
                const collapsed = collapsedCategoryIds.has(category.id);
                const isCategoryDropTarget = draggedCategoryId !== null && draggedCategoryId !== category.id;
                const isItemCrossCategoryDropTarget = draggedItem !== null && draggedItem.categoryId !== category.id;
                const isValidDropTarget = isCategoryDropTarget || isItemCrossCategoryDropTarget;

                return (
                  <div
                    key={category.id}
                    id={`category-${category.id}`}
                    ref={(el) => {
                      if (el) categoryRefs.current.set(category.id, el);
                      else categoryRefs.current.delete(category.id);
                    }}
                    onDragOver={(e) => {
                      if (isValidDropTarget) e.preventDefault();
                    }}
                    onDragEnter={(e) => {
                      if (isValidDropTarget) {
                        e.preventDefault();
                        setDropHighlightCategoryId(category.id);
                      }
                    }}
                    onDragLeave={() => {
                      setDropHighlightCategoryId((current) => (current === category.id ? null : current));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedCategoryId) handleMoveCategoryTo(draggedCategoryId, category.id);
                      else if (draggedItem && draggedItem.categoryId !== category.id) handleMoveItemToCategory(draggedItem.itemId, category.id);
                      setDraggedCategoryId(null);
                      setDraggedItem(null);
                      setDropHighlightCategoryId(null);
                    }}
                    className={`scroll-mt-6 animate-fade-up rounded-lg transition-shadow duration-fast ${
                      dropHighlightCategoryId === category.id ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""
                    }`}
                  >
                    {/* Wrapped in its own <ul> (a real, single-item list) rather than a bare div —
                        full-order-flow.spec.ts locates a freshly-created category via
                        `page.locator("li", {hasText: categoryName})`. This <li> deliberately does
                        NOT also wrap the items list further down — see this file's own Phase 68
                        notes. */}
                    <ul>
                      <li className="flex flex-wrap items-start gap-3 border-b-2 border-border pb-2.5">
                        {canWrite && (
                          <GripHandle
                            label={category.name}
                            onMoveUp={() => handleReorderCategory(category, "up")}
                            onMoveDown={() => handleReorderCategory(category, "down")}
                            disableUp={categoryIndex === 0}
                            disableDown={categoryIndex === categories.length - 1}
                            onDragStart={() => setDraggedCategoryId(category.id)}
                            onDragEnd={() => setDraggedCategoryId(null)}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleCategoryCollapsed(category.id)}
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? "Expand" : "Collapse"} ${category.name}`}
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground"
                        >
                          <IconChevronDown className={`h-4 w-4 transition-transform duration-fast ${collapsed ? "-rotate-90" : ""}`} />
                        </button>

                        {editingCategoryId === category.id ? (
                          <form
                            className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveRenameCategory(category.id);
                            }}
                          >
                            <input
                              autoFocus
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                              className={`flex-1 ${inputClass}`}
                            />
                            <input
                              value={editingCategoryDescription}
                              onChange={(e) => setEditingCategoryDescription(e.target.value)}
                              placeholder="Description (optional)"
                              className={`flex-1 ${inputClass}`}
                            />
                            <div className="flex gap-2">
                              <button type="submit" className="text-sm font-medium text-primary hover:underline">
                                Save
                              </button>
                              <button type="button" onClick={cancelRenameCategory} className={rowActionClass}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="min-w-[140px] flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <h2 className="truncate font-heading text-lg font-semibold uppercase tracking-[0.03em] text-foreground">{category.name}</h2>
                              <span className="text-xs text-muted">
                                {allCategoryItems.length} item{allCategoryItems.length === 1 ? "" : "s"}
                              </span>
                              {!category.isActive && <Badge tone="neutral">Hidden (all locations)</Badge>}
                              {categoryOverride && <Badge tone="info">Overridden here</Badge>}
                            </div>
                            {category.description && <p className="mt-0.5 text-sm italic text-muted">{category.description}</p>}
                          </div>
                        )}

                        {canWrite && editingCategoryId !== category.id && (
                          <div className="flex flex-wrap items-center gap-3">
                            <Switch
                              checked={category.isActive}
                              onChange={() => handleToggleCategoryActive(category)}
                              label={`${category.name} visible to customers`}
                            />
                            <button onClick={() => openCreatePanel(category.id)} className={rowActionClass} disabled={expandedItemId === CREATING}>
                              + Quick add
                            </button>
                            <button onClick={() => startRenameCategory(category)} className={rowActionClass}>
                              Rename
                            </button>
                            <button onClick={() => handleDeleteCategory(category)} className="text-sm font-medium text-danger hover:underline">
                              Delete
                            </button>
                          </div>
                        )}
                      </li>
                    </ul>

                    {canWrite && editingCategoryId !== category.id && (
                      <div className="flex flex-wrap items-center gap-2 py-1.5 text-xs text-muted">
                        <span>This location:</span>
                        <button
                          onClick={() => handleSaveCategoryOverride(category.id, { isActive: !effectiveCategoryActive })}
                          className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                        >
                          {effectiveCategoryActive ? "hide only here" : "show only here"}
                        </button>
                        {categoryOverride && (
                          <button
                            onClick={() => handleResetCategoryOverride(category.id)}
                            className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                          >
                            reset to canonical
                          </button>
                        )}
                      </div>
                    )}

                    {/* A CSS grid-template-rows transition (0fr <-> 1fr) rather than a plain
                        mount/unmount — the standard way to animate to/from `height: auto`. Always
                        rendered so prefers-reduced-motion (which zeroes transition-duration
                        globally) still applies correctly. */}
                    <div className={`grid transition-[grid-template-rows] duration-normal ease-premium ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
                      <div className="overflow-hidden">
                        {allCategoryItems.length === 0 ? (
                          <p className="py-3 text-sm text-muted">No items in this category yet.</p>
                        ) : visibleCategoryItems.length === 0 ? (
                          <p className="py-3 text-sm text-muted">{isFiltering ? "No items match your search or filter." : "No items yet."}</p>
                        ) : (
                          <ul className="flex flex-col divide-y divide-border">
                            {visibleCategoryItems.map((item, itemIndex) => renderItemRow(item, allCategoryItems, itemIndex))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {orphanedItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="border-b-2 border-border pb-2.5">
                    <h2 className="font-heading text-lg font-semibold uppercase tracking-[0.03em] text-foreground">Uncategorized</h2>
                    <p className="text-xs text-muted">These items point to a category that no longer exists — move them to a real category.</p>
                  </div>
                  <ul className="flex flex-col divide-y divide-border">
                    {orphanedItems.filter(itemMatchesFilters).map((item, itemIndex) => renderItemRow(item, orphanedItems, itemIndex))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <MenuBuilderLayout
        leftRail={
          <CategoryNavRail
            categories={categories}
            itemCountByCategory={itemCountByCategory}
            totalItemCount={items.length}
            search={search}
            onSearchChange={setSearch}
            availabilityFilter={availabilityFilter}
            onAvailabilityFilterChange={setAvailabilityFilter}
            hasModifiersOnly={hasModifiersOnly}
            onHasModifiersOnlyChange={setHasModifiersOnly}
            noImageOnly={noImageOnly}
            onNoImageOnlyChange={setNoImageOnly}
            onJumpToCategory={scrollToCategory}
          />
        }
        rightPanel={
          <ItemEditorDrawer
            open={draft !== null}
            mode={expandedItemId === CREATING ? "create" : "edit"}
            draft={draft}
            setDraft={setDraft}
            categories={categories}
            saving={saving}
            justSaved={justSaved}
            saveDraft={saveDraft}
            closePanel={closePanel}
            businessId={businessId}
            restaurantId={restaurantId}
            expandedItemId={expandedItemId === CREATING ? null : expandedItemId}
            override={expandedItemId ? itemOverrideById.get(expandedItemId) : undefined}
            onSaveOverride={(patch) => expandedItemId && expandedItemId !== CREATING && handleSaveItemOverride(expandedItemId, patch)}
            onResetOverride={() => expandedItemId && expandedItemId !== CREATING && handleResetItemOverride(expandedItemId)}
            currency={currency}
          />
        }
      >
        {centerCanvas}
      </MenuBuilderLayout>

      {/* Live preview — the real running storefront in an iframe, not a second renderer. Escape
          and the backdrop both close it, same convention as the item editor drawer. */}
      {showPreview && previewHref && (
        <div
          ref={previewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Storefront live preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
          onClick={() => setShowPreview(false)}
        >
          <div className="relative flex max-h-full flex-col items-center gap-3 animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <button
              ref={previewCloseButtonRef}
              type="button"
              onClick={() => setShowPreview(false)}
              aria-label="Close preview"
              className="self-end rounded-full bg-surface p-2 text-foreground shadow-md transition-colors duration-fast hover:bg-black/[0.04]"
            >
              <IconX className="h-4 w-4" />
            </button>
            <div className="relative h-[70vh] w-[360px] max-w-full overflow-hidden rounded-[2.5rem] border-[10px] border-secondary bg-black shadow-elevated sm:h-[720px] sm:max-h-[80vh]">
              {!previewLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-background">
                  <Spinner size="lg" label="Loading preview" />
                </div>
              )}
              <iframe
                src={previewHref}
                title="Storefront live preview"
                onLoad={() => setPreviewLoaded(true)}
                className={`h-full w-full border-0 transition-opacity duration-normal ease-premium ${previewLoaded ? "opacity-100" : "opacity-0"}`}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

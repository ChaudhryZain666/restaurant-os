import { useEffect, useState, type FormEvent } from "react";
import { roleHasPermission, type Category, type MenuItem } from "@restaurant/types";
import { Badge, Button, Card } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantCurrency } from "../hooks/useRestaurantCurrency";
import { ModifierGroupsEditor } from "../components/ModifierGroupsEditor";
import { uploadRestaurantImage } from "../lib/uploads";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";
const rowActionClass = "text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground";

/** Sentinel expandedItemId meaning "the create-item panel is open" — before a real item exists to
 *  key the panel on. Chosen so it can never collide with a real Mongo ObjectId string. */
const CREATING = "__creating__";

interface ItemDraft {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  imageUrl: string;
  isAvailable: boolean;
}

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

interface ItemFormProps {
  mode: "create" | "edit";
  draft: ItemDraft;
  setDraft: (draft: ItemDraft) => void;
  categories: Category[];
  saving: boolean;
  saveDraft: () => void;
  closePanel: () => void;
  restaurantId: string;
  expandedItemId: string;
}

/** Declared at module scope, not inside MenuManagementPage — a component defined inside another
 *  component's body gets a new function identity on every parent render, which makes React treat
 *  it as a different component type and remount it (and everything under it, including
 *  ModifierGroupsEditor) on every keystroke elsewhere in the page, silently discarding whatever
 *  unsaved modifier edits were in progress. */
function ItemForm({ mode, draft, setDraft, categories, saving, saveDraft, closePanel, restaurantId, expandedItemId }: ItemFormProps) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleImageUpload(file: File | undefined) {
    if (!file) return;
    setUploadingImage(true);
    setUploadError(null);
    try {
      const url = await uploadRestaurantImage(restaurantId, "menuItemImage", file);
      setDraft({ ...draft, imageUrl: url });
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {mode === "create" ? "1. Basic information" : "Basic information"}
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {draft.imageUrl ? (
              <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-muted">No image</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              className={inputClass}
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Description"
              rows={2}
              className={inputClass}
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                placeholder="Base price"
                className={`w-28 ${inputClass}`}
              />
              <select
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                className={inputClass}
              >
                {categories.length === 0 && <option value="">Add a category first</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                value={draft.imageUrl}
                onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                placeholder="Image URL, or upload a file below"
                className={`flex-1 ${inputClass}`}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploadingImage}
                onChange={(e) => handleImageUpload(e.target.files?.[0])}
                className="text-xs text-muted"
              />
              {uploadingImage && <span className="text-xs text-muted">Uploading…</span>}
            </div>
            {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.isAvailable}
                onChange={(e) => setDraft({ ...draft, isAvailable: e.target.checked })}
              />
              Available to customers
            </label>
            <Button
              size="sm"
              className="self-start"
              onClick={saveDraft}
              disabled={saving || !draft.name.trim() || !draft.price || !draft.categoryId}
            >
              {saving ? "Saving..." : mode === "create" ? "Create item & continue" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      {mode === "edit" && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Sizes &amp; add-ons (modifier groups)
          </p>
          <ModifierGroupsEditor restaurantId={restaurantId} menuItemId={expandedItemId} />
          <Button size="sm" variant="ghost" className="mt-3" onClick={closePanel}>
            Done
          </Button>
        </div>
      )}

      {mode === "create" && (
        <p className="text-xs text-muted">
          Create the item first, then this same panel will let you add sizes, toppings, or other add-ons —
          optional, and only once the item exists.
        </p>
      )}
    </div>
  );
}

export function MenuManagementPage() {
  const { user } = useAuth();
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();
  // Every role that can reach this page at all (owner/manager/restaurant_staff — see App.tsx's
  // RequireAuth permission="restaurant.menu.read") either has all three menu-editing permissions
  // together (owner, manager) or none of them (restaurant_staff never has menu.write,
  // categories.write, or modifiers.write) — so this one check is a safe stand-in for gating every
  // write control on the page, not just item edits. Fixes a real gap: restaurant_staff could
  // previously see fully-interactive Add/Edit/Delete buttons that always 403'd on click, since the
  // backend already required restaurant.menu.write (menu.routes.ts) that role never had.
  const canWrite = roleHasPermission(user!.role, "restaurant.menu.write");

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  // A single expand-panel drives BOTH creating a new item and editing an existing one — the
  // fragmentation this replaces was that creating an item and configuring its modifier groups
  // used to be two separate trips (a cramped inline "quick add" row, then a completely separate
  // click-Edit-and-scroll step). Now: open the panel, fill in basic info, create — the SAME panel
  // immediately continues into modifier configuration for the item that was just created, because
  // expandedItemId simply becomes the new item's real id and the normal edit-panel path takes over.
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const [categoriesRes, itemsRes] = await Promise.all([
      apiClient.request<{ categories: Category[] }>(`/restaurants/${restaurantId}/categories`),
      // Staff-only, uncached, includes hidden (isAvailable: false) items — GET /menu is the
      // public cached endpoint and never includes those, so it can't be used to un-hide an item.
      apiClient.request<{ items: MenuItem[] }>(`/restaurants/${restaurantId}/menu/items`),
    ]);
    setCategories(categoriesRes.categories);
    setItems(itemsRes.items);
    return itemsRes.items;
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories`, {
        method: "POST",
        body: { name: newCategoryName },
      });
      setNewCategoryName("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteCategory(category: Category) {
    if (!window.confirm(`Delete the category "${category.name}"? This can't be undone.`)) return;
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${category.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdateCategory(id: string, patch: Partial<Pick<Category, "name" | "sortOrder" | "isActive">>) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startRenameCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  }

  function cancelRenameCategory() {
    setEditingCategoryId(null);
    setEditingCategoryName("");
  }

  async function saveRenameCategory(id: string) {
    const name = editingCategoryName.trim();
    if (!name) return;
    await handleUpdateCategory(id, { name });
    setEditingCategoryId(null);
    setEditingCategoryName("");
  }

  async function handleUpdateItemSortOrder(item: MenuItem, sortOrder: number) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${item.id}`, { method: "PATCH", body: { sortOrder } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleAvailability(item: MenuItem) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${item.id}`, {
        method: "PATCH",
        body: { isAvailable: !item.isAvailable },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteItem(item: MenuItem) {
    if (!window.confirm(`Delete the menu item "${item.name}"? This can't be undone.`)) return;
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${item.id}`, { method: "DELETE" });
      if (expandedItemId === item.id) closePanel();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openCreatePanel() {
    setError(null);
    setExpandedItemId(CREATING);
    setDraft(emptyDraft(categories[0]?.id ?? ""));
  }

  function openEditPanel(item: MenuItem) {
    if (expandedItemId === item.id) {
      closePanel();
      return;
    }
    setError(null);
    setExpandedItemId(item.id);
    setDraft(draftFromItem(item));
  }

  function closePanel() {
    setExpandedItemId(null);
    setDraft(null);
  }

  /** Handles both stages of the panel: while expandedItemId === CREATING this POSTs a new item and
   *  then transitions straight into editing it (same panel, no reload-and-re-click); once a real
   *  item is expanded, it PATCHes that item's basic info. */
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
        const { item } = await apiClient.request<{ item: MenuItem }>(`/restaurants/${restaurantId}/menu`, {
          method: "POST",
          body: { ...body, isAvailable: draft.isAvailable },
        });
        const freshItems = await reload();
        setExpandedItemId(item.id);
        setDraft(draftFromItem(freshItems.find((i) => i.id === item.id) ?? item));
      } else if (expandedItemId) {
        await apiClient.request(`/restaurants/${restaurantId}/menu/${expandedItemId}`, {
          method: "PATCH",
          body: { ...body, isAvailable: draft.isAvailable },
        });
        await reload();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted">Loading menu...</p>;

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Menu</h1>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      <Card>
        <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Categories</h2>
        <ul className="mb-4 flex flex-col divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              {editingCategoryId === c.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRenameCategory(c.id);
                  }}
                >
                  <input
                    autoFocus
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                    className={`flex-1 ${inputClass}`}
                  />
                  <button type="submit" className="text-sm font-medium text-primary hover:underline">
                    Save
                  </button>
                  <button type="button" onClick={cancelRenameCategory} className={rowActionClass}>
                    Cancel
                  </button>
                </form>
              ) : (
                <span className="flex-1 text-sm text-foreground">
                  {c.name} {!c.isActive && <Badge tone="neutral" className="ml-1.5">hidden</Badge>}
                </span>
              )}
              {canWrite && editingCategoryId !== c.id && (
                <>
                  <button onClick={() => startRenameCategory(c)} className={rowActionClass}>
                    Rename
                  </button>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    Order
                    <input
                      type="number"
                      value={c.sortOrder}
                      onChange={(e) => handleUpdateCategory(c.id, { sortOrder: Number(e.target.value) })}
                      className="w-14 rounded-lg border border-border bg-background px-1.5 py-0.5"
                    />
                  </label>
                  <button onClick={() => handleUpdateCategory(c.id, { isActive: !c.isActive })} className={rowActionClass}>
                    {c.isActive ? "Hide" : "Show"}
                  </button>
                  <button onClick={() => handleDeleteCategory(c)} className="text-sm font-medium text-danger hover:underline">
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
        <form onSubmit={handleCreateCategory} className="flex gap-2">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name"
            required
            className={inputClass}
          />
          <Button type="submit" size="sm">
            Add category
          </Button>
        </form>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-medium text-foreground">Menu items</h2>
          {canWrite && (
            <Button size="sm" onClick={openCreatePanel} disabled={expandedItemId === CREATING}>
              + Add menu item
            </Button>
          )}
        </div>

        {canWrite && expandedItemId === CREATING && draft && (
          <div className="mb-4">
            <ItemForm
              mode="create"
              draft={draft}
              setDraft={setDraft}
              categories={categories}
              saving={saving}
              saveDraft={saveDraft}
              closePanel={closePanel}
              restaurantId={restaurantId}
              expandedItemId={expandedItemId}
            />
            <button onClick={closePanel} className="mt-2 text-sm font-medium text-foreground/70 hover:underline">
              Cancel
            </button>
          </div>
        )}

        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.04]">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </div>
                <span className="flex-1 text-sm text-foreground">
                  <strong className="font-medium">{item.name}</strong> — {formatCurrency(item.price, currency)}{" "}
                  <span className="text-muted">({categoryName(item.categoryId)})</span>{" "}
                  {!item.isAvailable && <Badge tone="neutral">hidden</Badge>}
                </span>
                {canWrite && (
                <>
                <label className="flex items-center gap-1 text-xs text-muted">
                  Order
                  <input
                    type="number"
                    value={item.sortOrder}
                    onChange={(e) => handleUpdateItemSortOrder(item, Number(e.target.value))}
                    className="w-14 rounded-lg border border-border bg-background px-1.5 py-0.5"
                  />
                </label>
                <button onClick={() => openEditPanel(item)} className={rowActionClass}>
                  {expandedItemId === item.id ? "Close" : "Edit"}
                </button>
                <button onClick={() => handleToggleAvailability(item)} className={rowActionClass}>
                  {item.isAvailable ? "Hide" : "Show"}
                </button>
                <button onClick={() => handleDeleteItem(item)} className="text-sm font-medium text-danger hover:underline">
                  Delete
                </button>
                </>
                )}
              </div>

              {canWrite && expandedItemId === item.id && draft && (
                <div className="mt-3">
                  <ItemForm
                    mode="edit"
                    draft={draft}
                    setDraft={setDraft}
                    categories={categories}
                    saving={saving}
                    saveDraft={saveDraft}
                    closePanel={closePanel}
                    restaurantId={restaurantId}
                    expandedItemId={expandedItemId}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

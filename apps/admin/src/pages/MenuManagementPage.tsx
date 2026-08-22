import { useEffect, useState, type FormEvent } from "react";
import {
  roleHasPermission,
  type Category,
  type CategoryLocationOverride,
  type MenuItem,
  type MenuItemLocationOverride,
} from "@restaurant/types";
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
  businessId: string;
  restaurantId: string;
  expandedItemId: string;
  override?: MenuItemLocationOverride;
  onSaveOverride: (patch: { priceOverride?: number; isAvailable?: boolean }) => void;
  onResetOverride: () => void;
  currency: string;
}

/** Declared at module scope, not inside MenuManagementPage — a component defined inside another
 *  component's body gets a new function identity on every parent render, which makes React treat
 *  it as a different component type and remount it (and everything under it, including
 *  ModifierGroupsEditor) on every keystroke elsewhere in the page, silently discarding whatever
 *  unsaved modifier edits were in progress. */
function ItemForm({
  mode,
  draft,
  setDraft,
  categories,
  saving,
  saveDraft,
  closePanel,
  businessId,
  restaurantId,
  expandedItemId,
  override,
  onSaveOverride,
  onResetOverride,
  currency,
}: ItemFormProps) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [priceOverrideDraft, setPriceOverrideDraft] = useState(override?.priceOverride != null ? String(override.priceOverride) : "");

  useEffect(() => {
    setPriceOverrideDraft(override?.priceOverride != null ? String(override.priceOverride) : "");
  }, [override?.priceOverride]);

  async function handleImageUpload(file: File | undefined) {
    if (!file) return;
    setUploadingImage(true);
    setUploadError(null);
    try {
      // Uploads are a location-scoped endpoint (no business-scoped equivalent exists) — using the
      // active location here is fine, since imageUrl is stored as a literal shared URL on the
      // canonical item, not duplicated per location (same convention Phase 19's clone established).
      const url = await uploadRestaurantImage(restaurantId, "menuItemImage", file);
      setDraft({ ...draft, imageUrl: url });
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  const effectiveAvailable = override?.isAvailable ?? draft.isAvailable;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {mode === "create" ? "1. Canonical item (all locations)" : "Canonical item — this affects every location that hasn't overridden it"}
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
                placeholder="Base price (all locations)"
                className={`w-40 ${inputClass}`}
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
              Available to customers by default (locations without an override follow this)
            </label>
            <Button
              size="sm"
              className="self-start"
              onClick={saveDraft}
              disabled={saving || !draft.name.trim() || !draft.price || !draft.categoryId}
            >
              {saving ? "Saving..." : mode === "create" ? "Create item & continue" : "Save canonical changes"}
            </Button>
          </div>
        </div>
      </div>

      {mode === "edit" && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">This location only</p>
          <div className="flex flex-wrap items-center gap-3">
            {override ? (
              <Badge tone="info">Overridden here</Badge>
            ) : (
              <Badge tone="neutral">Using business default</Badge>
            )}
            <label className="flex items-center gap-1.5 text-sm text-foreground">
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={priceOverrideDraft}
                onChange={(e) => setPriceOverrideDraft(e.target.value)}
                placeholder={formatCurrency(Number(draft.price) || 0, currency)}
                className={`w-32 ${inputClass}`}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onSaveOverride({
                  priceOverride: priceOverrideDraft ? Number(priceOverrideDraft) : undefined,
                  isAvailable: effectiveAvailable,
                })
              }
              disabled={!priceOverrideDraft}
            >
              Save price here
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSaveOverride({ isAvailable: !effectiveAvailable, priceOverride: override?.priceOverride })}
            >
              {effectiveAvailable ? "Hide only at this location" : "Show only at this location"}
            </Button>
            {override && (
              <Button size="sm" variant="ghost" onClick={onResetOverride}>
                Reset to canonical
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Sizes &amp; add-ons (modifier groups) — canonical, with per-location overrides below each group
          </p>
          <ModifierGroupsEditor businessId={businessId} restaurantId={restaurantId} menuItemId={expandedItemId} />
          <Button size="sm" variant="ghost" className="mt-3" onClick={closePanel}>
            Done
          </Button>
        </div>
      )}

      {mode === "create" && (
        <p className="text-xs text-muted">
          Create the item first, then this same panel will let you add sizes, toppings, other add-ons, and
          per-location overrides — optional, and only once the item exists.
        </p>
      )}
    </div>
  );
}

interface OverridesResponse {
  categoryOverrides: CategoryLocationOverride[];
  menuItemOverrides: MenuItemLocationOverride[];
  modifierGroupOverrides: unknown[];
}

export function MenuManagementPage() {
  const { user } = useAuth();
  const businessId = user!.businessId!;
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();
  // Every role that can reach this page at all (owner/manager/restaurant_staff — see App.tsx's
  // RequireAuth permission="restaurant.menu.read") either has all three menu-editing permissions
  // together (owner, manager) or none of them (restaurant_staff never has menu.write,
  // categories.write, or modifiers.write) — so this one check is a safe stand-in for gating every
  // write control on the page, not just item edits. Applies equally to canonical writes
  // (/businesses/:businessId/...) and location overrides (/restaurants/:restaurantId/.../override)
  // since both are gated by the same permission constants, just checked via different middleware.
  const canWrite = roleHasPermission(user!.role, "restaurant.menu.write");

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryLocationOverride[]>([]);
  const [itemOverrides, setItemOverrides] = useState<MenuItemLocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  // A single expand-panel drives BOTH creating a new item and editing an existing one.
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const [categoriesRes, itemsRes, overridesRes] = await Promise.all([
      apiClient.request<{ categories: Category[] }>(`/businesses/${businessId}/categories`),
      apiClient.request<{ items: MenuItem[] }>(`/businesses/${businessId}/menu`),
      apiClient.request<OverridesResponse>(`/restaurants/${restaurantId}/menu/overrides`),
    ]);
    setCategories(categoriesRes.categories);
    setItems(itemsRes.items);
    setCategoryOverrides(overridesRes.categoryOverrides);
    setItemOverrides(overridesRes.menuItemOverrides);
    return itemsRes.items;
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const categoryOverrideById = new Map(categoryOverrides.map((o) => [o.categoryId, o]));
  const itemOverrideById = new Map(itemOverrides.map((o) => [o.menuItemId, o]));

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories`, {
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
    if (!window.confirm(`Delete the canonical category "${category.name}" for ALL locations of this business? This can't be undone.`))
      return;
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories/${category.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdateCategory(id: string, patch: Partial<Pick<Category, "name" | "sortOrder" | "isActive">>) {
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/categories/${id}`, { method: "PATCH", body: patch });
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
      await apiClient.request(`/businesses/${businessId}/menu/${item.id}`, { method: "PATCH", body: { sortOrder } });
      await reload();
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

  /** Handles both stages of the panel: while expandedItemId === CREATING this POSTs a new
   *  canonical item and then transitions straight into editing it (same panel, no
   *  reload-and-re-click); once a real item is expanded, it PATCHes that canonical item's info. */
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
        const { item } = await apiClient.request<{ item: MenuItem }>(`/businesses/${businessId}/menu`, {
          method: "POST",
          body: { ...body, isAvailable: draft.isAvailable },
        });
        const freshItems = await reload();
        setExpandedItemId(item.id);
        setDraft(draftFromItem(freshItems.find((i) => i.id === item.id) ?? item));
      } else if (expandedItemId) {
        await apiClient.request(`/businesses/${businessId}/menu/${expandedItemId}`, {
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

  if (loading) return <p className="text-muted">Loading menu...</p>;

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Menu</h1>
      <p className="text-sm text-muted">
        This is your business's shared menu. Changes here apply to every location, unless a location has its own
        override.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      <Card>
        <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Categories</h2>
        <ul className="mb-4 flex flex-col divide-y divide-border">
          {categories.map((c) => {
            const override = categoryOverrideById.get(c.id);
            const effectiveActive = override?.isActive ?? c.isActive;
            return (
              <li key={c.id} className="flex flex-col gap-2 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
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
                      {c.name} {!c.isActive && <Badge tone="neutral" className="ml-1.5">hidden (all locations)</Badge>}
                      {override && <Badge tone="info" className="ml-1.5">overridden here</Badge>}
                    </span>
                  )}
                  {canWrite && editingCategoryId !== c.id && (
                    <>
                      <button onClick={() => startRenameCategory(c)} className={rowActionClass}>
                        Rename
                      </button>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        Order (all locations)
                        <input
                          type="number"
                          value={c.sortOrder}
                          onChange={(e) => handleUpdateCategory(c.id, { sortOrder: Number(e.target.value) })}
                          className="w-14 rounded-lg border border-border bg-background px-1.5 py-0.5"
                        />
                      </label>
                      <button onClick={() => handleUpdateCategory(c.id, { isActive: !c.isActive })} className={rowActionClass}>
                        {c.isActive ? "Hide (all locations)" : "Show (all locations)"}
                      </button>
                      <button onClick={() => handleDeleteCategory(c)} className="text-sm font-medium text-danger hover:underline">
                        Delete
                      </button>
                    </>
                  )}
                </div>
                {canWrite && (
                  <div className="ml-1 flex items-center gap-2 text-xs text-muted">
                    <span>This location:</span>
                    <button
                      onClick={() => handleSaveCategoryOverride(c.id, { isActive: !effectiveActive })}
                      className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                    >
                      {effectiveActive ? "hide only here" : "show only here"}
                    </button>
                    {override && (
                      <button onClick={() => handleResetCategoryOverride(c.id)} className="font-medium text-foreground/70 hover:text-foreground hover:underline">
                        reset to canonical
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form onSubmit={handleCreateCategory} className="flex gap-2">
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name (all locations)"
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
              businessId={businessId}
              restaurantId={restaurantId}
              expandedItemId={expandedItemId}
              onSaveOverride={() => {}}
              onResetOverride={() => {}}
              currency={currency}
            />
            <button onClick={closePanel} className="mt-2 text-sm font-medium text-foreground/70 hover:underline">
              Cancel
            </button>
          </div>
        )}

        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => {
            const override = itemOverrideById.get(item.id);
            const effectivePrice = override?.priceOverride ?? item.price;
            const effectiveAvailable = override?.isAvailable ?? item.isAvailable;
            return (
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
                    <strong className="font-medium">{item.name}</strong> — {formatCurrency(effectivePrice, currency)}{" "}
                    {override?.priceOverride != null && (
                      <span className="text-muted line-through">{formatCurrency(item.price, currency)}</span>
                    )}{" "}
                    <span className="text-muted">({categoryName(item.categoryId)})</span>{" "}
                    {!effectiveAvailable && <Badge tone="neutral">hidden here</Badge>}
                    {override && <Badge tone="info">overridden here</Badge>}
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
                        {item.isAvailable ? "Hide (all locations)" : "Show (all locations)"}
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
                      businessId={businessId}
                      restaurantId={restaurantId}
                      expandedItemId={expandedItemId}
                      override={override}
                      onSaveOverride={(patch) => handleSaveItemOverride(item.id, patch)}
                      onResetOverride={() => handleResetItemOverride(item.id)}
                      currency={currency}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

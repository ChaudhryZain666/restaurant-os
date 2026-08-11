import { useEffect, useState, type FormEvent } from "react";
import type { Category, MenuItem } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export function MenuManagementPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItem, setNewItem] = useState({ name: "", price: "", categoryId: "", description: "" });

  async function reload() {
    const [categoriesRes, itemsRes] = await Promise.all([
      apiClient.request<{ categories: Category[] }>(`/restaurants/${restaurantId}/categories`),
      // Staff-only, uncached, includes hidden (isAvailable: false) items — GET /menu is the
      // public cached endpoint and never includes those, so it can't be used to un-hide an item.
      apiClient.request<{ items: MenuItem[] }>(`/restaurants/${restaurantId}/menu/items`),
    ]);
    setCategories(categoriesRes.categories);
    setItems(itemsRes.items);
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

  async function handleDeleteCategory(id: string) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdateCategory(id: string, patch: Partial<Pick<Category, "sortOrder" | "isActive">>) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/categories/${id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
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

  async function handleCreateItem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu`, {
        method: "POST",
        body: {
          name: newItem.name,
          price: Number(newItem.price),
          categoryId: newItem.categoryId,
          description: newItem.description || undefined,
        },
      });
      setNewItem({ name: "", price: "", categoryId: "", description: "" });
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

  async function handleDeleteItem(id: string) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/menu/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <p>Loading menu...</p>;

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Menu</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">Categories</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span>
                {c.name} {!c.isActive && <em className="text-slate-500">(hidden)</em>}
              </span>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Order
                <input
                  type="number"
                  value={c.sortOrder}
                  onChange={(e) => handleUpdateCategory(c.id, { sortOrder: Number(e.target.value) })}
                  className="w-14 rounded border px-1 py-0.5"
                />
              </label>
              <button onClick={() => handleUpdateCategory(c.id, { isActive: !c.isActive })} className="text-sm">
                {c.isActive ? "Hide" : "Show"}
              </button>
              <button onClick={() => handleDeleteCategory(c.id)} className="text-sm text-red-600">
                Delete
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateCategory} className="flex gap-2">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name"
            required
            className="rounded border px-2 py-1"
          />
          <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-white">
            Add category
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Menu items</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span>
                <strong>{item.name}</strong> — ${item.price.toFixed(2)} ({categoryName(item.categoryId)}){" "}
                {!item.isAvailable && <em>(hidden)</em>}
              </span>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Order
                <input
                  type="number"
                  value={item.sortOrder}
                  onChange={(e) => handleUpdateItemSortOrder(item, Number(e.target.value))}
                  className="w-14 rounded border px-1 py-0.5"
                />
              </label>
              <button onClick={() => handleToggleAvailability(item)} className="text-sm">
                {item.isAvailable ? "Hide" : "Show"}
              </button>
              <button onClick={() => handleDeleteItem(item.id)} className="text-sm text-red-600">
                Delete
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateItem} className="flex flex-wrap gap-2">
          <input
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            placeholder="Item name"
            required
            className="rounded border px-2 py-1"
          />
          <input
            value={newItem.price}
            onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
            placeholder="Price"
            type="number"
            min="0"
            step="0.01"
            required
            className="w-24 rounded border px-2 py-1"
          />
          <select
            value={newItem.categoryId}
            onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}
            required
            className="rounded border px-2 py-1"
          >
            <option value="">Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={newItem.description}
            onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            placeholder="Description (optional)"
            className="rounded border px-2 py-1"
          />
          <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-white">
            Add item
          </button>
        </form>
      </section>
    </div>
  );
}

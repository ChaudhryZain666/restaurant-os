import { useEffect, useMemo, useState } from "react";
import type { Category, MenuItem, ModifierGroup, SelectedModifier } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";

interface MenuResponse {
  items: MenuItem[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
}

export function MenuPage() {
  const { restaurant, availability, loading: restaurantLoading, error: restaurantError } = useRestaurant();
  const orderingOpen = availability?.status === "open";
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({}); // groupId -> optionIds
  const { addItem } = useCart();

  useEffect(() => {
    if (!restaurant) return;
    apiClient
      .request<MenuResponse>(`/restaurants/${restaurant.id}/menu`, { skipRefresh: true })
      .then(setMenu)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurant]);

  const categoriesById = useMemo(() => new Map((menu?.categories ?? []).map((c) => [c.id, c])), [menu]);
  const groupsByItem = useMemo(() => {
    const map = new Map<string, ModifierGroup[]>();
    for (const group of menu?.modifierGroups ?? []) {
      const list = map.get(group.menuItemId) ?? [];
      list.push(group);
      map.set(group.menuItemId, list);
    }
    return map;
  }, [menu]);

  if (restaurantLoading || loading) return <p>Loading menu...</p>;
  if (restaurantError) return <p role="alert">Failed to load restaurant: {restaurantError}</p>;
  if (error) return <p role="alert">Failed to load menu: {error}</p>;
  if (!menu) return null;

  const byCategory = menu.items.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.categoryId] ??= []).push(item);
    return acc;
  }, {});
  // Render in the categories' own configured sortOrder, not insertion order — those can differ
  // since `menu.items` isn't guaranteed to encounter categories in that order.
  const menuCategories = menu.categories ?? [];
  // Categories with zero available items (e.g. newly created, nothing added yet) are skipped —
  // byCategory only has entries for categories that actually have items in it.
  const orderedCategoryIds = [
    ...menuCategories.map((c) => c.id),
    ...Object.keys(byCategory).filter((id) => !menuCategories.some((c) => c.id === id)),
  ].filter((id) => byCategory[id]?.length);

  function toggleOption(group: ModifierGroup, optionId: string) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: [optionId] };
      }
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : current.length < group.maxSelect
          ? [...current, optionId]
          : current;
      return { ...prev, [group.id]: next };
    });
  }

  function startAdding(item: MenuItem) {
    const groups = groupsByItem.get(item.id) ?? [];
    if (groups.length === 0) {
      addItem(item);
      return;
    }
    setExpandedItemId(item.id);
    setSelections({});
  }

  function confirmAdd(item: MenuItem) {
    const groups = groupsByItem.get(item.id) ?? [];
    for (const group of groups) {
      const chosen = selections[group.id] ?? [];
      if (chosen.length < group.minSelect) {
        setError(`"${group.name}" requires at least ${group.minSelect} selection(s)`);
        return;
      }
    }
    setError(null);

    const selectedModifiers: SelectedModifier[] = groups.flatMap((group) =>
      (selections[group.id] ?? []).map((optionId) => {
        const option = group.options.find((o) => o.id === optionId)!;
        return {
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceAdjustment: option.priceAdjustment,
        };
      })
    );

    addItem(item, selectedModifiers);
    setExpandedItemId(null);
  }

  return (
    <div>
      <h1>{restaurant?.name}</h1>
      {error && <p role="alert">{error}</p>}
      {orderedCategoryIds.map((categoryId) => (
        <section key={categoryId}>
          <h2>{categoriesById.get(categoryId)?.name ?? "Other"}</h2>
          <ul>
            {byCategory[categoryId].map((item) => {
              const groups = groupsByItem.get(item.id) ?? [];
              return (
                <li key={item.id}>
                  <strong>{item.name}</strong> — ${item.price.toFixed(2)}
                  <p>{item.description}</p>
                  {expandedItemId === item.id ? (
                    <div>
                      {groups.map((group) => (
                        <fieldset key={group.id}>
                          <legend>
                            {group.name} ({group.minSelect === group.maxSelect
                              ? `choose ${group.minSelect}`
                              : `choose ${group.minSelect}-${group.maxSelect}`}
                            )
                          </legend>
                          {group.options.map((option) => (
                            <label key={option.id} style={{ display: "block" }}>
                              <input
                                type={group.maxSelect === 1 ? "radio" : "checkbox"}
                                name={group.id}
                                checked={(selections[group.id] ?? []).includes(option.id)}
                                onChange={() => toggleOption(group, option.id)}
                              />
                              {option.name}
                              {option.priceAdjustment > 0 && ` (+$${option.priceAdjustment.toFixed(2)})`}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <button onClick={() => confirmAdd(item)} disabled={!orderingOpen}>
                        Confirm add to cart
                      </button>
                      <button onClick={() => setExpandedItemId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => startAdding(item)} disabled={!orderingOpen}>
                      Add to cart
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

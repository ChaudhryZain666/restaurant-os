import { useEffect, useState } from "react";
import type { MenuItem } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";

export function MenuPage() {
  const { restaurant, loading: restaurantLoading, error: restaurantError } = useRestaurant();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    if (!restaurant) return;
    apiClient
      .request<{ items: MenuItem[] }>(`/restaurants/${restaurant.id}/menu`, { skipRefresh: true })
      .then((data) => setItems(data.items))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurant]);

  if (restaurantLoading || loading) return <p>Loading menu...</p>;
  if (restaurantError) return <p role="alert">Failed to load restaurant: {restaurantError}</p>;
  if (error) return <p role="alert">Failed to load menu: {error}</p>;

  const byCategory = items.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div>
      <h1>{restaurant?.name}</h1>
      {Object.entries(byCategory).map(([category, categoryItems]) => (
        <section key={category}>
          <h2>{category}</h2>
          <ul>
            {categoryItems.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — ${item.price.toFixed(2)}
                <p>{item.description}</p>
                <button onClick={() => addItem(item)}>Add to cart</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

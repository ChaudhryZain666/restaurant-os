import { useEffect, useState } from "react";
import type { MenuItem } from "@restaurant/shared";
import { api } from "../lib/api";
import { useCart } from "../context/CartContext";

export function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    api<{ items: MenuItem[] }>("/menu")
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading menu...</p>;
  if (error) return <p role="alert">Failed to load menu: {error}</p>;

  const byCategory = items.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div>
      <h1>Menu</h1>
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

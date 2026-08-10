import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Order } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";

export function CartPage() {
  const { lines, setQuantity, removeItem, subtotal, clear } = useCart();
  const { user } = useAuth();
  const { restaurant } = useRestaurant();
  const navigate = useNavigate();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function placeOrder() {
    if (!user) return navigate("/login");
    if (!restaurant) return;
    setPlacing(true);
    setError(null);
    try {
      await apiClient.request<{ order: Order }>(`/restaurants/${restaurant.id}/orders`, {
        method: "POST",
        body: {
          items: lines.map((l) => ({ menuItemId: l.menuItem.id, quantity: l.quantity })),
          redeemPoints: 0,
        },
      });
      clear();
      navigate("/orders");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  if (lines.length === 0) return <p>Your cart is empty.</p>;

  return (
    <div>
      <h1>Cart</h1>
      <ul>
        {lines.map((line) => (
          <li key={line.menuItem.id}>
            {line.menuItem.name} — ${line.menuItem.price.toFixed(2)} x{" "}
            <input
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => setQuantity(line.menuItem.id, Number(e.target.value))}
            />
            <button onClick={() => removeItem(line.menuItem.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <p>Subtotal: ${subtotal.toFixed(2)}</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={placeOrder} disabled={placing}>
        {placing ? "Placing order..." : "Place order"}
      </button>
    </div>
  );
}

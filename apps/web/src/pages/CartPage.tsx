import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Order, OrderType } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";

export function CartPage() {
  const { lines, setQuantity, removeItem, subtotal, clear } = useCart();
  const { user } = useAuth();
  const { restaurant, availability } = useRestaurant();
  const orderingOpen = availability?.status === "open";
  const navigate = useNavigate();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<OrderType>("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");

  async function placeOrder() {
    if (!user) return navigate("/login");
    if (!restaurant) return;
    if (orderType === "delivery" && !deliveryAddress.trim()) {
      setError("Delivery address is required for delivery orders");
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      await apiClient.request<{ order: Order }>(`/restaurants/${restaurant.id}/orders`, {
        method: "POST",
        body: {
          items: lines.map((l) => ({
            menuItemId: l.menuItem.id,
            quantity: l.quantity,
            selectedModifiers: l.selectedModifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
          })),
          orderType,
          deliveryAddress: orderType === "delivery" ? deliveryAddress : undefined,
          customerNotes: customerNotes || undefined,
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
          <li key={line.lineId}>
            {line.menuItem.name} — ${line.menuItem.price.toFixed(2)}
            {line.selectedModifiers.length > 0 && (
              <span> ({line.selectedModifiers.map((m) => m.optionName).join(", ")})</span>
            )}
            {" x "}
            <input
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => setQuantity(line.lineId, Number(e.target.value))}
            />
            <button onClick={() => removeItem(line.lineId)}>Remove</button>
          </li>
        ))}
      </ul>
      <p>Subtotal: ${subtotal.toFixed(2)}</p>

      <fieldset>
        <legend>Order type</legend>
        <label>
          <input
            type="radio"
            name="orderType"
            checked={orderType === "pickup"}
            onChange={() => setOrderType("pickup")}
          />
          Pickup
        </label>
        <label>
          <input
            type="radio"
            name="orderType"
            checked={orderType === "delivery"}
            onChange={() => setOrderType("delivery")}
          />
          Delivery
        </label>
      </fieldset>

      {orderType === "delivery" && (
        <label>
          Delivery address
          <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} required />
        </label>
      )}

      <label>
        Notes (optional)
        <input value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} />
      </label>

      {error && <p role="alert">{error}</p>}
      <button onClick={placeOrder} disabled={placing || !orderingOpen}>
        {placing ? "Placing order..." : "Place order"}
      </button>
    </div>
  );
}
